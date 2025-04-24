/**
 * Pipeline completo para processamento automático de catálogos PDF
 * Combina PDF2Image, PaddleOCR e GPT-4o/Claude para extrair produtos
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateImagesFromPdf } from './alternative-pdf-processor';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

// Função para extrair dimensões de uma string "LxAxP"
function extractDimensionsFromString(dimensionString: string): any | null {
  // Padrões comuns para dimensões: 
  // - 100x50x30 (LxAxP)
  // - L: 100 x A: 50 x P: 30
  // - largura 100 altura 50 profundidade 30
  
  try {
    // Limpar string
    const cleanString = dimensionString.toLowerCase().trim();
    
    // Padrão simples: 000x000x000
    const simplePattern = /(\d+)[^\d]*x[^\d]*(\d+)[^\d]*x[^\d]*(\d+)/;
    const simpleMatch = cleanString.match(simplePattern);
    
    if (simpleMatch) {
      return {
        width: parseInt(simpleMatch[1]),
        height: parseInt(simpleMatch[2]),
        depth: parseInt(simpleMatch[3])
      };
    }
    
    // Padrão com letras: L 000 x A 000 x P 000
    const labeledPattern = /l[^\d]*(\d+)[^\d]*a[^\d]*(\d+)[^\d]*p[^\d]*(\d+)/;
    const labeledMatch = cleanString.match(labeledPattern);
    
    if (labeledMatch) {
      return {
        width: parseInt(labeledMatch[1]),
        height: parseInt(labeledMatch[2]),
        depth: parseInt(labeledMatch[3])
      };
    }
    
    // Palavras-chave
    const hasDimensions = cleanString.includes('cm') || 
                         cleanString.includes('largura') || 
                         cleanString.includes('altura') || 
                         cleanString.includes('profundidade');
    
    if (hasDimensions) {
      const width = extractNumberAfterKeyword(cleanString, ['largura', 'larg', 'l:']);
      const height = extractNumberAfterKeyword(cleanString, ['altura', 'alt', 'a:']);
      const depth = extractNumberAfterKeyword(cleanString, ['profundidade', 'prof', 'p:']);
      
      if (width || height || depth) {
        return {
          width,
          height,
          depth
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error("Erro ao extrair dimensões:", error);
    return null;
  }
}

function extractNumberAfterKeyword(text: string, keywords: string[]): number | null {
  for (const keyword of keywords) {
    const regex = new RegExp(keyword + '[^\\d]*(\\d+)', 'i');
    const match = text.match(regex);
    
    if (match) {
      return parseInt(match[1]);
    }
  }
  
  return null;
}

// Inicializar OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Inicializar Anthropic API
// the newest Anthropic model is "claude-3-7-sonnet-20250219" which was released February 24, 2025
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const execAsync = promisify(exec);

/**
 * Pipeline completo para processamento automático de catálogos PDF
 * Combina PDF2Image, PaddleOCR e GPT-4o/Claude para extrair produtos
 * 
 * @param filePath Caminho do arquivo PDF do catálogo
 * @param fileName Nome do arquivo do catálogo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo no banco local
 * @returns Array de produtos extraídos e processados
 */
export async function processCatalogWithAutomatedPipeline(
  filePath: string, 
  fileName: string,
  userId: number,
  catalogId: number
): Promise<any[]> {
  console.log("Iniciando pipeline automatizado de processamento de catálogo");
  console.log(`Arquivo: ${filePath}`);

  // Definir diretório temporário para armazenar imagens e arquivos intermediários
  const tempDir = path.join(process.cwd(), 'uploads', 'temp', `catalog_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Passo 1: Converter PDF para imagens
    console.log("Passo 1: Convertendo PDF para imagens...");
    const pdfImages = await generateImagesFromPdf(filePath, {
      width: 1600,
      height: 2000,
      pagesToProcess: null // Processar todas as páginas
    });

    console.log(`Geradas ${pdfImages.length} imagens a partir do PDF`);
    
    // Salvar imagens para processamento
    const imageFiles = [];
    for (let i = 0; i < pdfImages.length; i++) {
      const outputPath = path.join(tempDir, `page_${i + 1}.jpg`);
      fs.writeFileSync(outputPath, pdfImages[i]);
      imageFiles.push({
        page: i + 1,
        path: outputPath
      });
    }

    // Passo 2: Executar PaddleOCR nas imagens para extrair texto e posições
    console.log("Passo 2: Executando PaddleOCR para extrair texto...");
    // Primeiro, verificar se o script Python está disponível
    const pythonScriptPath = path.join(process.cwd(), 'server', 'paddle_ocr_extractor.py');
    
    if (!fs.existsSync(pythonScriptPath)) {
      throw new Error("Script PaddleOCR não encontrado: " + pythonScriptPath);
    }

    // Percorrer primeiras 5 páginas para análise (para limitar o tempo de processamento)
    const pagesToProcess = Math.min(imageFiles.length, 5);
    const allPageResults = [];
    
    for (let i = 0; i < pagesToProcess; i++) {
      const imagePath = imageFiles[i].path;
      const pageNum = imageFiles[i].page;
      console.log(`Processando imagem ${i+1}/${pagesToProcess} (página ${pageNum})...`);
      
      const outputJsonPath = path.join(tempDir, `page_${pageNum}_ocr.json`);
      
      // Executar script Python para OCR
      try {
        const { stdout, stderr } = await execAsync(
          `python ${pythonScriptPath} ${imagePath} ${outputJsonPath}`
        );
        
        if (stderr && !stderr.includes('Loaded') && !stderr.includes('Warning')) {
          console.warn("Avisos do OCR:", stderr);
        }
        
        // Verificar se o arquivo JSON foi criado
        if (fs.existsSync(outputJsonPath)) {
          const ocrResults = JSON.parse(fs.readFileSync(outputJsonPath, 'utf8'));
          
          // Adicionar resultados da página
          allPageResults.push({
            page: pageNum,
            imagePath,
            ocrResults
          });
          
          console.log(`OCR extraiu ${ocrResults.length} produtos da página ${pageNum}`);
        } else {
          console.warn(`OCR não gerou resultados para a página ${pageNum}`);
        }
      } catch (ocrError: any) {
        console.error(`Erro ao executar OCR na página ${pageNum}:`, ocrError);
      }
    }
    
    // Passo 3: Processar resultados OCR com IA para estruturar produtos
    console.log("Passo 3: Processando resultados OCR com IA...");
    
    // Tentar primeiro com OpenAI GPT-4o
    try {
      const products = await processOcrResultsWithAI(allPageResults, fileName, userId, catalogId);
      
      if (products && products.length > 0) {
        console.log(`GPT-4o extraiu ${products.length} produtos do catálogo`);
        return products;
      } else {
        throw new Error("Nenhum produto extraído com GPT-4o");
      }
    } catch (openaiError: any) {
      console.error("Erro no processamento com GPT-4o:", openaiError);
      console.log("Tentando com Claude como alternativa...");
      
      // Tentar com Claude como alternativa
      try {
        const products = await processOcrResultsWithAlternativeAI(allPageResults, fileName, userId, catalogId);
        
        if (products && products.length > 0) {
          console.log(`Claude extraiu ${products.length} produtos do catálogo`);
          return products;
        } else {
          throw new Error("Nenhum produto extraído com Claude");
        }
      } catch (claudeError: any) {
        console.error("Erro no processamento com Claude:", claudeError);
        throw new Error("Falha em extrair produtos usando ambos modelos de IA");
      }
    }
    
  } catch (error: any) {
    console.error("Erro no pipeline de processamento de catálogo:", error);
    throw error;
  } finally {
    // Limpar diretório temporário após o processamento
    try {
      // Comentado por enquanto para depuração
      // fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`Arquivos temporários mantidos em: ${tempDir}`);
    } catch (cleanupError: any) {
      console.error("Erro ao limpar diretório temporário:", cleanupError);
    }
  }
}

/**
 * Processa resultados OCR com OpenAI GPT-4o
 */
async function processOcrResultsWithAI(
  pageResults: Array<{page: number, imagePath: string, ocrResults: any[]}>,
  fileName: string,
  userId: number,
  catalogId: number
): Promise<any[]> {
  const allProducts = [];
  
  // Preparar prompt com contexto e instruções
  const promptPrefix = `
Você é um especialista em extração de informações de catálogos de móveis e decoração.
Analise os dados OCR extraídos das páginas de um catálogo de móveis e extraia todos os produtos presentes.

O formato dos dados OCR é um array de produtos potenciais, onde cada produto contém:
- texto: texto extraído via OCR
- categoria: categoria detectada do produto (se houver)
- é_preço: se o texto parece ser um preço
- é_código: se o texto parece ser um código de produto
- cores: possíveis cores mencionadas
- materiais: possíveis materiais mencionados

Sua tarefa:
1. Analise os blocos de texto extraídos
2. Identifique produtos distintos
3. Para cada produto, extraia:
   - nome: nome completo do produto
   - descricao: descrição/detalhes do produto
   - codigo: código comercial do produto (se disponível, ou "UNKNOWN-CODE")
   - preco: preço em formato numérico (sem R$ ou outros símbolos)
   - categoria: categoria do produto (sofá, cadeira, mesa, etc.)
   - cores: array de cores disponíveis
   - materiais: array de materiais
   - dimensoes: objeto com largura, altura, profundidade (quando disponível)

Responda apenas com um array JSON de produtos. Não inclua qualquer outro texto.
`;

  // Processar no máximo 3 páginas para limitar o tamanho da requisição
  const maxPagesToProcess = Math.min(pageResults.length, 3);
  
  for (let i = 0; i < maxPagesToProcess; i++) {
    const pageData = pageResults[i];
    
    try {
      // Converter a imagem para base64 para multimodal
      const imageBuffer = fs.readFileSync(pageData.imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Preparar dados OCR para o prompt
      const ocrData = JSON.stringify(pageData.ocrResults, null, 2);
      
      // Construir o prompt completo
      const prompt = `
${promptPrefix}

Dados OCR da página ${pageData.page} do catálogo ${fileName}:
${ocrData}

Lembre-se de extrair TODOS os produtos visíveis na imagem, mesmo que os dados OCR estejam incompletos.
`;

      // Fazer chamada para a API OpenAI com o modelo GPT-4o
      // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Você é um assistente especializado na extração de produtos de catálogos." },
          { 
            role: "user", 
            content: [
              { type: "text", text: prompt },
              { 
                type: "image_url", 
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.2,
        response_format: { type: "json_object" }
      });

      // Extrair produtos da resposta
      const jsonContent = response.choices[0].message.content;
      
      if (!jsonContent) {
        console.warn(`IA não retornou conteúdo para a página ${pageData.page}`);
        continue;
      }
      
      try {
        const result = JSON.parse(jsonContent);
        const extractedProducts = result.produtos || result.products || [];
        
        if (extractedProducts && extractedProducts.length > 0) {
          // Processar produtos e adicionar ao resultado final
          const processedProducts = extractedProducts.map((product: any) => ({
            userId,
            catalogId,
            name: product.nome || product.name || "Produto sem nome",
            description: product.descricao || product.description || "",
            code: product.codigo || product.code || "UNKNOWN-CODE",
            price: typeof product.preco === 'number' ? product.preco : 
                  typeof product.price === 'number' ? product.price : 0,
            category: product.categoria || product.category || "Outros",
            colors: Array.isArray(product.cores) ? product.cores : 
                   Array.isArray(product.colors) ? product.colors :
                   typeof product.cores === 'string' ? [product.cores] :
                   typeof product.colors === 'string' ? [product.colors] : [],
            materials: Array.isArray(product.materiais) ? product.materiais :
                      Array.isArray(product.materials) ? product.materials :
                      typeof product.materiais === 'string' ? [product.materiais] :
                      typeof product.materials === 'string' ? [product.materials] : [],
            // Processar dimensões
            sizes: processProductDimensions(product),
            imageUrl: `data:image/jpeg;base64,${base64Image}`,
            page: pageData.page
          }));
          
          allProducts.push(...processedProducts);
          console.log(`Extraídos ${processedProducts.length} produtos da página ${pageData.page}`);
        } else {
          console.warn(`Nenhum produto extraído da página ${pageData.page}`);
        }
      } catch (jsonError: any) {
        console.error(`Erro ao processar JSON da página ${pageData.page}:`, jsonError);
      }
    } catch (pageError: any) {
      console.error(`Erro ao processar página ${pageData.page}:`, pageError);
    }
  }
  
  // Verificar resultados
  if (allProducts.length === 0) {
    throw new Error("Nenhum produto extraído do catálogo");
  }
  
  return allProducts;
}

/**
 * Processa resultados OCR com Claude (modelo alternativo)
 */
async function processOcrResultsWithAlternativeAI(
  pageResults: Array<{page: number, imagePath: string, ocrResults: any[]}>,
  fileName: string,
  userId: number,
  catalogId: number
): Promise<any[]> {
  const allProducts = [];
  
  // Preparar prompt com contexto e instruções
  const promptPrefix = `
Você é um assistente especializado em extrair informações de catálogos de móveis.
Analise os dados OCR extraídos de uma página de catálogo e identifique todos os produtos presentes.

Os dados OCR contêm blocos de texto extraídos da imagem, com as seguintes informações:
- texto: texto extraído via OCR
- categoria: categoria potencial do produto
- é_preço: indicador se o texto parece ser um preço
- é_código: indicador se o texto parece ser um código de produto
- cores: possíveis cores mencionadas
- materiais: possíveis materiais mencionados

Para cada produto na imagem, extraia:
- nome: nome completo do produto
- descricao: descrição do produto
- codigo: código do produto (se disponível, ou "UNKNOWN-CODE")
- preco: preço em formato numérico
- categoria: categoria do produto (sofá, mesa, cadeira, etc.)
- cores: array de cores disponíveis
- materiais: array de materiais
- dimensoes: objeto com largura, altura, profundidade (quando disponível)

Responda com um objeto JSON contendo um array 'produtos'. Não inclua explicações adicionais.
`;

  // Processar no máximo 3 páginas para limitar o tamanho da requisição
  const maxPagesToProcess = Math.min(pageResults.length, 3);
  
  for (let i = 0; i < maxPagesToProcess; i++) {
    const pageData = pageResults[i];
    
    try {
      // Converter a imagem para base64 para multimodal
      const imageBuffer = fs.readFileSync(pageData.imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Preparar dados OCR para o prompt
      const ocrData = JSON.stringify(pageData.ocrResults, null, 2);
      
      // Construir o prompt completo
      const prompt = `
${promptPrefix}

Dados OCR da página ${pageData.page} do catálogo ${fileName}:
${ocrData}

Além dos dados OCR, use a imagem anexada para identificar TODOS os produtos visíveis.
`;

      // Fazer chamada para a API Claude
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 4000,
        temperature: 0.2,
        system: "Você é um assistente especializado na extração de produtos de catálogos de móveis.",
        messages: [
          { 
            role: "user", 
            content: [
              { type: "text", text: prompt },
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
        ]
      });

      // Extrair produtos da resposta
      // Tratamento especial para os diferentes tipos de blocos de conteúdo na resposta Claude
      let responseContent = "";
      
      if (response.content && response.content.length > 0) {
        // Verificar o tipo de conteúdo
        const contentBlock = response.content[0];
        if ('text' in contentBlock) {
          responseContent = contentBlock.text;
        } else {
          // Se for outro tipo de bloco de conteúdo, tentar obter alguma string útil
          responseContent = JSON.stringify(contentBlock);
        }
      }
      
      if (!responseContent) {
        console.warn(`Claude não retornou conteúdo para a página ${pageData.page}`);
        continue;
      }
      
      try {
        // Tentar extrair JSON válido da resposta
        let jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                       responseContent.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, responseContent];
                       
        let jsonContent = jsonMatch[1] || responseContent;
        
        // Remover possíveis caracteres inválidos JSON
        jsonContent = jsonContent.trim();
        
        // Analisar JSON
        const result = JSON.parse(jsonContent);
        const extractedProducts = result.produtos || result.products || [];
        
        if (extractedProducts && extractedProducts.length > 0) {
          // Processar produtos e adicionar ao resultado final
          const processedProducts = extractedProducts.map((product: any) => ({
            userId,
            catalogId,
            name: product.nome || product.name || "Produto sem nome",
            description: product.descricao || product.description || "",
            code: product.codigo || product.code || "UNKNOWN-CODE",
            price: typeof product.preco === 'number' ? product.preco : 
                  typeof product.price === 'number' ? product.price : 0,
            category: product.categoria || product.category || "Outros",
            colors: Array.isArray(product.cores) ? product.cores : 
                   Array.isArray(product.colors) ? product.colors :
                   typeof product.cores === 'string' ? [product.cores] :
                   typeof product.colors === 'string' ? [product.colors] : [],
            materials: Array.isArray(product.materiais) ? product.materiais :
                      Array.isArray(product.materials) ? product.materials :
                      typeof product.materiais === 'string' ? [product.materiais] :
                      typeof product.materials === 'string' ? [product.materials] : [],
            // Processar dimensões
            sizes: processProductDimensions(product),
            imageUrl: `data:image/jpeg;base64,${base64Image}`,
            page: pageData.page
          }));
          
          allProducts.push(...processedProducts);
          console.log(`Claude extraiu ${processedProducts.length} produtos da página ${pageData.page}`);
        } else {
          console.warn(`Nenhum produto extraído por Claude da página ${pageData.page}`);
        }
      } catch (jsonError: any) {
        console.error(`Erro ao processar JSON da resposta do Claude para página ${pageData.page}:`, jsonError);
        console.error("Resposta recebida:", responseContent.substring(0, 500) + "...");
      }
    } catch (pageError: any) {
      console.error(`Erro ao processar página ${pageData.page} com Claude:`, pageError);
    }
  }
  
  // Verificar resultados
  if (allProducts.length === 0) {
    throw new Error("Nenhum produto extraído do catálogo pelo Claude");
  }
  
  return allProducts;
}

/**
 * Processa as dimensões do produto a partir de diferentes formatos de input
 */
function processProductDimensions(product: any): Array<{name: string, value: string}> {
  const sizes = [];
  
  // Verificar se temos dimensões como objeto
  if (product.dimensoes || product.dimensions) {
    const dimensions = product.dimensoes || product.dimensions;
    
    // Caso 1: Objeto com propriedades específicas
    if (typeof dimensions === 'object' && dimensions !== null) {
      // Largura
      if (dimensions.largura || dimensions.width) {
        sizes.push({
          name: 'Largura',
          value: `${dimensions.largura || dimensions.width}`
        });
      }
      
      // Altura
      if (dimensions.altura || dimensions.height) {
        sizes.push({
          name: 'Altura',
          value: `${dimensions.altura || dimensions.height}`
        });
      }
      
      // Profundidade
      if (dimensions.profundidade || dimensions.depth) {
        sizes.push({
          name: 'Profundidade',
          value: `${dimensions.profundidade || dimensions.depth}`
        });
      }
    } 
    // Caso 2: String com formato "LxAxP"
    else if (typeof dimensions === 'string') {
      const extracted = extractDimensionsFromString(dimensions);
      
      if (extracted) {
        if (extracted.width) {
          sizes.push({
            name: 'Largura',
            value: `${extracted.width}`
          });
        }
        
        if (extracted.height) {
          sizes.push({
            name: 'Altura',
            value: `${extracted.height}`
          });
        }
        
        if (extracted.depth) {
          sizes.push({
            name: 'Profundidade',
            value: `${extracted.depth}`
          });
        }
      }
    }
  }
  
  // Caso 3: Dimensões em campos separados
  else {
    // Largura
    if (product.largura || product.width) {
      sizes.push({
        name: 'Largura',
        value: `${product.largura || product.width}`
      });
    }
    
    // Altura
    if (product.altura || product.height) {
      sizes.push({
        name: 'Altura',
        value: `${product.altura || product.height}`
      });
    }
    
    // Profundidade
    if (product.profundidade || product.depth) {
      sizes.push({
        name: 'Profundidade',
        value: `${product.profundidade || product.depth}`
      });
    }
  }
  
  return sizes;
}