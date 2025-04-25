/**
 * Módulo de extração de produtos com Anthropic Claude Vision
 * 
 * Este módulo implementa funções para extrair informações de produtos
 * a partir de imagens de catálogos usando a API multimodal do Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ExcelProduct } from './excel-processor';
import { formatProductPrice, extractDimensionsFromString, determineProductCategory } from './utils';

const readFile = promisify(fs.readFile);

// Inicializar cliente Anthropic
// the newest Anthropic model is "claude-3-7-sonnet-20250219" which was released February 24, 2025
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Converte uma imagem para base64
 * @param imagePath Caminho para a imagem
 * @returns String base64 da imagem
 */
async function imageToBase64(imagePath: string): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  return imageBuffer.toString('base64');
}

/**
 * Processa uma imagem com Claude Vision para extrair produtos
 * @param imagePathOrBase64 Caminho para a imagem ou string base64
 * @param filename Nome do arquivo para referência
 * @param userId ID do usuário para associar
 * @param catalogId ID do catálogo para associar
 * @param pageNumber Número da página (opcional)
 * @returns Array de produtos extraídos
 */
export async function processImageWithClaude(
  imagePathOrBase64: string,
  filename: string,
  userId: number | string,
  catalogId: number | string,
  pageNumber?: number
): Promise<ExcelProduct[]> {
  console.log(`Processando imagem ${filename} (página ${pageNumber || 'desconhecida'}) com Claude...`);
  
  try {
    // Converter imagem para base64 se for um caminho de arquivo
    let base64Image = imagePathOrBase64;
    if (imagePathOrBase64.startsWith('/') || imagePathOrBase64.includes('\\')) {
      base64Image = await imageToBase64(imagePathOrBase64);
    }
    
    // Instruções específicas para Claude analisar catálogos de móveis
    const systemPrompt = `Você é um assistente especializado em extrair informações detalhadas de catálogos de móveis.
    
    Ao analisar esta imagem de catálogo, extraia TODOS os produtos visíveis com seus detalhes:
    
    1. Nome do produto
    2. Código do produto (se disponível) 
    3. Descrição completa
    4. Preço (formato brasileiro, como "R$ 1.299,00")
    5. Dimensões no formato LxAxP (largura x altura x profundidade) em cm
    6. Materiais (madeira, metal, tecido, vidro, etc.)
    7. Cores disponíveis
    8. Categoria do móvel
    
    Formate sua resposta como um array JSON de produtos. Inclua TODOS os produtos visíveis na imagem.
    
    Exemplo:
    [
      {
        "nome": "Sofá Reclinável Berlin",
        "codigo": "SR-2024",
        "descricao": "Sofá reclinável de 3 lugares em tecido suede com estrutura em madeira maciça",
        "preco": "R$ 3.499,90",
        "dimensoes": "220x95x100 cm",
        "materiais": ["Madeira", "Tecido", "Metal"],
        "cores": ["Cinza", "Bege"],
        "categoria": "Sofás"
      },
      {
        "nome": "Mesa de Centro Oslo",
        "codigo": "MC-105",
        "descricao": "Mesa de centro retangular com tampo de vidro e estrutura em metal preto",
        "preco": "R$ 899,90",
        "dimensoes": "120x45x60 cm",
        "materiais": ["Vidro", "Metal"],
        "cores": ["Preto"],
        "categoria": "Mesas"
      }
    ]
    
    Certifique-se de que toda a informação extraída seja baseada exclusivamente no que está visível na imagem.`;
    
    // Chamada à API do Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Esta é uma página de catálogo de móveis. Extraia TODOS os produtos visíveis com seus detalhes completos.'
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image
              }
            }
          ],
        }
      ],
    });
    
    // Extrair o conteúdo da resposta
    const content = response.content[0].text;
    
    // Processar e limpar a resposta para extrair o JSON
    const jsonContent = extractJsonFromResponse(content);
    
    if (!jsonContent) {
      console.error('Não foi possível extrair JSON da resposta do Claude:', content);
      return [];
    }
    
    try {
      // Converter para objeto
      const extractedProducts = JSON.parse(jsonContent) as any[];
      
      // Normalizar produtos para o formato padrão do sistema
      const normalizedProducts = extractedProducts.map((product, index) => {
        // Extrair dimensões da string se disponível
        const dimensions = product.dimensoes ? 
          extractDimensionsFromString(product.dimensoes) : null;
        
        // Normalizar formato
        return {
          nome: product.nome || `Produto em Catálogo ${index + 1}`,
          codigo: product.codigo || `CAT${catalogId}-P${pageNumber || 1}-${index + 1}`,
          descricao: product.descricao || '',
          preco: formatProductPrice(product.preco || 0),
          categoria: product.categoria || determineProductCategory(product.nome, product.descricao),
          materiais: Array.isArray(product.materiais) ? product.materiais : 
                     typeof product.materiais === 'string' ? [product.materiais] : [],
          cores: Array.isArray(product.cores) ? product.cores : 
                 typeof product.cores === 'string' ? [product.cores] : [],
          // Adicionar dimensões se disponíveis
          ...(dimensions || {}),
          // Metadados
          userId,
          catalogId,
          pageNumber: pageNumber || 1,
          processedAt: new Date().toISOString(),
          extractionMethod: 'claude-vision'
        } as ExcelProduct;
      });
      
      console.log(`Claude extraiu ${normalizedProducts.length} produtos da imagem`);
      return normalizedProducts;
      
    } catch (parseError) {
      console.error('Erro ao analisar JSON da resposta do Claude:', parseError);
      console.log('Conteúdo que falhou:', jsonContent);
      return [];
    }
    
  } catch (error) {
    console.error('Erro ao processar imagem com Claude:', error);
    throw error;
  }
}

/**
 * Tenta extrair um JSON válido da resposta textual do Claude
 * @param response Resposta do Claude
 * @returns String JSON limpa ou null
 */
function extractJsonFromResponse(response: string): string | null {
  // Tentar extrair conteúdo entre colchetes para JSON de array
  const arrayMatch = response.match(/\[\s*\{[^]*\}\s*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }
  
  // Tentar extrair conteúdo entre chaves para JSON de objeto
  const objectMatch = response.match(/\{\s*"[^]*"\s*:\s*[^]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }
  
  // Procurar conteúdo dentro de blocos de código
  const codeBlockMatch = response.match(/```(?:json)?\n([^]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  return null;
}