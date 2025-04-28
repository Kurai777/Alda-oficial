/**
 * Excel Image Analyzer - Garantia de associação 1:1 entre produtos e imagens
 * 
 * Este módulo analisa as imagens extraídas de um arquivo Excel e garante
 * que cada produto tenha sua própria imagem exclusiva, evitando compartilhamento
 * de imagens entre produtos diferentes.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { Product } from '@shared/schema';
import { storage } from './storage';

// Converter funções de callback para promises
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);
const copyFileAsync = promisify(fs.copyFile);
const existsAsync = promisify(fs.exists);

/**
 * Interface para representar o resultado da verificação de imagem
 */
interface ImageVerificationResult {
  status: 'success' | 'error';
  hasImage: boolean;
  localPath?: string;
  url?: string;
  uniqueId?: string;
  isShared?: boolean;
  error?: string;
}

/**
 * Verifica se o produto tem uma imagem válida e única
 */
export async function verifyProductImage(productId: number): Promise<ImageVerificationResult> {
  try {
    // Buscar produto
    const product = await storage.getProduct(productId);
    
    if (!product) {
      return {
        status: 'error',
        hasImage: false,
        error: `Produto não encontrado: ${productId}`
      };
    }
    
    // Se o produto não tem URL de imagem
    if (!product.imageUrl) {
      return {
        status: 'success',
        hasImage: false
      };
    }
    
    // Se a URL não é uma URL mock do Firebase
    if (!product.imageUrl.includes('mock-firebase-storage.com')) {
      return {
        status: 'success',
        hasImage: true,
        url: product.imageUrl,
        uniqueId: `remote_${Date.now()}_${productId}`
      };
    }
    
    // Extrair nome do arquivo da URL mock
    const matches = product.imageUrl.match(/\/([^\/]+)$/);
    if (!matches || !matches[1]) {
      return {
        status: 'error',
        hasImage: false,
        error: `URL de imagem inválida: ${product.imageUrl}`
      };
    }
    
    const filename = matches[1];
    
    // Verificar se outros produtos usam a mesma URL de imagem
    // Proteger de possíveis erros na consulta ao banco
    let isShared = false;
    try {
      const productsWithSameImage = await storage.getProductsByImageUrl(product.imageUrl);
      isShared = productsWithSameImage.length > 1;
      
      if (isShared) {
        console.log(`Imagem ${filename} é compartilhada por ${productsWithSameImage.length} produtos`);
      }
    } catch (dbErr) {
      console.error('Erro ao verificar produtos com mesma imagem:', dbErr);
      // Mesmo com erro, podemos continuar, apenas assumimos que não é compartilhada
    }
    
    // Procurar a imagem localmente
    const localPath = await findImageFile(filename);
    
    if (!localPath) {
      return {
        status: 'success',
        hasImage: false,
        error: `Imagem não encontrada localmente: ${filename}`
      };
    }
    
    // Gerar um ID único para esta imagem específica deste produto
    // Isso garante que mesmo com URLs idênticas, cada produto tenha sua "própria" imagem
    const uniqueId = generateUniqueImageId(product, localPath);
    
    return {
      status: 'success',
      hasImage: true,
      localPath,
      url: product.imageUrl,
      uniqueId,
      isShared
    };
    
  } catch (error) {
    // Capturar erro específico para informação de depuração
    let errorMessage = 'Erro desconhecido';
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('Erro ao verificar imagem (detalhado):', {
        message: error.message,
        stack: error.stack
      });
    } else {
      console.error('Erro ao verificar imagem (objeto):', JSON.stringify(error));
    }
    
    return {
      status: 'error',
      hasImage: false,
      error: errorMessage
    };
  }
}

/**
 * Gera um ID único para uma imagem de um produto específico
 */
function generateUniqueImageId(product: Product, imagePath: string): string {
  try {
    // Criar um hash baseado em:
    // 1. O ID do produto (para garantir que cada produto tenha seu próprio ID de imagem)
    // 2. O nome do produto
    // 3. O código do produto
    // 4. Um timestamp (para garantir unicidade mesmo em caso de colisões)
    const uniqueString = `${product.id}_${product.name}_${product.code}_${Date.now()}`;
    
    // Criar um hash SHA-256 desta string
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
    
    // Extrair nome do arquivo de imagem original para manter extensão
    const originalFilename = path.basename(imagePath);
    const extension = path.extname(originalFilename);
    
    // Retornar combinação de ID do produto + hash truncado + extensão original
    return `product_${product.id}_${hash.substring(0, 8)}${extension}`;
    
  } catch (error) {
    console.error('Erro ao gerar ID único de imagem:', error);
    return `product_${product.id}_${Date.now()}${path.extname(imagePath)}`;
  }
}

/**
 * Procura por um arquivo de imagem em todos os diretórios possíveis
 */
export async function findImageFile(filename: string): Promise<string | null> {
  try {
    // Verificar se o nome do arquivo tem formato válido
    if (!filename || typeof filename !== 'string') {
      console.error(`[findImageFile] Nome de arquivo inválido: ${filename}`);
      return null;
    }
    console.log(`[findImageFile] Procurando por: ${filename}`);
    
    // Lista de diretórios onde procurar
    const directories = [
      // Diretórios temporários de upload
      path.join(process.cwd(), 'uploads', 'temp-excel-images'),
      // Diretório de imagens extraídas
      path.join(process.cwd(), 'uploads', 'extracted_images'),
      // Firebase upload temporário
      path.join(process.cwd(), 'uploads', 'firebase_temp'),
      // Diretório de uploads geral
      path.join(process.cwd(), 'uploads')
    ];
    
    // Primeiro, tentar match exato nos diretórios de primeiro nível
    for (const dir of directories) {
      console.log(`[findImageFile] Verificando diretório direto: ${dir}`);
      if (await existsAsync(dir)) {
        const exactPath = path.join(dir, filename);
        console.log(`[findImageFile] Verificando caminho exato: ${exactPath}`);
        if (await existsAsync(exactPath)) {
          console.log(`[findImageFile] Imagem encontrada (match exato direto): ${exactPath}`);
          return exactPath;
        }
      } else {
        console.log(`[findImageFile] Diretório não existe: ${dir}`);
      }
    }
    
    // Procurar recursivamente em todos os subdiretórios
    console.log(`[findImageFile] Procurando recursivamente em /uploads para ${filename}...`);
    
    // Começar do diretório de uploads
    const uploadsDir = path.join(process.cwd(), 'uploads');
    
    // Função recursiva para procurar em todos os subdiretórios
    const foundFile = await searchFileRecursively(uploadsDir, filename);
    
    if (foundFile) {
      console.log(`[findImageFile] Imagem encontrada (recursivo): ${foundFile}`);
      return foundFile;
    }
    
    console.log(`[findImageFile] Imagem NÃO encontrada: ${filename}`);
    return null;
  } catch (error) {
    console.error(`[findImageFile] Erro CRÍTICO ao procurar arquivo de imagem ${filename}:`, error);
    return null;
  }
}

/**
 * Procura por um arquivo recursivamente em um diretório
 */
async function searchFileRecursively(dir: string, filename: string): Promise<string | null> {
  try {
    // Verificar se o diretório existe
    console.log(`[searchFileRecursively] Verificando diretório: ${dir}`);
    if (!await existsAsync(dir)) {
       console.log(`[searchFileRecursively] Diretório não existe: ${dir}`);
      return null;
    }
    
    // Listar arquivos e subdiretórios
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
      console.log(`[searchFileRecursively] Encontradas ${entries.length} entradas em ${dir}`);
    } catch (readDirError) {
      console.error(`[searchFileRecursively] Erro ao ler diretório ${dir}:`, readDirError);
      return null; // Retorna null se não puder ler o diretório
    }
    
    // Verificar arquivos neste diretório primeiro
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) {
        return path.join(dir, entry.name);
      }
    }
    
    // Depois verificar subdiretórios
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await searchFileRecursively(path.join(dir, entry.name), filename);
        if (found) {
          return found;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Erro ao procurar arquivo recursivamente:`, error);
    return null;
  }
}

/**
 * Cria uma cópia exclusiva de uma imagem para um produto específico
 */
export async function createUniqueImageCopy(
  productId: number, 
  imagePath: string
): Promise<{ success: boolean; path?: string; url?: string; error?: string }> {
  try {
    // Buscar produto
    const product = await storage.getProduct(productId);
    
    if (!product) {
      return {
        success: false,
        error: `Produto não encontrado: ${productId}`
      };
    }
    
    // Verificar se o arquivo de imagem existe
    if (!await existsAsync(imagePath)) {
      console.error(`Arquivo de imagem não encontrado: ${imagePath}`);
      return {
        success: false,
        error: `Arquivo de imagem não encontrado: ${imagePath}`
      };
    }
    
    // Criar diretório para armazenar imagens únicas
    const uniqueImagesDir = path.join(process.cwd(), 'uploads', 'unique_product_images');
    if (!await existsAsync(uniqueImagesDir)) {
      await mkdirAsync(uniqueImagesDir, { recursive: true });
    }
    
    // Extrair informações sobre o produto para criar um nome de arquivo verdadeiramente único
    // Usamos código do produto, id, e um timestamp para garantir unicidade
    const timestamp = Date.now();
    const uniqueId = generateUniqueImageId(product, imagePath);
    const uniqueImagePath = path.join(uniqueImagesDir, uniqueId);
    
    console.log(`Criando cópia exclusiva para o produto ${productId}:`);
    console.log(`- Origem: ${imagePath}`);
    console.log(`- Destino: ${uniqueImagePath}`);
    
    // Copiar a imagem
    await copyFileAsync(imagePath, uniqueImagePath);
    
    // Verificar se a cópia foi bem-sucedida
    if (!await existsAsync(uniqueImagePath)) {
      return {
        success: false,
        error: `Falha ao criar cópia do arquivo: ${uniqueImagePath}`
      };
    }
    
    // Criar URL para acesso à imagem (usando formato de URL compatível com o frontend)
    const userId = product.userId;
    const catalogId = product.catalogId;
    // Incluímos um timestamp na URL para evitar problemas de cache
    const url = `https://mock-firebase-storage.com/${userId}/${catalogId}/${uniqueId}?t=${timestamp}`;
    
    // Atualizar o produto com a nova URL
    await storage.updateProduct(productId, { imageUrl: url });
    
    console.log(`Produto ${productId} atualizado com nova URL de imagem: ${url}`);
    
    return {
      success: true,
      path: uniqueImagePath,
      url
    };
    
  } catch (error) {
    console.error('Erro ao criar cópia exclusiva de imagem:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}