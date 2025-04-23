import OpenAI from "openai";
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import pdfConverterWrapper from './pdf-converter-wrapper.js';
import { generateImagesFromPdf } from './alternative-pdf-processor';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';

// Promisified functions
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Configurar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Multimodal AI Extractor - Processador avançado de catálogos que usa GPT-4o para extrair
 * produtos diretamente das imagens do PDF em um único passo
 */
export async function processFileWithAdvancedAI(filePath: string, fileName: string, userId: number, catalogId: number): Promise<any[]> {
  try {
    console.log(`Iniciando processamento avançado do arquivo: ${fileName}`);
    
    // Determinar se é um arquivo PDF ou imagem
    const fileExtension = path.extname(filePath).toLowerCase();
    const isPdf = fileExtension === '.pdf';
    const isFratiniCatalog = fileName.toLowerCase().includes("fratini");
    
    // Caminho para salvar as imagens temporárias
    const tempDir = path.join(process.cwd(), 'uploads', 'temp_advanced_ai');
    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    
    // Array para armazenar produtos extraídos
    let extractedProducts: any[] = [];
    
    if (isPdf) {
      try {
        console.log(`Convertendo PDF para imagens: ${filePath}`);
        
        // Converter PDF para imagens para processamento
        // Primeiro tentar o método wrapper, se falhar, usar o método alternativo
        let pdfImages: Buffer[];
        try {
          pdfImages = await pdfConverterWrapper.convert(filePath, {
            format: 'jpeg',
            quality: 95
          });
        } catch (e) {
          console.log("Método principal falhou, tentando método alternativo para converter PDF");
          pdfImages = await generateImagesFromPdf(filePath);
        }
        
        console.log(`PDF convertido em ${pdfImages.length} imagens`);
        
        // Processar cada página do PDF individualmente
        for (let i = 0; i < pdfImages.length; i++) {
          // Salvar imagem temporariamente
          const tempImagePath = path.join(tempDir, `page_${i+1}.jpg`);
          await writeFile(tempImagePath, pdfImages[i]);
          
          console.log(`Processando página ${i+1} com IA multimodal`);
          const productsFromPage = await extractProductsFromImage(
            tempImagePath, 
            i+1, 
            isFratiniCatalog
          );
          
          if (productsFromPage && productsFromPage.length > 0) {
            // Adicionar os produtos extraídos ao array principal
            extractedProducts = extractedProducts.concat(
              productsFromPage.map(product => ({
                ...product,
                userId,
                catalogId,
                page: i + 1
              }))
            );
            console.log(`Extraídos ${productsFromPage.length} produtos da página ${i+1}`);
          } else {
            console.log(`Nenhum produto encontrado na página ${i+1}`);
          }
        }
      } catch (error) {
        console.error("Erro ao processar PDF:", error);
        throw error;
      }
    } else {
      // Processar arquivo de imagem único
      console.log(`Processando arquivo de imagem com IA multimodal: ${filePath}`);
      const productsFromImage = await extractProductsFromImage(
        filePath, 
        1, 
        isFratiniCatalog
      );
      
      if (productsFromImage && productsFromImage.length > 0) {
        // Adicionar os produtos extraídos ao array principal
        extractedProducts = extractedProducts.concat(
          productsFromImage.map(product => ({
            ...product,
            userId,
            catalogId,
            page: 1
          }))
        );
        console.log(`Extraídos ${productsFromImage.length} produtos da imagem`);
      } else {
        console.log(`Nenhum produto encontrado na imagem`);
      }
    }
    
    // Processar todos os produtos extraídos para garantir o formato adequado
    return processExtractedProducts(extractedProducts, userId, catalogId);
  } catch (error) {
    console.error("Erro no processamento avançado com IA:", error);
    throw error;
  }
}

/**
 * Extrai produtos diretamente de uma imagem usando GPT-4o
 */
async function extractProductsFromImage(imagePath: string, pageNumber: number, isFratiniCatalog: boolean): Promise<any[]> {
  try {
    // Ler a imagem como base64
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Definir o prompt para extração de produtos
    const systemMessage = isFratiniCatalog
      ? `Você é um especialista em extrair informações detalhadas sobre produtos de móveis da marca Fratini.
         Sua tarefa é analisar imagens de páginas de catálogos/tabelas de preço e extrair todos os produtos visíveis.
         
         ESPECIFICAÇÕES DA MARCA FRATINI:
         1. Fratini é uma empresa brasileira de móveis para escritório, especialmente cadeiras, poltronas e banquetas
         2. Os códigos de produtos Fratini geralmente seguem o padrão 1.XXXXX.XX.XXXX onde dígitos do meio indicam cores
         3. Os preços são mostrados em Reais (R$)
         4. Cada produto geralmente tem nome comercial, descrição, códigos de referência, cores e preços
         
         FORMATAÇÃO ESPERADA:
         - Para cada produto visível na imagem, extraia: nome, descrição, código, preço, cores disponíveis e materiais
         - Retorne os dados em formato estruturado JSON
         - Converta os preços para centavos (R$ 750,00 = 75000)
         - Os códigos devem ser extraídos exatamente como aparecem na imagem
         - Não tente adivinhar informações que não estão visíveis na imagem`
      : `Você é um especialista em extrair informações sobre produtos de móveis a partir de imagens de catálogos.
         Sua tarefa é analisar detalhadamente a imagem fornecida e identificar todos os produtos de móveis visíveis.
         
         Para cada produto, forneça as seguintes informações:
         1. Nome completo do produto
         2. Descrição detalhada
         3. Código/referência do produto (se visível)
         4. Preço em formato numérico (converta para centavos, ex: R$ 1.234,56 → 123456)
         5. Categoria (Sofá, Mesa, Cadeira, Estante, Poltrona, etc.)
         6. Materiais utilizados na fabricação
         7. Cores disponíveis
         8. Dimensões (largura, altura, profundidade em cm)
         
         IMPORTANTE:
         - Extraia TODOS os produtos visíveis na imagem, não apenas os mais prominentes
         - Se uma informação não estiver disponível na imagem, use null
         - Não adicione informações que não estejam visíveis na imagem
         - Retorne os dados em formato estruturado JSON`;
    
    // Prompt específico para o usuário
    const userPrompt = isFratiniCatalog
      ? "Analise esta imagem de um catálogo Fratini e extraia TODOS os produtos visíveis com suas informações completas (nome, descrição, código, preço, cores, materiais). Inclua TODOS os produtos mostrados, mesmo que sejam muitos. Não pule nenhum produto visível."
      : "Analise esta imagem de um catálogo de móveis e extraia TODOS os produtos visíveis com todas as informações disponíveis. Inclua TODOS os produtos mostrados na imagem, não apenas os principais. Não pule nenhum item.";
    
    console.log(`Enviando imagem para análise com GPT-4o (Página ${pageNumber})...`);
    
    // Fazer a chamada para a OpenAI com a imagem
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // o modelo mais recente da OpenAI (gpt-4o foi lançado em 13 de maio de 2024, não altere para gpt-4)
      messages: [
        { 
          role: "system", 
          content: systemMessage
        },
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: userPrompt
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
      max_tokens: 4000,
      temperature: 0.1, // Temperatura baixa para maior precisão
      response_format: { type: "json_object" }
    });
    
    // Extrair e processar a resposta
    const responseContent = response.choices[0].message.content || '';
    console.log(`Resposta recebida da OpenAI (tamanho: ${responseContent.length} caracteres)`);
    
    // Tentar analisar a resposta como JSON
    try {
      const parsedResponse = JSON.parse(responseContent);
      
      // Verificar se a resposta contém produtos
      if (parsedResponse && parsedResponse.products && Array.isArray(parsedResponse.products)) {
        const products = parsedResponse.products;
        console.log(`Extraídos ${products.length} produtos da imagem (Página ${pageNumber})`);
        
        // Salvar a imagem base64 em cada produto
        const imagePathForUrl = `data:image/jpeg;base64,${base64Image}`;
        
        // Adicionar atributos especiais a cada produto
        return products.map((product: any) => ({
          ...product,
          imageUrl: imagePathForUrl, // Adicionar a imagem da página
          pageNumber,
          // Garantir que os tipos de dados estejam corretos
          price: typeof product.price === 'number' ? product.price : 
                typeof product.price === 'string' ? parseInt(product.price.replace(/\D/g, '')) : 0,
          colors: Array.isArray(product.colors) ? product.colors : 
                typeof product.colors === 'string' ? [product.colors] : [],
          materials: Array.isArray(product.materials) ? product.materials : 
                    typeof product.materials === 'string' ? [product.materials] : []
        }));
      } else {
        // Estrutura alternativa de resposta: o modelo pode não ter retornado um array em "products"
        // Verificar se a resposta tem uma estrutura diferente mas utilizável
        if (parsedResponse && Array.isArray(parsedResponse)) {
          console.log(`Recebida resposta em formato de array direto com ${parsedResponse.length} produtos`);
          
          // Usar o array diretamente
          const imagePathForUrl = `data:image/jpeg;base64,${base64Image}`;
          
          return parsedResponse.map((product: any) => ({
            ...product,
            imageUrl: imagePathForUrl,
            pageNumber,
            price: typeof product.price === 'number' ? product.price : 
                  typeof product.price === 'string' ? parseInt(product.price.replace(/\D/g, '')) : 0,
            colors: Array.isArray(product.colors) ? product.colors : 
                  typeof product.colors === 'string' ? [product.colors] : [],
            materials: Array.isArray(product.materials) ? product.materials : 
                      typeof product.materials === 'string' ? [product.materials] : []
          }));
        }
        
        console.warn("Resposta da IA não contém array de produtos no formato esperado:", parsedResponse);
        console.log("Resposta original:", responseContent);
        
        // Criar produto único baseado na imagem
        return [{
          name: `Produto da Página ${pageNumber}`,
          description: "Produto extraído automaticamente da imagem do catálogo",
          code: `IMG-${pageNumber}-${Date.now().toString().slice(-5)}`,
          price: 0,
          category: "Não categorizado",
          colors: [],
          materials: [],
          sizes: [],
          imageUrl: `data:image/jpeg;base64,${base64Image}`,
          pageNumber
        }];
      }
    } catch (parseError) {
      console.error("Erro ao analisar resposta JSON da IA:", parseError);
      console.log("Conteúdo da resposta:", responseContent);
      
      // Retornar um produto básico com a imagem
      return [{
        name: `Produto da Página ${pageNumber}`,
        description: "Produto extraído automaticamente da imagem do catálogo",
        code: `IMG-${pageNumber}-${Date.now().toString().slice(-5)}`,
        price: 0,
        category: "Não categorizado",
        colors: [],
        materials: [],
        sizes: [],
        imageUrl: `data:image/jpeg;base64,${base64Image}`,
        pageNumber
      }];
    }
  } catch (error) {
    console.error("Erro na extração de produtos da imagem:", error);
    throw error;
  }
}

/**
 * Processa produtos extraídos para garantir que estejam no formato esperado pela aplicação
 */
function processExtractedProducts(products: any[], userId: number, catalogId: number): any[] {
  return products.map(product => {
    // Determinar a categoria com base no nome do produto se não estiver definida
    const category = product.category || determineProductCategory(product.name);
    
    // Extrair materiais da descrição se não estiverem definidos
    const materials = Array.isArray(product.materials) && product.materials.length > 0 
      ? product.materials 
      : extractMaterialsFromDescription(product.description);
    
    // Processar dimensões para o formato esperado
    let sizes = product.sizes || [];
    if (!Array.isArray(sizes) && typeof sizes === 'object') {
      // Converter objeto de dimensões para array
      sizes = [sizes];
    } else if (typeof sizes === 'string') {
      // Tentar extrair dimensões de uma string
      const dimensions = extractDimensionsFromString(sizes);
      sizes = dimensions ? [dimensions] : [];
    }
    
    // Retornar o produto no formato esperado
    return {
      userId,
      catalogId,
      name: product.name || "Produto sem nome",
      description: product.description || "",
      code: product.code || `AUTO-${Math.floor(Math.random() * 10000)}`,
      price: typeof product.price === 'number' ? product.price : 0,
      category: category || "Não categorizado",
      colors: Array.isArray(product.colors) ? product.colors : [],
      materials: materials,
      sizes: Array.isArray(sizes) ? sizes : [],
      imageUrl: product.imageUrl || ""
    };
  });
}

/**
 * Extrai dimensões de uma string no formato "LxAxP" ou similar
 */
function extractDimensionsFromString(dimensionString: string): any | null {
  try {
    // Padrões comuns: "120x75x40cm", "L120 x A75 x P40 cm", etc.
    const dimensions = dimensionString.toLowerCase().replace(/\s+/g, '');
    const match = dimensions.match(/(\d+)[x×](\d+)[x×](\d+)/);
    
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        depth: parseInt(match[3]),
        label: dimensionString
      };
    }
    
    // Padrão alternativo: "L: 120cm, A: 75cm, P: 40cm"
    const widthMatch = dimensions.match(/l[:]?(\d+)/);
    const heightMatch = dimensions.match(/a[:]?(\d+)/);
    const depthMatch = dimensions.match(/p[:]?(\d+)/);
    
    if (widthMatch || heightMatch || depthMatch) {
      return {
        width: widthMatch ? parseInt(widthMatch[1]) : null,
        height: heightMatch ? parseInt(heightMatch[1]) : null,
        depth: depthMatch ? parseInt(depthMatch[1]) : null,
        label: dimensionString
      };
    }
    
    return null;
  } catch (error) {
    console.error("Erro ao extrair dimensões:", error);
    return null;
  }
}