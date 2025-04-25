/**
 * Extrator avançado de produtos usando OpenAI GPT-4o Vision
 * 
 * Este módulo implementa funções para processar imagens de catálogos
 * e extrair informações detalhadas sobre produtos usando IA multimodal.
 */

import OpenAI from "openai";
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ExcelProduct } from './excel-processor';
import { formatProductPrice, extractDimensionsFromString, determineProductCategory, extractMaterialsFromDescription } from './utils';
import { saveImageToFirebaseStorage } from './firebase-admin';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Inicializar cliente OpenAI
// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Processa uma imagem com OpenAI Vision para extrair produtos
 * @param imageBase64 Imagem em formato base64
 * @param filename Nome do arquivo (para identificação)
 * @returns Lista de produtos extraídos
 */
export async function processImageWithOpenAI(
  imageBase64: string, 
  filename: string
): Promise<ExcelProduct[]> {
  console.log(`Processando imagem ${filename} com OpenAI Vision...`);
  
  try {
    // Verificar se é uma string base64 completa ou apenas os dados
    const base64Data = imageBase64.startsWith('data:') 
      ? imageBase64 
      : `data:image/jpeg;base64,${imageBase64}`;
    
    // Sistema de instruções específico para catálogos de móveis
    const systemPrompt = `Você é um assistente especializado em extrair informações detalhadas de catálogos de móveis.
    
    Analise cuidadosamente esta imagem de catálogo de móveis. Identifique e extraia informações sobre TODOS os produtos visíveis, com os seguintes detalhes:
    
    1. Nome do produto
    2. Código/referência do produto (se visível)
    3. Descrição detalhada
    4. Preço (no formato brasileiro R$ X.XXX,XX)
    5. Dimensões (largura x altura x profundidade em cm)
    6. Materiais
    7. Cores disponíveis
    8. Categoria do móvel
    
    Formate sua resposta como um array JSON de produtos. Não omita nenhum produto visível.`;
    
    // Chamada à API do OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analise esta imagem de catálogo de móveis e extraia todos os produtos visíveis com seus detalhes completos em formato JSON. Inclua informações como nome, código, descrição, preço, dimensões, materiais, cores e categoria para cada produto."
            },
            {
              type: "image_url",
              image_url: {
                url: base64Data
              }
            }
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.2, // Valor baixo para maior precisão na extração factual
    });
    
    // Obter o conteúdo da resposta
    const content = response.choices[0].message.content;
    
    if (!content) {
      console.error("OpenAI retornou resposta vazia");
      return [];
    }
    
    try {
      // Converter o JSON para objeto
      const parsedResponse = JSON.parse(content);
      
      // Extração adaptativa - suporta diferentes formatos de resposta
      let extractedProducts = [];
      
      // Formato 1: { "produtos": [...] }
      if (parsedResponse.produtos && Array.isArray(parsedResponse.produtos)) {
        extractedProducts = parsedResponse.produtos;
      }
      // Formato 2: { "products": [...] }
      else if (parsedResponse.products && Array.isArray(parsedResponse.products)) {
        extractedProducts = parsedResponse.products;
      }
      // Formato 3: { "items": [...] }
      else if (parsedResponse.items && Array.isArray(parsedResponse.items)) {
        extractedProducts = parsedResponse.items;
      }
      // Formato 4: Array direto [...]
      else if (Array.isArray(parsedResponse)) {
        extractedProducts = parsedResponse;
      }
      // Outro formato - tentar extrair array
      else {
        // Procurar primeira propriedade que seja um array
        const arrayProps = Object.entries(parsedResponse)
          .filter(([_, value]) => Array.isArray(value))
          .map(([key, value]) => ({ key, length: (value as any[]).length }))
          .sort((a, b) => b.length - a.length);
        
        if (arrayProps.length > 0) {
          extractedProducts = parsedResponse[arrayProps[0].key];
        } else {
          console.error("Formato de resposta não reconhecido:", parsedResponse);
          return [];
        }
      }
      
      // Normalizar produtos para o formato padrão do sistema
      const normalizedProducts = extractedProducts.map((product: any, index: number) => {
        // Mapeamento adaptativo de campos
        const nome = product.nome || product.name || product.título || product.title || `Produto ${index + 1}`;
        const codigo = product.codigo || product.code || product.referência || product.reference || `GPT-${index + 1}`;
        const descricao = product.descricao || product.descrição || product.description || '';
        const preco = product.preco || product.preço || product.price || 0;
        
        // Extrair dimensões
        const dimensoesStr = product.dimensoes || product.dimensões || product.dimensions || '';
        const dimensoes = extractDimensionsFromString(dimensoesStr);
        
        // Processar cores e materiais
        const cores = product.cores || product.colors || [];
        const materiais = product.materiais || product.materials || [];
        
        // Categoria
        const categoria = product.categoria || product.category || 
                         determineProductCategory(nome, descricao);
        
        // Normalizar para o formato de ExcelProduct
        return {
          nome,
          codigo,
          descricao,
          preco: formatProductPrice(preco),
          categoria,
          cores: Array.isArray(cores) ? cores : [cores].filter(Boolean),
          materiais: Array.isArray(materiais) ? materiais : [materiais].filter(Boolean),
          // Adicionar dimensões extraídas, se disponíveis
          ...(dimensoes || {}),
          extractionMethod: 'openai-vision'
        } as ExcelProduct;
      });
      
      console.log(`OpenAI extraiu ${normalizedProducts.length} produtos da imagem`);
      return normalizedProducts;
      
    } catch (parseError) {
      console.error("Erro ao processar resposta da OpenAI:", parseError);
      console.log("Conteúdo da resposta:", content);
      return [];
    }
    
  } catch (error) {
    console.error("Erro ao processar imagem com OpenAI:", error);
    throw new Error(`Falha no processamento com OpenAI: ${error.message}`);
  }
}

/**
 * Processa um arquivo de imagem ou PDF para extrair produtos e suas imagens
 * @param filePath Caminho para o arquivo
 * @param fileName Nome do arquivo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Lista de produtos extraídos com URLs de imagens
 */
export async function processFileWithAdvancedAI(
  filePath: string, 
  fileName: string, 
  userId: number | string, 
  catalogId: number | string
): Promise<ExcelProduct[]> {
  console.log(`Processando arquivo ${fileName} com IA avançada...`);
  
  try {
    // Ler o arquivo
    const fileBuffer = await readFile(filePath);
    const fileBase64 = fileBuffer.toString('base64');
    
    // Usar OpenAI para extrair produtos
    const products = await processImageWithOpenAI(fileBase64, fileName);
    
    // Se não há produtos, retornar lista vazia
    if (!products || products.length === 0) {
      console.warn(`Nenhum produto extraído de ${fileName}`);
      return [];
    }
    
    // Adicionar metadados e associar ao usuário/catálogo
    const enhancedProducts = products.map((product, index) => {
      return {
        ...product,
        userId,
        catalogId,
        // Gerar um código único se não existir
        codigo: product.codigo || `CAT${catalogId}-${index + 1}`,
        // Adicionar data de processamento
        processedAt: new Date().toISOString()
      };
    });
    
    // Se for uma imagem única, associar a imagem diretamente aos produtos
    // Upload da imagem para o Firebase Storage
    const imageFileName = `catalog_${catalogId}_full_image.${path.extname(fileName).slice(1) || 'jpg'}`;
    const imageUrl = await saveImageToFirebaseStorage(
      fileBuffer,
      imageFileName,
      userId.toString(),
      catalogId.toString()
    );
    
    // Associar URL da imagem aos produtos
    if (imageUrl) {
      console.log(`Imagem salva no Firebase: ${imageUrl}`);
      
      // Adicionar URL da imagem a todos os produtos
      return enhancedProducts.map(product => ({
        ...product,
        imageUrl
      }));
    }
    
    // Se o upload falhar, retornar produtos sem imagens
    return enhancedProducts;
    
  } catch (error) {
    console.error(`Erro ao processar arquivo ${fileName}:`, error);
    throw error;
  }
}