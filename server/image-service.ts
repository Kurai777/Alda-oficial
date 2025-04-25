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
export function extractMockUrlComponents(url: string): { userId: string; catalogId: string; filename: string } | null {
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
  // Normalizar o nome do arquivo (remover espaços, etc.)
  const normalizedFilename = filename.trim().replace(/\s+/g, '_');
  
  // Obter o nome base e a extensão
  const { name: baseName, ext: extension } = path.parse(normalizedFilename);
  
  // Lista de possíveis nomes de arquivo (para casos com ou sem sufixos/prefixos)
  const possibleFilenames = [
    normalizedFilename,
    `${baseName}${extension || '.png'}`,  // Com extensão garantida
    `${baseName}_0${extension || '.png'}`,
    `${baseName}_1${extension || '.png'}`,
    `img_${baseName}${extension || '.png'}`
  ];
  
  // Lista de possíveis caminhos
  const possiblePaths = [];
  
  // Para cada possível nome de arquivo
  for (const fname of possibleFilenames) {
    // 1. Caminho exato a partir dos parâmetros (se o arquivo existe diretamente)
    possiblePaths.push(path.join(process.cwd(), 'uploads', 'images', userId, catalogId, fname));
    
    // 2. Caminhos alternativos com local-X
    for (let i = 1; i <= 10; i++) {
      possiblePaths.push(path.join(process.cwd(), 'uploads', 'images', userId, `local-${i}`, fname));
    }
    
    // 3. Caminhos para userId = 1 (frequentemente usado no sistema)
    possiblePaths.push(path.join(process.cwd(), 'uploads', 'images', '1', catalogId, fname));
    
    // 4. Todos os locais possíveis com userId = 1
    for (let i = 1; i <= 10; i++) {
      possiblePaths.push(path.join(process.cwd(), 'uploads', 'images', '1', `local-${i}`, fname));
    }
    
    // 5. Diretório geral de imagens extraídas
    possiblePaths.push(path.join(process.cwd(), 'uploads', 'extracted_images', fname));
    
    // 6. Diretório específico para o catálogo
    possiblePaths.push(path.join(process.cwd(), 'uploads', 'extracted_images', `catalog-${catalogId}`, fname));
  }
  
  // Caso especial para códigos de produtos como nomes de arquivos
  if (filename.startsWith('img_')) {
    // Extrair o código do produto (assumindo que está após "img_")
    const productCode = filename.substring(4).split('.')[0];
    
    // Adicionar variações de nomes de arquivos baseados no código do produto
    const codeBasedFilenames = [
      `${productCode}.png`,
      `${productCode}_0.png`,
      `${productCode}_1.png`
    ];
    
    for (const codeFname of codeBasedFilenames) {
      possiblePaths.push(path.join(process.cwd(), 'uploads', 'extracted_images', codeFname));
      possiblePaths.push(path.join(process.cwd(), 'uploads', 'extracted_images', `catalog-${catalogId}`, codeFname));
    }
  }
  
  // Verifica cada caminho
  console.log(`Buscando imagem ${filename} em ${possiblePaths.length} caminhos possíveis`);
  
  for (const pathToCheck of possiblePaths) {
    if (fs.existsSync(pathToCheck)) {
      console.log(`Imagem encontrada em: ${pathToCheck}`);
      return pathToCheck;
    }
  }
  
  // Procurar recursivamente em todos os subdiretórios possíveis (caso de último recurso)
  try {
    // Primeiro verificar no diretório extracted_images
    const baseExtractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
    if (fs.existsSync(baseExtractedImagesDir)) {
      const allFilesInDir = getAllFilesRecursive(baseExtractedImagesDir);
      const matchingFiles = allFilesInDir.filter(f => path.basename(f) === normalizedFilename);
      
      if (matchingFiles.length > 0) {
        console.log(`Imagem encontrada na busca recursiva em extracted_images: ${matchingFiles[0]}`);
        return matchingFiles[0];
      }
    }
    
    // Se não encontrado, procurar em todo o diretório uploads
    const baseUploadsDir = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(baseUploadsDir)) {
      console.log('Procurando em todo o diretório uploads...');
      const allUploadsFiles = getAllFilesRecursive(baseUploadsDir);
      
      // Primeiro tentar match exato pelo nome do arquivo
      const exactMatches = allUploadsFiles.filter(f => path.basename(f) === normalizedFilename);
      if (exactMatches.length > 0) {
        console.log(`Imagem encontrada (match exato) em uploads: ${exactMatches[0]}`);
        return exactMatches[0];
      }
      
      // Extrair código do produto, se disponível
      let productCode = baseName;
      if (filename.startsWith('img_')) {
        productCode = filename.substring(4).split('.')[0];
      }
      
      // Procurar por arquivos que contenham o código do produto ou o nome base
      const similarMatches = allUploadsFiles.filter(f => {
        const fname = path.basename(f).toLowerCase();
        return (fname.includes(productCode.toLowerCase()) || 
                fname.includes(baseName.toLowerCase())) && 
               (fname.endsWith('.png') || 
                fname.endsWith('.jpg') || 
                fname.endsWith('.jpeg'));
      });
      
      if (similarMatches.length > 0) {
        console.log(`Imagem similar encontrada em uploads: ${similarMatches[0]}`);
        return similarMatches[0];
      }
    }
  } catch (error) {
    console.error('Erro na busca recursiva de imagens:', error);
  }
  
  console.log(`Imagem não encontrada: ${filename}`);
  return null;
}

/**
 * Busca recursivamente em um diretório por todos os arquivos
 * 
 * @param dir Diretório base para busca
 * @returns Array com caminhos completos de todos arquivos
 */
function getAllFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  
  if (!fs.existsSync(dir)) {
    return results;
  }
  
  try {
    const list = fs.readdirSync(dir);
    
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat && stat.isDirectory()) {
        // Recursivamente adicionar arquivos do subdiretório
        const subResults = getAllFilesRecursive(fullPath);
        results.push(...subResults);
      } else {
        // Adicionar arquivo
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Erro ao listar diretório ${dir}:`, error);
  }
  
  return results;
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