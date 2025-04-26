/**
 * Serviço Centralizado de Imagens de Produtos
 * 
 * Este serviço gerencia todas as operações relacionadas a imagens de produtos,
 * garantindo que cada produto tenha sua própria imagem única e evitando
 * o compartilhamento de imagens entre produtos diferentes.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { storage } from './storage';
import { Product } from '@shared/schema';

// Converter funções de callback para promises
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);
const mkdirAsync = promisify(fs.mkdir);
const copyFileAsync = promisify(fs.copyFile);
const readdirAsync = promisify(fs.readdir);

// Diretórios para imagens
const BASE_UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const PRODUCT_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'product_images');
const EXTRACTED_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'extracted_images');
const UNIQUE_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'unique_product_images');

// Garantir que os diretórios existam
async function ensureDirectoriesExist(): Promise<void> {
  const dirs = [PRODUCT_IMAGES_DIR, EXTRACTED_IMAGES_DIR, UNIQUE_IMAGES_DIR];
  
  for (const dir of dirs) {
    if (!await existsAsync(dir)) {
      await mkdirAsync(dir, { recursive: true });
    }
  }
}

// Chamada inicial para garantir que os diretórios existam
ensureDirectoriesExist().catch(err => {
  console.error('Erro ao criar diretórios de imagens:', err);
});

/**
 * Interface para informações de imagem de produto
 */
export interface ProductImageInfo {
  hasImage: boolean;
  url?: string;
  localPath?: string;
  contentType?: string;
  error?: string;
  isShared?: boolean;
}

/**
 * Busca informações de imagem para um produto específico
 * 
 * @param productId ID do produto
 * @returns Informações da imagem
 */
export async function getProductImageInfo(productId: number): Promise<ProductImageInfo> {
  try {
    // Buscar o produto
    const product = await storage.getProduct(productId);
    
    if (!product) {
      console.log(`Produto não encontrado: ${productId}`);
      return {
        hasImage: false,
        error: 'Produto não encontrado'
      };
    }
    
    console.log(`Produto encontrado: ${JSON.stringify(product)}`);
    
    // Verificar se o produto tem uma URL de imagem
    if (!product.imageUrl) {
      console.log(`Produto ${productId} não tem URL de imagem`);
      
      // Tentar buscar imagem alternativa
      try {
        const altImageInfo = await findAlternativeImageForProduct(product);
        if (altImageInfo.hasImage) {
          return altImageInfo;
        }
      } catch (altError) {
        console.error(`Erro ao buscar imagem alternativa:`, altError);
      }
      
      return {
        hasImage: false
      };
    }
    
    // Se a URL for uma URL local no formato /uploads/...
    if (product.imageUrl.startsWith('/uploads/')) {
      const localPath = path.join(process.cwd(), product.imageUrl);
      
      if (await existsAsync(localPath)) {
        console.log(`Imagem local encontrada: ${localPath}`);
        return {
          hasImage: true,
          url: product.imageUrl,
          localPath,
          contentType: getContentTypeFromPath(localPath)
        };
      } else {
        console.log(`Imagem local não encontrada: ${localPath}`);
      }
    }
    
    // Se a URL for uma URL mock do Firebase
    if (product.imageUrl.includes('mock-firebase-storage.com')) {
      console.log(`URL mock detectada: ${product.imageUrl}`);
      
      // Extrair nome do arquivo da URL
      const matches = product.imageUrl.match(/\/([^\/]+)$/);
      if (!matches || !matches[1]) {
        console.log(`URL de imagem inválida: ${product.imageUrl}`);
        return {
          hasImage: false,
          error: 'URL de imagem inválida'
        };
      }
      
      const filename = matches[1];
      
      // Buscar a imagem localmente
      const imageFilePaths = await searchAllDirectoriesForImage(filename);
      
      if (imageFilePaths.length > 0) {
        console.log(`Imagem ${filename} encontrada: ${imageFilePaths[0]}`);
        return {
          hasImage: true,
          url: product.imageUrl,
          localPath: imageFilePaths[0],
          contentType: getContentTypeFromPath(imageFilePaths[0])
        };
      }
      
      // Se não encontrou o arquivo exato, tentar encontrar uma imagem com nome similar
      console.log(`Buscando imagem similar a ${filename}...`);
      const similarImage = await findSimilarImage(filename);
      
      if (similarImage) {
        console.log(`Imagem similar a ${filename} encontrada: ${similarImage}`);
        return {
          hasImage: true,
          url: product.imageUrl,
          localPath: similarImage,
          contentType: getContentTypeFromPath(similarImage)
        };
      }
    }
    
    // Se chegou aqui, a imagem não foi encontrada
    console.log(`Imagem não encontrada para o produto ${productId}: ${product.imageUrl}`);
    
    // Tentar buscar imagem alternativa
    try {
      const altImageInfo = await findAlternativeImageForProduct(product);
      if (altImageInfo.hasImage) {
        return altImageInfo;
      }
    } catch (altError) {
      console.error(`Erro ao buscar imagem alternativa:`, altError);
    }
    
    return {
      hasImage: false,
      error: 'Imagem não encontrada'
    };
    
  } catch (error) {
    console.error('Erro ao buscar informações de imagem:', error);
    return {
      hasImage: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
}

/**
 * Cria uma cópia exclusiva de uma imagem para um produto
 * 
 * @param productId ID do produto
 * @param sourceImagePath Caminho para a imagem de origem
 * @returns Informações da nova imagem
 */
export async function createUniqueProductImage(
  productId: number,
  sourceImagePath: string
): Promise<ProductImageInfo> {
  try {
    // Buscar o produto
    const product = await storage.getProduct(productId);
    
    if (!product) {
      return {
        hasImage: false,
        error: 'Produto não encontrado'
      };
    }
    
    // Garantir que o diretório exista
    await ensureDirectoriesExist();
    
    // Gerar um nome de arquivo único
    const uniqueId = generateUniqueImageId(product, sourceImagePath);
    const targetPath = path.join(UNIQUE_IMAGES_DIR, uniqueId);
    
    // Copiar a imagem
    await copyFileAsync(sourceImagePath, targetPath);
    
    // Criar URL para o produto
    const productUrl = `/uploads/unique_product_images/${uniqueId}`;
    
    // Atualizar o produto com a nova URL
    await storage.updateProduct(productId, { imageUrl: productUrl });
    
    return {
      hasImage: true,
      url: productUrl,
      localPath: targetPath,
      contentType: getContentTypeFromPath(targetPath)
    };
    
  } catch (error) {
    console.error('Erro ao criar imagem única para produto:', error);
    return {
      hasImage: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
}

/**
 * Procura por uma imagem em todos os diretórios de uploads
 */
async function searchAllDirectoriesForImage(filename: string): Promise<string[]> {
  const results: string[] = [];
  
  try {
    // Função recursiva para buscar em subdiretórios
    async function searchDir(dir: string): Promise<void> {
      if (!await existsAsync(dir)) {
        return;
      }
      
      const entries = await readdirAsync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (entry.name === filename) {
          results.push(fullPath);
        }
      }
    }
    
    // Iniciar busca a partir do diretório uploads
    await searchDir(BASE_UPLOADS_DIR);
    
    return results;
  } catch (error) {
    console.error(`Erro ao buscar ${filename} em diretórios:`, error);
    return [];
  }
}

/**
 * Busca por uma imagem com nome similar ou extrai o índice da imagem
 * 
 * Esta função é fundamental para garantir mapeamento 1:1 entre produtos e imagens,
 * buscando pela imagem correspondente exata no sistema de arquivos.
 */
async function findSimilarImage(filename: string): Promise<string | null> {
  try {
    console.log(`Buscando imagem similar para: ${filename}`);
    
    // Extrair índice da imagem a partir do nome do arquivo
    // Por exemplo, de "img_2_image370.jpg" extrair o "2"
    const indexMatch = filename.match(/img_(\d+)_/);
    const imageIndex = indexMatch ? parseInt(indexMatch[1]) : null;
    console.log(`Índice extraído: ${imageIndex}`);
    
    // Extrair parte do nome sem a extensão
    const baseNameMatch = filename.match(/^([^.]+)/);
    if (!baseNameMatch) return null;
    
    const baseName = baseNameMatch[1].toLowerCase();
    console.log(`Nome base extraído: ${baseName}`);
    
    // Lista de diretórios onde procurar
    const searchDirs = [
      EXTRACTED_IMAGES_DIR,
      UNIQUE_IMAGES_DIR,
      PRODUCT_IMAGES_DIR,
      path.join(BASE_UPLOADS_DIR, 'temp-excel-images'),
      BASE_UPLOADS_DIR
    ];
    
    // Se temos um índice, primeiro tentar encontrar a imagem correspondente baseada no índice
    if (imageIndex !== null) {
      for (const dir of searchDirs) {
        if (!await existsAsync(dir)) continue;
        
        const files = await readdirAsync(dir);
        
        // Buscar primeiro por uma correspondência exata baseada no índice
        // Por exemplo: img_2.png para o índice 2
        const exactMatchFile = files.find(file => 
          file === `img_${imageIndex}.png` || 
          file === `img_${imageIndex}.jpg` || 
          file === `img_${imageIndex}.jpeg` || 
          file === `image_${imageIndex}.png` || 
          file === `image_${imageIndex}.jpg`
        );
        
        if (exactMatchFile) {
          console.log(`Correspondência exata encontrada por índice ${imageIndex}: ${exactMatchFile}`);
          return path.join(dir, exactMatchFile);
        }
        
        // Procurar por qualquer arquivo que contenha o índice
        for (const file of files) {
          const fileIndexMatch = file.match(/img_(\d+)/);
          const fileIndex = fileIndexMatch ? parseInt(fileIndexMatch[1]) : null;
          
          if (fileIndex === imageIndex) {
            console.log(`Correspondência por índice encontrada: ${file}`);
            return path.join(dir, file);
          }
        }
      }
    }
    
    // Buscar em cada diretório por correspondência de nome
    for (const dir of searchDirs) {
      if (!await existsAsync(dir)) continue;
      
      const files = await readdirAsync(dir);
      
      // Primeiro, tentar encontrar imagens que contenham o nome base exato
      for (const file of files) {
        if (file.toLowerCase() === baseName.toLowerCase() + '.png' || 
            file.toLowerCase() === baseName.toLowerCase() + '.jpg' ||
            file.toLowerCase() === baseName.toLowerCase() + '.jpeg') {
          console.log(`Correspondência exata de nome encontrada: ${file}`);
          return path.join(dir, file);
        }
      }
      
      // Depois, tentar encontrar imagens que contenham o nome base
      for (const file of files) {
        if (file.toLowerCase().includes(baseName)) {
          console.log(`Correspondência por nome encontrada: ${file}`);
          return path.join(dir, file);
        }
      }
      
      // Se não encontrou, tentar imagens com partes do nome
      if (baseName.length > 3) {
        const parts = baseName.split(/[_-]/);
        for (const part of parts) {
          if (part.length < 3) continue;
          
          for (const file of files) {
            if (file.toLowerCase().includes(part)) {
              console.log(`Correspondência parcial encontrada: ${file} (parte: ${part})`);
              return path.join(dir, file);
            }
          }
        }
      }
    }
    
    console.log(`Nenhuma correspondência encontrada para ${filename}`);
    return null;
  } catch (error) {
    console.error(`Erro ao buscar imagem similar a ${filename}:`, error);
    return null;
  }
}

/**
 * Tenta encontrar uma imagem alternativa para um produto
 * quando a imagem original não é encontrada
 */
async function findAlternativeImageForProduct(product: Product): Promise<ProductImageInfo> {
  try {
    console.log(`Buscando imagem alternativa para o produto ${product.id}`);
    
    // Primeiro, verificar se há outras imagens disponíveis no diretório
    const imagesInDir = fs.readdirSync(EXTRACTED_IMAGES_DIR).filter(file => 
      file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg') || file.endsWith('.gif')
    );
    
    if (imagesInDir.length > 0) {
      // Usar a primeira imagem disponível como alternativa temporária
      const imagePath = path.join(EXTRACTED_IMAGES_DIR, imagesInDir[0]);
      console.log(`Usando imagem alternativa: ${imagePath}`);
      
      // Criar uma cópia única desta imagem para o produto
      return await createUniqueProductImage(product.id, imagePath);
    }
    
    return {
      hasImage: false,
      error: 'Nenhuma imagem alternativa encontrada'
    };
  } catch (error) {
    console.error(`Erro ao buscar imagem alternativa:`, error);
    return {
      hasImage: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    };
  }
}

/**
 * Gera um ID único para uma imagem de produto
 */
function generateUniqueImageId(product: Product, imagePath: string): string {
  try {
    // Criar um hash baseado em:
    // 1. O ID do produto (para garantir que cada produto tenha seu próprio ID de imagem)
    // 2. O nome do produto
    // 3. O código do produto (se disponível)
    // 4. Um timestamp
    const uniqueString = `${product.id}_${product.name}_${product.code || ''}_${Date.now()}`;
    
    // Criar um hash SHA-256 desta string
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
    
    // Extrair extensão do arquivo original
    const extension = path.extname(imagePath);
    
    // Retornar um ID único no formato product_ID_HASH.extensão
    return `product_${product.id}_${hash.substring(0, 8)}${extension}`;
  } catch (error) {
    console.error('Erro ao gerar ID único para imagem:', error);
    return `product_${product.id}_${Date.now()}${path.extname(imagePath)}`;
  }
}

/**
 * Determina o tipo de conteúdo (MIME type) a partir do caminho do arquivo
 */
function getContentTypeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Extrai imagens de produto de um diretório de catálogo e associa aos produtos
 */
export async function mapCatalogImagesToProducts(
  catalogId: number,
  catalogDir: string
): Promise<{ success: boolean; message: string; count: number }> {
  try {
    // Buscar todos os produtos do catálogo
    const products = await storage.getProductsByCatalogId(catalogId);
    
    if (!products.length) {
      return {
        success: false,
        message: 'Nenhum produto encontrado para este catálogo',
        count: 0
      };
    }
    
    // Buscar todas as imagens do diretório do catálogo
    const imagesInDir = fs.readdirSync(catalogDir).filter(file => 
      file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg') || file.endsWith('.gif')
    );
    
    if (!imagesInDir.length) {
      return {
        success: false,
        message: 'Nenhuma imagem encontrada no diretório do catálogo',
        count: 0
      };
    }
    
    // Associar cada produto a uma imagem
    // Se houver mais produtos que imagens, algumas imagens serão reutilizadas
    // Se houver mais imagens que produtos, algumas imagens não serão usadas
    let updatedCount = 0;
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const imageIndex = i % imagesInDir.length;
      const imagePath = path.join(catalogDir, imagesInDir[imageIndex]);
      
      // Criar uma cópia única para este produto
      const imageInfo = await createUniqueProductImage(product.id, imagePath);
      
      if (imageInfo.hasImage) {
        updatedCount++;
      }
    }
    
    return {
      success: true,
      message: `${updatedCount} produtos atualizados com imagens únicas`,
      count: updatedCount
    };
    
  } catch (error) {
    console.error('Erro ao mapear imagens para produtos:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
      count: 0
    };
  }
}