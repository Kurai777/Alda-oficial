/**
 * Script para corrigir o mapeamento de imagens para produtos
 * 
 * Este script analisa os produtos de um catálogo e cria um mapeamento correto
 * entre cada produto e sua imagem correspondente, garantindo que não haja
 * compartilhamento de imagens entre produtos.
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { db } from './db';
import { storage } from './storage';
import { products } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createUniqueProductImage, getProductImageInfo } from './image-service';

const mkdir = promisify(fs.mkdir);
const copyFile = promisify(fs.copyFile);

/**
 * Garante que os diretórios necessários existam
 */
async function ensureDirectoriesExist(): Promise<void> {
  const dirs = [
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'uploads', 'extracted_images'),
    path.join(process.cwd(), 'uploads', 'product_images'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      console.log(`Diretório criado: ${dir}`);
    }
  }
}

/**
 * Extrai o índice da imagem de uma URL
 */
function extractImageIndex(imageUrl: string | null): number | null {
  if (!imageUrl) return null;
  
  // Tentar extrair o índice de padrões como img_6_image373.jpg
  const match = imageUrl.match(/img_(\d+)_/);
  if (match && match[1]) {
    return parseInt(match[1]);
  }
  
  // Tentar extrair de padrões como img_6.png
  const simplMatch = imageUrl.match(/img_(\d+)\.png/);
  if (simplMatch && simplMatch[1]) {
    return parseInt(simplMatch[1]);
  }
  
  return null;
}

/**
 * Encontra o arquivo de imagem correspondente ao índice
 */
async function findImageByIndex(index: number): Promise<string | null> {
  const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
  
  // Verificar se existe um arquivo com o padrão img_X.png
  const expectedFilename = `img_${index}.png`;
  const expectedPath = path.join(extractedImagesDir, expectedFilename);
  
  if (fs.existsSync(expectedPath)) {
    console.log(`Correspondência exata encontrada por índice ${index}: ${expectedFilename}`);
    return expectedPath;
  }
  
  // Procurar por qualquer arquivo que contenha o índice no nome
  const files = fs.readdirSync(extractedImagesDir);
  const matchingFile = files.find(file => file.includes(`img_${index}_`) || file === `img_${index}.png`);
  
  if (matchingFile) {
    console.log(`Correspondência encontrada para índice ${index}: ${matchingFile}`);
    return path.join(extractedImagesDir, matchingFile);
  }
  
  console.log(`Nenhuma imagem encontrada para o índice ${index}`);
  return null;
}

/**
 * Cria uma cópia única da imagem para o produto
 */
async function createUniqueImage(productId: number, imagePath: string): Promise<string> {
  const productImagesDir = path.join(process.cwd(), 'uploads', 'product_images');
  
  // Garantir que o diretório existe
  if (!fs.existsSync(productImagesDir)) {
    await mkdir(productImagesDir, { recursive: true });
  }
  
  // Gerar nome único para o arquivo
  const ext = path.extname(imagePath);
  const uniqueFilename = `product_${productId}_${Date.now()}${ext}`;
  const destinationPath = path.join(productImagesDir, uniqueFilename);
  
  // Copiar arquivo
  await copyFile(imagePath, destinationPath);
  
  // Retornar caminho relativo para URL
  return `/uploads/product_images/${uniqueFilename}`;
}

/**
 * Corrige as imagens para um catálogo específico
 */
export async function fixProductImages(catalogId: number): Promise<{
  success: boolean;
  totalProducts: number;
  updatedProducts: number;
  message: string;
}> {
  try {
    console.log(`Corrigindo imagens para o catálogo ${catalogId}...`);
    
    // Buscar todos os produtos do catálogo
    const products = await storage.getProductsByCatalogId(catalogId);
    console.log(`Encontrados ${products.length} produtos`);
    
    if (!products.length) {
      return {
        success: false,
        totalProducts: 0,
        updatedProducts: 0,
        message: 'Nenhum produto encontrado para este catálogo'
      };
    }
    
    // Preparar diretórios
    await ensureDirectoriesExist();
    
    // Contador de produtos atualizados
    let updatedCount = 0;
    
    // Mapear imagens para produtos
    for (const product of products) {
      console.log(`\nProcessando produto ${product.id}: ${product.name}`);
      
      // Extrair índice da imagem do produto
      const imageIndex = extractImageIndex(product.imageUrl);
      console.log(`Índice extraído: ${imageIndex}`);
      
      if (imageIndex === null) {
        console.log(`Não foi possível extrair índice para o produto ${product.id}`);
        continue;
      }
      
      // Encontrar imagem correspondente
      const imagePath = await findImageByIndex(imageIndex);
      
      if (!imagePath) {
        console.log(`Nenhuma imagem encontrada para o índice ${imageIndex}`);
        continue;
      }
      
      console.log(`Imagem encontrada: ${imagePath}`);
      
      // Criar cópia única da imagem para o produto
      const uniqueImageUrl = await createUniqueImage(product.id, imagePath);
      console.log(`Criada imagem única: ${uniqueImageUrl}`);
      
      // Atualizar URL da imagem no banco de dados
      await db.update(products)
        .set({ imageUrl: uniqueImageUrl })
        .where(eq(products.id, product.id));
      
      console.log(`Atualizada URL da imagem para o produto ${product.id}`);
      updatedCount++;
    }
    
    return {
      success: true,
      totalProducts: products.length,
      updatedProducts: updatedCount,
      message: `Atualizado mapeamento de imagens para ${updatedCount} de ${products.length} produtos`
    };
  } catch (error) {
    console.error('Erro ao corrigir imagens:', error);
    return {
      success: false,
      totalProducts: 0,
      updatedProducts: 0,
      message: `Erro ao corrigir imagens: ${error.message}`
    };
  }
}

/**
 * Adicionar rota para corrigir imagens
 */
export function addFixImageRoutes(app: any): void {
  // Rota para corrigir todas as imagens de um catálogo
  app.post("/api/fix-product-images/:catalogId", async (req, res) => {
    try {
      const catalogId = parseInt(req.params.catalogId);
      
      if (isNaN(catalogId)) {
        return res.status(400).json({
          success: false,
          message: 'ID de catálogo inválido'
        });
      }
      
      const result = await fixProductImages(catalogId);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      console.error('Erro ao processar requisição de correção de imagens:', error);
      res.status(500).json({
        success: false,
        message: `Erro ao processar requisição: ${error.message}`
      });
    }
  });
  
  // Rota para corrigir as imagens de todos os catálogos do usuário
  app.post("/api/fix-product-images", async (req, res) => {
    try {
      const userId = req.body.userId || (req.user ? req.user.id : 1);
      
      const catalogs = await db.query.catalogs.findMany({
        where: eq(products.userId, userId)
      });
      
      const results = [];
      for (const catalog of catalogs) {
        const result = await fixProductImages(catalog.id);
        results.push({
          catalogId: catalog.id,
          name: catalog.name,
          ...result
        });
      }
      
      res.status(200).json({
        success: true,
        catalogs: results
      });
    } catch (error) {
      console.error('Erro ao processar requisição de correção de imagens:', error);
      res.status(500).json({
        success: false,
        message: `Erro ao processar requisição: ${error.message}`
      });
    }
  });
}

// Nota: Removido o código para execução direta via CommonJS
// Esta funcionalidade pode ser implementada através da chamada da API