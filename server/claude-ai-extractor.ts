/**
 * Extrator de produtos usando Claude da Anthropic
 * 
 * Este módulo contém funções para processar imagens de catálogos
 * e extrair informações detalhadas sobre produtos usando o modelo Claude
 * da Anthropic.
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { saveImageToFirebaseStorage } from './firebase-admin';
import { ExtractedProduct } from './pdf-ai-pipeline';

// Inicializar o cliente da Anthropic
// O novo modelo da Anthropic é "claude-3-7-sonnet-20250219"
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

/**
 * Processa uma imagem com Claude para extrair produtos
 * @param imageBuffer Buffer da imagem
 * @param filename Nome do arquivo (para identificação)
 * @param userId ID do usuário
 * @param catalogId ID do catálogo 
 * @param pageNumber Número da página
 * @returns Lista de produtos extraídos
 */
export async function processImageWithClaude(
  imageBuffer: Buffer,
  filename: string,
  userId: string,
  catalogId: string,
  pageNumber?: number
): Promise<ExtractedProduct[]> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('A chave de API da Anthropic não está configurada');
    }

    console.log(`Processando imagem ${filename} com Claude...`);

    // Converter buffer para base64
    const base64Image = imageBuffer.toString('base64');

    // Fazer upload da imagem para o Firebase Storage
    const imageUrl = await saveImageToFirebaseStorage(
      imageBuffer,
      `page_${pageNumber || 1}_${filename}`,
      userId,
      catalogId
    );

    // Preparar o prompt para o Claude
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
      
      Formato da resposta:
      [
        {
          "nome": "Nome do produto",
          "codigo": "CÓDIGO-PRODUTO",
          "descricao": "Descrição detalhada",
          "preco": "R$ XX.XXX,XX",
          "categoria": "Categoria do produto",
          "dimensoes": {
            "altura": número,
            "largura": número,
            "profundidade": número
          },
          "cores": ["cor1", "cor2", ...],
          "materiais": ["material1", "material2", ...]
        },
        ...
      ]
      
      Apenas devolva o array JSON, sem texto adicional antes ou depois.
      Se não houver produtos visíveis claramente ou você não conseguir extrair informações completas,
      retorne um array vazio [].
    `;

    // Chamar a API do Claude com a imagem
    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: "Extraia todos os produtos desta imagem de catálogo conforme as instruções.",
            },
          ],
        },
      ],
    });

    // Extrair a resposta JSON
    let products: ExtractedProduct[] = [];

    try {
      // Extrair o conteúdo JSON da resposta do Claude
      const responseText = response.content[0].text;
      
      // Tentar analisar o JSON diretamente
      products = JSON.parse(responseText);
      
      // Adicionar metadata extra
      products = products.map(product => ({
        ...product,
        imageUrl: imageUrl || undefined,
        pageNumber: pageNumber || undefined
      }));
      
      console.log(`Extraídos ${products.length} produtos da imagem ${filename} com Claude`);
      
    } catch (error) {
      console.error('Erro ao extrair JSON da resposta do Claude:', error);
      console.log('Resposta original:', response.content[0].text);
      products = [];
    }

    return products;
    
  } catch (error) {
    console.error('Erro ao processar imagem com Claude:', error);
    return [];
  }
}