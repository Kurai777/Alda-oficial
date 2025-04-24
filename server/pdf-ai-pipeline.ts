import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { generateImagesFromPdf } from './alternative-pdf-processor';
import { saveCatalogToFirestore, saveProductsToFirestore, updateCatalogStatusInFirestore } from './firebase-admin';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Promisified functions
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const execPromise = promisify(exec);

// Configurar APIs de IA
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Pipeline completo para processamento automático de catálogos PDF
 * Combina PDF2Image, PaddleOCR e GPT-4o/Claude para extrair produtos
 * 
 * @param filePath Caminho do arquivo PDF do catálogo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo no banco local
 * @returns Array de produtos extraídos e processados
 */
export async function processCatalogWithAutomatedPipeline(
  filePath: string, 
  fileName: string,
  userId: number | string, 
  catalogId: number
): Promise<any[]> {
  try {
    console.log(`[PDF-AI-Pipeline] Iniciando processamento do catálogo: ${fileName}`);
    
    // 1. Salvar catálogo no Firestore
    console.log(`[PDF-AI-Pipeline] Salvando catálogo no Firestore`);
    const firestoreCatalogId = await saveCatalogToFirestore({
      fileName,
      userId: userId.toString(),
      processedStatus: "processing",
      fileUrl: filePath
    }, userId);
    
    // 2. Converter PDF para imagens
    console.log(`[PDF-AI-Pipeline] Convertendo PDF para imagens`);
    const imageBuffers = await generateImagesFromPdf(filePath, { 
      width: 1600,
      height: 2200
    });
    
    // Criar diretório para salvar as imagens temporárias
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    await mkdir(tempDir, { recursive: true });
    
    // Salvar imagens em arquivos temporários
    console.log(`[PDF-AI-Pipeline] Salvando ${imageBuffers.length} imagens temporárias`);
    const imagePaths: string[] = [];
    for (let i = 0; i < imageBuffers.length; i++) {
      const imagePath = path.join(tempDir, `page_${i + 1}.jpg`);
      await writeFile(imagePath, imageBuffers[i]);
      imagePaths.push(imagePath);
    }
    
    // 3. Executar PaddleOCR em cada imagem
    console.log(`[PDF-AI-Pipeline] Executando PaddleOCR nas imagens`);
    const extractedTextsByPage: any[] = [];
    
    for (let i = 0; i < imagePaths.length; i++) {
      try {
        // Chamar o script Python para executar PaddleOCR
        const pythonScript = path.join(process.cwd(), 'server', 'paddle_ocr_extractor.py');
        const { stdout } = await execPromise(`python ${pythonScript} "${imagePaths[i]}" --output-format json`);
        
        // Processar resultado do OCR
        const ocrResults = JSON.parse(stdout);
        extractedTextsByPage.push({
          page: i + 1,
          ocrResults,
          imagePath: imagePaths[i]
        });
      } catch (error) {
        console.error(`[PDF-AI-Pipeline] Erro ao executar OCR na página ${i + 1}:`, error);
      }
    }
    
    // 4. Processar os resultados OCR com IA (GPT-4o ou Claude)
    console.log(`[PDF-AI-Pipeline] Processando resultados OCR com IA`);
    const products: any[] = [];
    
    // Determinar se é um catálogo Fratini
    const isFratiniCatalog = fileName.toLowerCase().includes("fratini");
    
    for (let i = 0; i < extractedTextsByPage.length; i++) {
      const pageData = extractedTextsByPage[i];
      
      try {
        const pageProducts = await processOcrResultsWithAI(
          pageData.ocrResults,
          pageData.imagePath,
          pageData.page,
          isFratiniCatalog
        );
        
        products.push(...pageProducts);
      } catch (aiError) {
        console.error(`[PDF-AI-Pipeline] Erro ao processar página ${pageData.page} com IA:`, aiError);
        
        // Tentar com modelo alternativo se o primário falhar
        try {
          console.log(`[PDF-AI-Pipeline] Tentando processar com modelo alternativo`);
          const pageProducts = await processOcrResultsWithAlternativeAI(
            pageData.ocrResults,
            pageData.imagePath,
            pageData.page,
            isFratiniCatalog
          );
          
          products.push(...pageProducts);
        } catch (alternativeAiError) {
          console.error(`[PDF-AI-Pipeline] Modelo alternativo também falhou:`, alternativeAiError);
        }
      }
    }
    
    // 5. Processar produtos e salvar no Firestore
    if (products.length === 0) {
      throw new Error(`Nenhum produto foi extraído do catálogo. Verifique se o formato do PDF é compatível.`);
    }
    
    console.log(`[PDF-AI-Pipeline] Extraídos ${products.length} produtos`);
    
    // Adicionar IDs e metadados aos produtos
    const processedProducts = products.map(product => ({
      ...product,
      userId: userId.toString(),
      catalogId: firestoreCatalogId
    }));
    
    // Salvar produtos no Firestore
    console.log(`[PDF-AI-Pipeline] Salvando produtos no Firestore`);
    await saveProductsToFirestore(processedProducts, userId, firestoreCatalogId);
    
    // Atualizar status do catálogo
    console.log(`[PDF-AI-Pipeline] Atualizando status do catálogo para completado`);
    await updateCatalogStatusInFirestore(
      userId,
      firestoreCatalogId,
      "completed",
      processedProducts.length
    );
    
    // 6. Limpar arquivos temporários
    console.log(`[PDF-AI-Pipeline] Limpando arquivos temporários`);
    for (const imagePath of imagePaths) {
      try {
        fs.unlinkSync(imagePath);
      } catch (error) {
        console.error(`[PDF-AI-Pipeline] Erro ao excluir arquivo temporário:`, error);
      }
    }
    
    return processedProducts;
  } catch (error) {
    console.error(`[PDF-AI-Pipeline] Erro crítico no pipeline:`, error);
    throw error;
  }
}

/**
 * Processa resultados OCR com OpenAI GPT-4o
 */
async function processOcrResultsWithAI(
  ocrResults: any,
  imagePath: string,
  pageNumber: number,
  isFratiniCatalog: boolean
): Promise<any[]> {
  try {
    // Ler a imagem como base64
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Preparar contexto OCR para enviar ao GPT-4
    const textBlocks = ocrResults.map((item: any) => item.text || '').join("\\n");
    
    // Definir prompt baseado no tipo de catálogo
    const systemPrompt = isFratiniCatalog 
      ? `Você é um especialista na extração de informações de produtos de catálogos de móveis da marca Fratini.
         Analise o texto extraído via OCR e a imagem do catálogo para identificar todos os produtos presentes.
         
         Para catálogos Fratini:
         - Os códigos de produtos geralmente seguem o padrão como 1.XXXX.XX
         - Preços geralmente vêm após o código ou na mesma linha, precedidos por R$
         - As descrições incluem o tipo de mobiliário (cadeira, poltrona, etc.)
         - Dimensões geralmente são formatadas como LxAxP ou L x A x P (largura, altura, profundidade)
         
         Retorne o resultado como um array JSON com os seguintes campos obrigatórios:
         - name: nome do produto
         - code: código comercial ou SKU
         - price: preço em centavos (valor numérico)
         - category: categoria do produto (cadeira, mesa, poltrona, etc.)
         - colors: array de cores disponíveis
         - materials: array de materiais
         - sizes: objeto com width, height, depth quando disponível
         
         Ignore blocos de texto que não correspondam a produtos.`
      : `Você é um especialista na extração de informações de produtos de catálogos de móveis.
         Analise o texto extraído via OCR e a imagem do catálogo para identificar todos os produtos presentes.
         
         Retorne o resultado como um array JSON com os seguintes campos obrigatórios:
         - name: nome do produto
         - code: código comercial ou SKU
         - price: preço em centavos (valor numérico)
         - category: categoria do produto (cadeira, mesa, poltrona, etc.)
         - colors: array de cores disponíveis
         - materials: array de materiais
         - sizes: objeto com width, height, depth quando disponível
         
         Ignore blocos de texto que não correspondam a produtos.`;
    
    // Enviar para processamento com GPT-4o
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // o modelo mais recente da OpenAI que foi lançado após maio de 2023
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: `Aqui está o texto extraído via OCR da página ${pageNumber} do catálogo:\n\n${textBlocks}\n\nIdentifique todos os produtos presentes neste texto e converta para o formato JSON solicitado.`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ] 
        }
      ],
      response_format: { type: "json_object" }
    });
    
    // Processar resposta da IA
    const responseContent = response.choices[0].message.content;
    if (!responseContent) {
      throw new Error("Resposta vazia da IA");
    }
    
    try {
      const parsedResponse = JSON.parse(responseContent);
      
      // Verificar se é um array ou está dentro de um objeto
      const productsArray = Array.isArray(parsedResponse) 
        ? parsedResponse 
        : parsedResponse.products || parsedResponse.items || [];
      
      if (productsArray.length === 0) {
        console.log("[PDF-AI-Pipeline] Nenhum produto identificado na página", pageNumber);
        return [];
      }
      
      // Processar e enriquecer os produtos
      return productsArray.map((product: any) => ({
        ...product,
        pageNumber,
        imageUrl: `data:image/jpeg;base64,${base64Image}`
      }));
    } catch (parseError) {
      console.error("Erro ao analisar resposta JSON:", parseError);
      console.log("Resposta original:", responseContent);
      throw new Error(`Erro ao processar resposta da IA: ${parseError.message}`);
    }
  } catch (error) {
    console.error("Erro no processamento com GPT-4o:", error);
    throw error;
  }
}

/**
 * Processa resultados OCR com Claude (modelo alternativo)
 */
async function processOcrResultsWithAlternativeAI(
  ocrResults: any,
  imagePath: string,
  pageNumber: number,
  isFratiniCatalog: boolean
): Promise<any[]> {
  try {
    // Ler a imagem como base64
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Preparar contexto OCR para enviar ao Claude
    const textBlocks = ocrResults.map((item: any) => item.text || '').join("\\n");
    
    // Definir prompt baseado no tipo de catálogo
    const systemPrompt = isFratiniCatalog 
      ? `Você é um especialista na extração de informações de produtos de catálogos de móveis da marca Fratini.
         Sua tarefa é analisar o texto extraído via OCR e a imagem do catálogo para identificar todos os produtos presentes.
         
         Para catálogos Fratini:
         - Os códigos de produtos geralmente seguem o padrão como 1.XXXX.XX
         - Preços geralmente vêm após o código ou na mesma linha, precedidos por R$
         - As descrições incluem o tipo de mobiliário (cadeira, poltrona, etc.)
         - Dimensões geralmente são formatadas como LxAxP ou L x A x P (largura, altura, profundidade)
         
         Retorne APENAS um array JSON estritamente no seguinte formato:
         [
           {
             "name": "Nome do produto",
             "code": "CÓDIGO-SKU",
             "price": 10000, (em centavos, valor numérico)
             "category": "cadeira", (categoria do produto)
             "colors": ["cor1", "cor2"], (array de cores disponíveis)
             "materials": ["material1", "material2"], (array de materiais)
             "sizes": {"width": 60, "height": 90, "depth": 45} (quando disponível)
           }
         ]
         
         Ignore blocos de texto que não correspondam a produtos.`
      : `Você é um especialista na extração de informações de produtos de catálogos de móveis.
         Sua tarefa é analisar o texto extraído via OCR e a imagem do catálogo para identificar todos os produtos presentes.
         
         Retorne APENAS um array JSON estritamente no seguinte formato:
         [
           {
             "name": "Nome do produto",
             "code": "CÓDIGO-SKU",
             "price": 10000, (em centavos, valor numérico)
             "category": "cadeira", (categoria do produto)
             "colors": ["cor1", "cor2"], (array de cores disponíveis)
             "materials": ["material1", "material2"], (array de materiais)
             "sizes": {"width": 60, "height": 90, "depth": 45} (quando disponível)
           }
         ]
         
         Ignore blocos de texto que não correspondam a produtos.`;
    
    // Enviar para processamento com Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219', // o modelo mais recente do Anthropic Claude que foi lançado em 24 de fevereiro de 2025
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: `Aqui está o texto extraído via OCR da página ${pageNumber} do catálogo:\n\n${textBlocks}\n\nIdentifique todos os produtos presentes neste texto e converta para o formato JSON solicitado.`
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
    });
    
    // Processar resposta da IA
    const responseContent = response.content[0].text;
    if (!responseContent) {
      throw new Error("Resposta vazia da IA");
    }
    
    try {
      // Extrair apenas o JSON da resposta, removendo qualquer texto adicional
      let jsonString = responseContent;
      const jsonStartIndex = responseContent.indexOf('[');
      const jsonEndIndex = responseContent.lastIndexOf(']') + 1;
      
      if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
        jsonString = responseContent.substring(jsonStartIndex, jsonEndIndex);
      }
      
      const productsArray = JSON.parse(jsonString);
      
      if (productsArray.length === 0) {
        console.log("[PDF-AI-Pipeline] Nenhum produto identificado na página", pageNumber);
        return [];
      }
      
      // Processar e enriquecer os produtos
      return productsArray.map((product: any) => ({
        ...product,
        pageNumber,
        imageUrl: `data:image/jpeg;base64,${base64Image}`
      }));
    } catch (parseError) {
      console.error("Erro ao analisar resposta JSON do Claude:", parseError);
      console.log("Resposta original:", responseContent);
      throw new Error(`Erro ao processar resposta da IA alternativa: ${parseError.message}`);
    }
  } catch (error) {
    console.error("Erro no processamento com Claude:", error);
    throw error;
  }
}