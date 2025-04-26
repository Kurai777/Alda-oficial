/**
 * Fix Product Images - Utilitário para corrigir problemas com imagens de produtos
 * 
 * Este módulo fornece funcionalidades para detectar e corrigir problemas de
 * compartilhamento de imagens entre produtos. Garante que cada produto tenha
 * sua própria imagem exclusiva.
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { products } from '@shared/schema';
import { storage } from './storage';
import { createUniqueImageCopy, findImageFile } from './excel-image-analyzer';

// Diretórios para imagens
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
const UNIQUE_IMAGES_DIR = path.join(UPLOADS_DIR, 'unique-images');

/**
 * Inicializa os diretórios necessários
 */
async function initializeDirectories() {
  // Garantir que os diretórios existam
  for (const dir of [UPLOADS_DIR, IMAGES_DIR, UNIQUE_IMAGES_DIR]) {
    try {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
        console.log(`Diretório criado: ${dir}`);
      }
    } catch (error) {
      console.error(`Erro ao criar diretório ${dir}:`, error);
    }
  }
}

/**
 * Extrai o nome do arquivo de uma URL de imagem
 */
function extractFilenameFromUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  
  // Remover parâmetros de query
  const urlWithoutParams = imageUrl.split('?')[0];
  
  // Obter o último segmento da URL
  const segments = urlWithoutParams.split('/');
  const filename = segments[segments.length - 1];
  
  return filename || null;
}

/**
 * Verifica se um produto tem uma imagem compartilhada e cria uma versão única
 */
export async function detectAndFixSharedImage(productId: number) {
  try {
    // Obter o produto
    const product = await storage.getProduct(productId);
    if (!product || !product.imageUrl) {
      return { success: false, message: 'Produto ou imagem não encontrada' };
    }
    
    // Verificar se a imagem é compartilhada
    const productsWithSameImage = await storage.getProductsByImageUrl(product.imageUrl);
    const isShared = productsWithSameImage.length > 1;
    
    if (isShared) {
      console.log(`Produto ${productId} compartilha imagem com ${productsWithSameImage.length - 1} outros produtos`);
      
      // Extrair o nome do arquivo da URL
      const filename = extractFilenameFromUrl(product.imageUrl);
      if (!filename) {
        return { success: false, message: 'Nome de arquivo inválido' };
      }
      
      // Procurar o arquivo de imagem
      const imagePath = await findImageFile(filename);
      if (!imagePath) {
        return { success: false, message: 'Arquivo de imagem não encontrado' };
      }
      
      // Criar uma cópia única
      const result = await createUniqueImageCopy(
        productId,
        imagePath
      );
      
      if (result.success) {
        console.log(`Imagem única criada para o produto ${productId}: ${result.path}`);
        
        // Atualizar o produto com a nova URL
        const updatedImageUrl = `/api/product-image/${productId}?unique=true&t=${Date.now()}`;
        const updatedProduct = await storage.updateProduct(productId, {
          ...product,
          imageUrl: updatedImageUrl
        });
        
        if (!updatedProduct) {
          return { success: false, message: 'Falha ao atualizar produto' };
        }
        
        return { 
          success: true, 
          message: 'Imagem única criada e produto atualizado',
          imageUrl: updatedImageUrl,
          isShared: true
        };
      } else {
        return { success: false, message: result.error || 'Falha ao criar imagem única' };
      }
    } else {
      // Imagem já é única
      return { 
        success: true, 
        message: 'Produto já tem imagem única',
        imageUrl: product.imageUrl,
        isShared: false
      };
    }
  } catch (error) {
    console.error(`Erro ao corrigir imagem do produto ${productId}:`, error);
    return { success: false, message: 'Erro interno ao processar imagem' };
  }
}

/**
 * Corrige todas as imagens compartilhadas em um catálogo
 */
export async function fixAllSharedImagesInCatalog(catalogId: number) {
  try {
    // Obter todos os produtos do catálogo
    const catalogProducts = await storage.getProductsByCatalogId(catalogId);
    console.log(`Analisando ${catalogProducts.length} produtos no catálogo ${catalogId}`);
    
    const results = {
      total: catalogProducts.length,
      fixed: 0,
      alreadyUnique: 0,
      failed: 0,
      products: [] as Array<{ id: number, status: string, message: string }>
    };
    
    // Para cada produto, verificar e corrigir imagens compartilhadas
    for (const product of catalogProducts) {
      try {
        if (!product.imageUrl) {
          results.products.push({
            id: product.id,
            status: 'skipped',
            message: 'Produto não tem URL de imagem'
          });
          continue;
        }
        
        const fixResult = await detectAndFixSharedImage(product.id);
        
        if (fixResult.success) {
          if (fixResult.isShared) {
            results.fixed++;
            results.products.push({
              id: product.id,
              status: 'fixed',
              message: fixResult.message
            });
          } else {
            results.alreadyUnique++;
            results.products.push({
              id: product.id,
              status: 'ok',
              message: fixResult.message
            });
          }
        } else {
          results.failed++;
          results.products.push({
            id: product.id,
            status: 'error',
            message: fixResult.message
          });
        }
      } catch (error) {
        results.failed++;
        results.products.push({
          id: product.id,
          status: 'error',
          message: 'Erro ao processar produto'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error(`Erro ao corrigir imagens do catálogo ${catalogId}:`, error);
    return { 
      success: false, 
      message: 'Erro interno ao processar catálogo',
      total: 0,
      fixed: 0,
      failed: 0,
      products: []
    };
  }
}

/**
 * Adiciona rotas para corrigir imagens de produtos
 */
export function addFixImageRoutes(app: any) {
  // Inicializar diretórios
  initializeDirectories();
  
  // Rota para corrigir uma imagem específica
  app.post('/api/fix-product-image/:productId', async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      
      if (!productId || isNaN(parseInt(productId))) {
        return res.status(400).json({ success: false, message: 'ID de produto inválido' });
      }
      
      const result = await detectAndFixSharedImage(parseInt(productId));
      return res.json(result);
    } catch (error) {
      console.error('Erro ao corrigir imagem do produto:', error);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  });
  
  // Rota para corrigir todas as imagens de um catálogo
  app.post('/api/fix-catalog-images/:catalogId', async (req: Request, res: Response) => {
    try {
      const { catalogId } = req.params;
      
      if (!catalogId || isNaN(parseInt(catalogId))) {
        return res.status(400).json({ success: false, message: 'ID de catálogo inválido' });
      }
      
      // Verificar se o catálogo existe
      const catalog = await storage.getCatalog(parseInt(catalogId));
      if (!catalog) {
        return res.status(404).json({ success: false, message: 'Catálogo não encontrado' });
      }
      
      const results = await fixAllSharedImagesInCatalog(parseInt(catalogId));
      return res.json({ success: true, results });
    } catch (error) {
      console.error('Erro ao corrigir imagens do catálogo:', error);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  });
  
  return app;
}