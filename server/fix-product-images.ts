/**
 * Script para corrigir o mapeamento de imagens para produtos
 * 
 * Este script analisa os produtos de um catálogo e cria um mapeamento correto
 * entre cada produto e sua imagem correspondente, garantindo que não haja
 * compartilhamento de imagens entre produtos.
 */
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { storage } from './storage';

const existsAsync = promisify(fs.exists);
const readdirAsync = promisify(fs.readdir);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const copyFileAsync = promisify(fs.copyFile);
const mkdirAsync = promisify(fs.mkdir);

// Diretórios para armazenamento de imagens
const BASE_UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const EXTRACTED_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'extracted_images');
const PRODUCT_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'product_images');
const UNIQUE_IMAGES_DIR = path.join(BASE_UPLOADS_DIR, 'unique_images');

// Garantir que os diretórios existam
async function ensureDirectoriesExist(): Promise<void> {
  const dirs = [
    BASE_UPLOADS_DIR,
    EXTRACTED_IMAGES_DIR,
    PRODUCT_IMAGES_DIR,
    UNIQUE_IMAGES_DIR
  ];
  
  for (const dir of dirs) {
    if (!await existsAsync(dir)) {
      await mkdirAsync(dir, { recursive: true });
      console.log(`Diretório criado: ${dir}`);
    }
  }
}

/**
 * Extrai o índice da imagem de uma URL
 */
function extractImageIndex(imageUrl: string | null): number | null {
  if (!imageUrl) return null;
  
  // Extrair índice de URLs no formato firebase como:
  // https://mock-firebase-storage.com/1/local-4/img_13_image377.jpg
  const indexMatch = imageUrl.match(/img_(\d+)_/);
  if (indexMatch && indexMatch[1]) {
    return parseInt(indexMatch[1]);
  }
  
  return null;
}

/**
 * Encontra o arquivo de imagem correspondente ao índice
 */
async function findImageByIndex(index: number): Promise<string | null> {
  // Procurar nos diretórios de imagens
  const searchDirs = [
    EXTRACTED_IMAGES_DIR,
    UNIQUE_IMAGES_DIR,
    PRODUCT_IMAGES_DIR
  ];
  
  for (const dir of searchDirs) {
    if (!await existsAsync(dir)) continue;
    
    const files = await readdirAsync(dir);
    
    // Buscar por correspondência exata: img_13.png
    const exactMatch = files.find(file => 
      file === `img_${index}.png` || 
      file === `img_${index}.jpg` || 
      file === `img_${index}.jpeg`
    );
    
    if (exactMatch) {
      return path.join(dir, exactMatch);
    }
    
    // Buscar por correspondência parcial: qualquer arquivo com img_13
    for (const file of files) {
      const match = file.match(/img_(\d+)/);
      if (match && parseInt(match[1]) === index) {
        return path.join(dir, file);
      }
    }
  }
  
  return null;
}

/**
 * Cria uma cópia única da imagem para o produto
 */
async function createUniqueImage(productId: number, imagePath: string): Promise<string> {
  await ensureDirectoriesExist();
  
  const fileExt = path.extname(imagePath);
  const uniqueFilename = `product_${productId}_${Date.now()}${fileExt}`;
  const destinationPath = path.join(UNIQUE_IMAGES_DIR, uniqueFilename);
  
  await copyFileAsync(imagePath, destinationPath);
  console.log(`Imagem única criada: ${destinationPath}`);
  
  return destinationPath;
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
      
      // Criar cópia única da imagem
      const uniqueImagePath = await createUniqueImage(product.id, imagePath);
      
      // Atualize o produto com o caminho da nova imagem
      // Aqui vamos atualizar apenas o campo imageUrl para manter a referência original
      await storage.updateProduct(product.id, {
        ...product,
        imageUrl: `api/product-image/${product.id}?t=${Date.now()}`
      });
      
      updatedCount++;
    }
    
    return {
      success: true,
      totalProducts: products.length,
      updatedProducts: updatedCount,
      message: `${updatedCount} de ${products.length} produtos atualizados com imagens únicas`
    };
  } catch (error) {
    console.error('Erro ao corrigir imagens de produtos:', error);
    return {
      success: false,
      totalProducts: 0,
      updatedProducts: 0,
      message: `Erro: ${error.message}`
    };
  }
}

/**
 * Adicionar rota para corrigir imagens
 */
export function addFixImageRoutes(app: any): void {
  app.post('/api/fix-product-images/:catalogId', async (req, res) => {
    try {
      const { catalogId } = req.params;
      
      if (!catalogId || isNaN(parseInt(catalogId))) {
        return res.status(400).json({
          success: false,
          message: 'ID do catálogo inválido'
        });
      }
      
      const result = await fixProductImages(parseInt(catalogId));
      
      res.json(result);
    } catch (error) {
      console.error('Erro ao processar requisição de correção de imagens:', error);
      res.status(500).json({
        success: false,
        message: `Erro: ${error.message}`
      });
    }
  });
}

// Executar este arquivo diretamente para corrigir imagens
if (require.main === module) {
  const catalogId = process.argv[2] ? parseInt(process.argv[2]) : null;
  
  if (!catalogId) {
    console.error('Por favor, forneça um ID de catálogo válido como argumento.');
    process.exit(1);
  }
  
  fixProductImages(catalogId)
    .then(result => {
      console.log(result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Erro:', error);
      process.exit(1);
    });
}