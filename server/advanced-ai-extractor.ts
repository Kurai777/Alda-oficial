/**
 * Extrator avançado de produtos usando OpenAI GPT-4o Vision
 * 
 * Este módulo implementa funções para processar imagens de catálogos
 * e extrair informações detalhadas sobre produtos usando IA multimodal.
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { ExtractedProduct } from './pdf-ai-pipeline';

// Inicializar o cliente da OpenAI
// O modelo mais recente da OpenAI é "gpt-4o" que foi lançado em 13 de maio de 2024
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
): Promise<ExtractedProduct[]> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('A chave de API da OpenAI não está configurada');
    }

    console.log(`Processando imagem ${filename} com OpenAI...`);

    // Preparar o sistema de prompt
    const systemPrompt = `
      Você é um assistente especializado em extrair informações de produtos de imagens de catálogos de móveis.
      
      Analise cuidadosamente a imagem fornecida e extraia todos os produtos de móveis visíveis, incluindo:
      
      1. Nome do produto
      2. Código do produto (se visível, geralmente um código alfanumérico)
      3. Descrição (incluindo características, materiais, etc.)
      4. Preço (formatado como "R$ XX.XXX,XX")
      5. Categoria do produto
      6. Dimensões (altura, largura, profundidade em cm)
      7. Cores disponíveis
      8. Materiais
      
      Retorne os resultados em formato JSON estruturado como um array de objetos, cada um representando um produto.
    `;

    // Garantir que a string base64 esteja no formato correto
    const base64ForOpenAI = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // Chamar a API da OpenAI com a imagem
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extraia todos os produtos desta imagem de catálogo conforme as instruções."
            },
            {
              type: "image_url",
              image_url: {
                url: base64ForOpenAI,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });

    // Extrair a resposta JSON
    const responseText = response.choices[0].message.content || '{"produtos": []}';
    let products: ExtractedProduct[] = [];

    try {
      const parsedResponse = JSON.parse(responseText);
      
      if (Array.isArray(parsedResponse)) {
        // Se já for um array
        products = parsedResponse;
      } else if (parsedResponse.produtos && Array.isArray(parsedResponse.produtos)) {
        // Se estiver em uma propriedade "produtos"
        products = parsedResponse.produtos;
      } else if (parsedResponse.products && Array.isArray(parsedResponse.products)) {
        // Se estiver em uma propriedade "products"
        products = parsedResponse.products;
      } else {
        // Tentar extrair qualquer array do objeto
        const possibleArrays = Object.values(parsedResponse).filter(val => Array.isArray(val));
        if (possibleArrays.length > 0) {
          products = possibleArrays[0] as ExtractedProduct[];
        }
      }
      
      console.log(`Extraídos ${products.length} produtos da imagem ${filename}`);
      
    } catch (error) {
      console.error('Erro ao extrair JSON da resposta da OpenAI:', error);
      console.log('Resposta original:', responseText);
      products = [];
    }

    return products;
    
  } catch (error) {
    console.error('Erro ao processar imagem com OpenAI:', error);
    return [];
  }
}

/**
 * Processa um arquivo de imagem ou PDF para extrair produtos
 * @param filePath Caminho para o arquivo ou buffer do arquivo
 * @param fileName Nome do arquivo
 * @param userId ID do usuário (REMOVER?)
 * @param catalogId ID do catálogo (REMOVER?)
 * @returns Lista de produtos extraídos (sem URL de imagem definida aqui)
 */
export async function processFileWithAdvancedAI(
  filePath: string | Buffer,
  fileName: string,
  userId: string, // Manter por enquanto para compatibilidade, mas não usado
  catalogId: string // Manter por enquanto para compatibilidade, mas não usado
): Promise<ExtractedProduct[]> {
  try {
    console.log(`Processando arquivo com IA Avançada: ${fileName}`);
    
    let fileBuffer: Buffer;
    if (Buffer.isBuffer(filePath)) {
      fileBuffer = filePath;
    } else {
      // Ler do caminho se não for buffer
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado em: ${filePath}`);
      }
      fileBuffer = await fs.promises.readFile(filePath);
    }
    
    // Converter para base64 para enviar para a API de visão
    const base64Image = fileBuffer.toString('base64');
    
    // Usar o modelo de visão para extrair produtos
    const extractedProducts = await processImageWithOpenAI(base64Image, fileName);
    
    console.log(`Extração IA avançada completa: ${extractedProducts.length} produtos encontrados para ${fileName}`);
    // Retornar apenas os produtos extraídos
    return extractedProducts;
    
  } catch (error) {
    console.error(`Erro ao processar arquivo ${fileName} com IA avançada:`, error);
    // Retornar array vazio em caso de erro
    return []; 
  }
}