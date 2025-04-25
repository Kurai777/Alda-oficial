/**
 * Serviço de Imagens - Fornece acesso confiável às imagens de produtos
 * 
 * Este serviço garante que todos os produtos tenham imagens, mesmo quando
 * as imagens originais não estiverem disponíveis, servindo imagens de fallback
 * baseadas na categoria do produto.
 */

import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import * as mimeTypes from 'mime-types';

// Mapeamento de categorias para imagens de fallback
const categoryMap: Record<string, string> = {
  'sofa': 'sofa.svg',
  'sofá': 'sofa.svg',
  'sofas': 'sofa.svg',
  'sofás': 'sofa.svg',
  'mesa': 'mesa.svg',
  'mesas': 'mesa.svg',
  'poltrona': 'poltrona.svg',
  'poltronas': 'poltrona.svg',
  'armario': 'armario.svg',
  'armário': 'armario.svg',
  'armarios': 'armario.svg',
  'armários': 'armario.svg',
  'cadeira': 'poltrona.svg',
  'cadeiras': 'poltrona.svg',
  'estante': 'armario.svg',
  'estantes': 'armario.svg',
  'rack': 'armario.svg',
  'racks': 'armario.svg',
  // Adicione mais mapeamentos conforme necessário
};

/**
 * Obtém a URL de imagem para um produto específico
 * 
 * @param productId ID do produto
 * @returns Objeto contendo informações da imagem
 */
export async function getProductImageInfo(productId: number): Promise<{
  url: string;
  contentType: string;
  localPath?: string;
  fallbackUsed: boolean;
  category?: string;
}> {
  try {
    // Busca o produto no banco de dados
    const product = await storage.getProduct(productId);
    
    if (!product) {
      return {
        url: '/placeholders/default.svg',
        contentType: 'image/svg+xml',
        fallbackUsed: true
      };
    }
    
    // Determina a categoria normalizada para o produto
    const category = normalizeCategory(product.category || '');
    
    // Se o produto não tem URL de imagem ou a URL é inválida
    if (!product.imageUrl || !isValidImageUrl(product.imageUrl)) {
      return {
        url: getCategoryPlaceholder(category),
        contentType: 'image/svg+xml',
        fallbackUsed: true,
        category
      };
    }
    
    // Verifica se é uma URL mock
    if (product.imageUrl.includes('mock-firebase-storage.com')) {
      // Extrai os componentes da URL
      const components = extractMockUrlComponents(product.imageUrl);
      
      if (!components) {
        return {
          url: getCategoryPlaceholder(category),
          contentType: 'image/svg+xml',
          fallbackUsed: true,
          category
        };
      }
      
      // Verifica se o arquivo existe em algum dos caminhos possíveis
      const localPath = findImageLocalPath(components.userId, components.catalogId, components.filename);
      
      if (localPath) {
        return {
          url: localPath.replace(path.join(process.cwd()), ''),
          contentType: mimeTypes.lookup(localPath) || 'application/octet-stream',
          localPath,
          fallbackUsed: false,
          category
        };
      }
      
      // Arquivo não encontrado, usar fallback
      return {
        url: getCategoryPlaceholder(category),
        contentType: 'image/svg+xml',
        fallbackUsed: true,
        category
      };
    }
    
    // Para URLs absolutas (http, https), retorna a URL diretamente
    if (product.imageUrl.startsWith('http://') || product.imageUrl.startsWith('https://')) {
      return {
        url: product.imageUrl,
        contentType: 'image/jpeg', // Assume-se o tipo mais comum
        fallbackUsed: false,
        category
      };
    }
    
    // Para URLs relativas, verifica se o arquivo existe
    const localPath = path.join(process.cwd(), product.imageUrl.startsWith('/') ? product.imageUrl.substring(1) : product.imageUrl);
    
    if (fs.existsSync(localPath)) {
      return {
        url: product.imageUrl,
        contentType: mimeTypes.lookup(localPath) || 'application/octet-stream',
        localPath,
        fallbackUsed: false,
        category
      };
    }
    
    // Arquivo não encontrado, usar fallback
    return {
      url: getCategoryPlaceholder(category),
      contentType: 'image/svg+xml',
      fallbackUsed: true,
      category
    };
    
  } catch (error) {
    console.error('Erro ao obter informações de imagem do produto:', error);
    
    // Em caso de erro, retorna o fallback padrão
    return {
      url: '/placeholders/default.svg',
      contentType: 'image/svg+xml',
      fallbackUsed: true
    };
  }
}

/**
 * Extrai os componentes de uma URL mock
 * 
 * @param url URL mock no formato "https://mock-firebase-storage.com/{userId}/{catalogId}/{filename}"
 * @returns Objeto com os componentes da URL ou null se o formato for inválido
 */
function extractMockUrlComponents(url: string): { userId: string; catalogId: string; filename: string } | null {
  try {
    // Padrão: https://mock-firebase-storage.com/{userId}/{catalogId}/{filename}
    const regex = /https:\/\/mock-firebase-storage\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)/;
    const match = url.match(regex);
    
    if (!match || match.length < 4) {
      return null;
    }
    
    return {
      userId: match[1],
      catalogId: match[2],
      filename: match[3]
    };
  } catch {
    return null;
  }
}

/**
 * Verifica todos os caminhos possíveis onde uma imagem pode estar
 * 
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @param filename Nome do arquivo
 * @returns Caminho completo do arquivo se encontrado, ou null se não encontrado
 */
function findImageLocalPath(userId: string, catalogId: string, filename: string): string | null {
  // Lista de possíveis caminhos
  const possiblePaths = [
    // 1. Caminho exato a partir dos parâmetros (se o arquivo existe diretamente)
    path.join(process.cwd(), 'uploads', 'images', userId, catalogId, filename),
    
    // 2. Caminhos alternativos com local-X
    ...Array.from({length: 5}, (_, i) => 
      path.join(process.cwd(), 'uploads', 'images', userId, `local-${i+1}`, filename)),
    
    // 3. Caminhos para userId = 1 (frequentemente usado no sistema)
    path.join(process.cwd(), 'uploads', 'images', '1', catalogId, filename),
    
    // 4. Todos os locais possíveis com userId = 1
    ...Array.from({length: 5}, (_, i) => 
      path.join(process.cwd(), 'uploads', 'images', '1', `local-${i+1}`, filename)),
    
    // 5. Diretório de imagens extraídas
    path.join(process.cwd(), 'uploads', 'extracted_images', filename),
  ];
  
  // Verifica cada caminho
  for (const pathToCheck of possiblePaths) {
    if (fs.existsSync(pathToCheck)) {
      return pathToCheck;
    }
  }
  
  return null;
}

/**
 * Verifica se uma URL de imagem é válida
 * 
 * @param url URL a ser verificada
 * @returns true se a URL for considerada válida
 */
function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  
  // Verifica se é uma URL absoluta
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return true;
  }
  
  // Verifica se é uma URL relativa
  const localPath = path.join(process.cwd(), url.startsWith('/') ? url.substring(1) : url);
  return fs.existsSync(localPath);
}

/**
 * Normaliza uma categoria de produto para mapeamento de fallback
 * 
 * @param category Categoria do produto
 * @returns Categoria normalizada para mapeamento
 */
function normalizeCategory(category: string): string {
  // Remove espaços e converte para minúsculas
  const normalized = category.trim().toLowerCase();
  
  // Verifica se a categoria contém alguma das palavras-chave
  for (const [key, _] of Object.entries(categoryMap)) {
    if (normalized.includes(key)) {
      return key;
    }
  }
  
  // Sem correspondência, retorna a categoria original em minúsculas
  return normalized;
}

/**
 * Obtém o caminho do placeholder para uma categoria
 * 
 * @param category Categoria do produto
 * @returns Caminho do placeholder
 */
function getCategoryPlaceholder(category: string): string {
  const placeholder = categoryMap[category];
  
  if (placeholder) {
    return `/placeholders/${placeholder}`;
  }
  
  return '/placeholders/default.svg';
}