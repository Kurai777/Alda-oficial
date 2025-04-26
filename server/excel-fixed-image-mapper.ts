/**
 * Excel Fixed Image Mapper - Mapeador inteligente de imagens para produtos em planilhas Excel
 * 
 * Este módulo fornece funcionalidades para mapear imagens extraídas de arquivos Excel
 * para os produtos correspondentes, usando uma lógica mais robusta e inteligente:
 * 
 * 1. Tentativa por código do produto (correspondência exata)
 * 2. Tentativa por posição da imagem (Y) considerando tolerância de ±1 linha
 * 3. Tentativa por texto alternativo ou nome do arquivo de imagem
 */

import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { Product } from '@shared/schema';

// Interfaces
interface ExcelImage {
  index: number;       // Índice da imagem
  name: string;        // Nome do arquivo de imagem
  path: string;        // Caminho completo do arquivo
  anchorRow?: number;  // Posição Y aproximada da imagem na planilha
  altText?: string;    // Texto alternativo da imagem, se disponível
}

interface ProductImageMapping {
  productId: number;
  productCode: string;
  imagePath: string;
  confidence: number; // 0-1 indicando a confiança na correspondência
}

/**
 * Mapeia imagens para produtos com base em código, posição ou texto alternativo
 * utilizando uma estratégia de correspondência mais robusta
 */
export async function mapImagesToProducts(
  catalogId: number,
  extractedImagesDir: string
): Promise<ProductImageMapping[]> {
  // Obter produtos do catálogo
  const products = await storage.getProductsByCatalogId(catalogId);
  if (!products || products.length === 0) {
    console.error(`Nenhum produto encontrado para o catálogo ${catalogId}`);
    return [];
  }
  
  console.log(`Mapeando imagens para ${products.length} produtos no catálogo ${catalogId}`);
  
  // Obter informações sobre as imagens extraídas
  const extractedImages = getExtractedImagesInfo(extractedImagesDir);
  if (extractedImages.length === 0) {
    console.error(`Nenhuma imagem encontrada no diretório: ${extractedImagesDir}`);
    return [];
  }
  
  console.log(`Encontradas ${extractedImages.length} imagens extraídas em ${extractedImagesDir}`);
  
  // Mapeamento final de produtos para imagens
  const productImageMappings: ProductImageMapping[] = [];
  
  // Para cada produto, tentar encontrar a melhor imagem correspondente
  for (const product of products) {
    let bestMatch: { image: ExcelImage; confidence: number } | null = null;
    
    // 1. Tentar correspondência por código de produto (prioridade alta)
    if (product.code) {
      const codeMatch = extractedImages.find(img => {
        // Verificar se o nome da imagem ou texto alternativo contém o código
        const imgName = path.parse(img.name).name.toLowerCase();
        const altText = img.altText?.toLowerCase() || '';
        const productCode = product.code.toLowerCase();
        
        return imgName.includes(productCode) || altText.includes(productCode);
      });
      
      if (codeMatch) {
        bestMatch = { image: codeMatch, confidence: 0.9 }; // Alta confiança para correspondência de código
        console.log(`Encontrada correspondência por código para produto ${product.id} (${product.code}): ${codeMatch.name}`);
      }
    }
    
    // 2. Se não encontrou por código, tentar por posição com tolerância (Y ±1)
    if (!bestMatch && product.excelRowNumber) {
      // Procurar imagens próximas à linha do produto (±1 linha)
      const rowMatches = extractedImages.filter(img => {
        if (!img.anchorRow) return false;
        
        // Usar uma tolerância de ±1 linha
        const tolerance = 1;
        return Math.abs(img.anchorRow - product.excelRowNumber!) <= tolerance;
      });
      
      if (rowMatches.length > 0) {
        // Se encontrou múltiplas imagens, pegar a mais próxima
        rowMatches.sort((a, b) => {
          const distA = Math.abs((a.anchorRow || 0) - (product.excelRowNumber || 0));
          const distB = Math.abs((b.anchorRow || 0) - (product.excelRowNumber || 0));
          return distA - distB;
        });
        
        bestMatch = { 
          image: rowMatches[0], 
          confidence: rowMatches[0].anchorRow === product.excelRowNumber ? 0.85 : 0.7 
        };
        
        console.log(`Encontrada correspondência por posição para produto ${product.id} na linha ${product.excelRowNumber}: ${bestMatch.image.name} (anchorRow: ${bestMatch.image.anchorRow})`);
      }
    }
    
    // 3. Tentar por nome do produto ou descrição (prioridade mais baixa)
    if (!bestMatch && (product.name || product.description)) {
      const nameWords = (product.name || '').toLowerCase().split(/\s+/);
      const descWords = (product.description || '').toLowerCase().split(/\s+/);
      
      // Palavras significativas do produto (ignorar palavras muito curtas)
      const significantWords = [...nameWords, ...descWords]
        .filter(w => w.length > 3)
        .slice(0, 5); // Limitar a 5 palavras significativas
      
      if (significantWords.length > 0) {
        // Verificar cada imagem para correspondência de texto
        let bestTextMatch: { image: ExcelImage; matchCount: number } | null = null;
        
        for (const img of extractedImages) {
          const imgName = path.parse(img.name).name.toLowerCase();
          const altText = (img.altText || '').toLowerCase();
          const combinedText = `${imgName} ${altText}`;
          
          // Contar quantas palavras significativas correspondem
          const matchCount = significantWords.filter(word => 
            combinedText.includes(word)
          ).length;
          
          if (matchCount > 0 && (!bestTextMatch || matchCount > bestTextMatch.matchCount)) {
            bestTextMatch = { image: img, matchCount };
          }
        }
        
        if (bestTextMatch) {
          // Calcular confiança com base no número de palavras correspondentes
          const confidence = Math.min(0.6, 0.3 + (bestTextMatch.matchCount / significantWords.length) * 0.3);
          
          // Usar esta correspondência apenas se não encontramos nada melhor
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { image: bestTextMatch.image, confidence };
            console.log(`Encontrada correspondência por texto para produto ${product.id} (${product.name}): ${bestMatch.image.name}`);
          }
        }
      }
    }
    
    // 4. Se ainda não encontrou, atribuir a primeira imagem não utilizada (último recurso)
    if (!bestMatch && extractedImages.length > 0) {
      // Filtrar imagens já utilizadas
      const usedImagePaths = productImageMappings.map(m => m.imagePath);
      const unusedImages = extractedImages.filter(img => !usedImagePaths.includes(img.path));
      
      if (unusedImages.length > 0) {
        bestMatch = { image: unusedImages[0], confidence: 0.3 }; // Baixa confiança para correspondência aleatória
        console.log(`Atribuindo imagem não utilizada para produto ${product.id}: ${unusedImages[0].name} (baixa confiança)`);
      }
    }
    
    // Adicionar ao mapeamento se encontrou uma correspondência
    if (bestMatch) {
      productImageMappings.push({
        productId: product.id,
        productCode: product.code,
        imagePath: bestMatch.image.path,
        confidence: bestMatch.confidence
      });
    } else {
      console.warn(`Nenhuma imagem encontrada para o produto ${product.id} (${product.name})`);
    }
  }
  
  console.log(`Mapeamento concluído: ${productImageMappings.length} produtos com imagens mapeadas`);
  return productImageMappings;
}

/**
 * Obtém informações sobre as imagens extraídas, incluindo posição e texto alternativo se disponível
 */
function getExtractedImagesInfo(extractedImagesDir: string): ExcelImage[] {
  if (!fs.existsSync(extractedImagesDir)) {
    console.error(`Diretório não encontrado: ${extractedImagesDir}`);
    return [];
  }
  
  try {
    // Ler arquivos no diretório
    const files = fs.readdirSync(extractedImagesDir)
      .filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file));
    
    // Extrair informações de cada imagem
    const images: ExcelImage[] = files.map((fileName, index) => {
      const filePath = path.join(extractedImagesDir, fileName);
      const stats = fs.statSync(filePath);
      
      // Extrair informações do nome do arquivo
      // Formato possível: image1_row5_colB.png (onde 5 seria a linha da planilha)
      let anchorRow: number | undefined = undefined;
      const rowMatch = fileName.match(/(_row(\d+)_)|(-row(\d+)-)/);
      
      if (rowMatch) {
        anchorRow = parseInt(rowMatch[2] || rowMatch[4], 10);
      } else {
        // Tentar extrair do formato "imageXX.png" onde XX pode incluir o número da linha
        const numericMatch = fileName.match(/image(\d+)/i);
        if (numericMatch) {
          // Em alguns casos, o número da imagem pode corresponder aproximadamente à linha
          const imageNum = parseInt(numericMatch[1], 10);
          // Considerar como possível linha apenas se for um número razoável (< 100)
          if (imageNum > 0 && imageNum < 100) {
            anchorRow = imageNum;
          }
        }
      }
      
      // Texto alternativo (normalmente armazenado em um arquivo separado ou metadados)
      // Esta é uma implementação simplificada; uma versão completa poderia ler metadados da imagem
      const altTextPath = path.join(extractedImagesDir, `${path.parse(fileName).name}_alt.txt`);
      let altText: string | undefined = undefined;
      
      if (fs.existsSync(altTextPath)) {
        altText = fs.readFileSync(altTextPath, 'utf8').trim();
      }
      
      return {
        index,
        name: fileName,
        path: filePath,
        anchorRow,
        altText
      };
    });
    
    return images;
  } catch (error) {
    console.error('Erro ao ler informações das imagens:', error);
    return [];
  }
}

/**
 * Atualiza as URLs de imagens dos produtos com base no novo mapeamento
 */
export async function updateProductImageUrls(
  userId: number | string,
  catalogId: number,
  imageMappings: ProductImageMapping[]
): Promise<number> {
  let updatedCount = 0;
  
  // Criar diretório de destino para imagens
  const targetDir = path.join(process.cwd(), 'uploads', 'unique-product-images', `catalog-${catalogId}`);
  
  try {
    // Criar diretório recursivamente
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`Criado diretório para imagens únicas: ${targetDir}`);
    }
  } catch (dirError) {
    console.error(`Erro ao criar diretório ${targetDir}:`, dirError);
    // Continuar mesmo com erro, usando o diretório base
  }
  
  for (const mapping of imageMappings) {
    try {
      // Verificar se o arquivo original existe
      if (!fs.existsSync(mapping.imagePath)) {
        console.error(`Arquivo de imagem não encontrado: ${mapping.imagePath}`);
        continue;
      }
      
      // Criar nome de arquivo único com ID do produto
      const originalExt = path.extname(mapping.imagePath);
      const uniqueImageName = `product-${mapping.productId}-${mapping.productCode}${originalExt}`;
      const targetPath = path.join(targetDir, uniqueImageName);
      
      try {
        // Copiar a imagem para o diretório de destino
        fs.copyFileSync(mapping.imagePath, targetPath);
        console.log(`Imagem copiada para ${targetPath}`);
      } catch (copyError) {
        console.error(`Erro ao copiar imagem: ${copyError}`);
        continue;
      }
      
      // Construir URL relativa para a imagem
      const imageUrl = `/uploads/unique-product-images/catalog-${catalogId}/${uniqueImageName}`;
      
      // Adicionar um parâmetro de cache-busting para forçar o recarregamento
      const urlWithCacheBusting = `${imageUrl}?t=${Date.now()}`;
      
      // Atualizar URL da imagem do produto
      const updatedProduct = await storage.updateProductImageUrl(mapping.productId, urlWithCacheBusting);
      
      if (updatedProduct) {
        updatedCount++;
        console.log(`Atualizada URL de imagem para produto ${mapping.productId}: ${urlWithCacheBusting}`);
      } else {
        console.error(`Falha ao atualizar URL de imagem para produto ${mapping.productId}`);
      }
    } catch (error) {
      console.error(`Erro ao atualizar URL de imagem para produto ${mapping.productId}:`, error);
    }
  }
  
  console.log(`Total de ${updatedCount} produtos atualizados com novas URLs de imagens`);
  return updatedCount;
}

/**
 * Processo completo de correção de imagens para um catálogo
 */
export async function fixProductImages(
  userId: number | string,
  catalogId: number
): Promise<{ success: boolean; updated: number; message: string }> {
  try {
    console.log(`Iniciando correção de imagens para catálogo ${catalogId}`);
    
    // Definir possíveis diretórios de imagens para o catálogo
    const possibleDirs = [
      // Caminho específico por usuário/catálogo (estrutura ideal)
      path.join('uploads', 'users', String(userId), 'catalogs', String(catalogId), 'extracted_images'),
      // Diretório geral de imagens extraídas (usado na maioria dos casos)
      path.join('uploads', 'extracted_images'),
      // Diretório específico do catálogo (alternativa)
      path.join('uploads', 'extracted_images', `catalog-${catalogId}`),
      // Diretório temporário de imagens Excel (usado ao processar)
      path.join('uploads', 'temp-excel-images')
    ];
    
    // Encontrar o primeiro diretório válido
    let extractedImagesDir = null;
    for (const dir of possibleDirs) {
      if (fs.existsSync(dir)) {
        // Verificar se contém arquivos de imagem
        const files = fs.readdirSync(dir);
        const hasImages = files.some(file => /\.(png|jpg|jpeg|gif)$/i.test(file));
        
        if (hasImages) {
          extractedImagesDir = dir;
          console.log(`Encontrado diretório de imagens: ${dir}`);
          break;
        }
      }
    }
    
    // Verificar se encontrou um diretório válido
    if (!extractedImagesDir) {
      return { 
        success: false, 
        updated: 0, 
        message: `Nenhum diretório com imagens extraídas foi encontrado` 
      };
    }
    
    // 1. Mapear imagens para produtos
    const imageMappings = await mapImagesToProducts(catalogId, extractedImagesDir);
    
    if (imageMappings.length === 0) {
      return {
        success: false,
        updated: 0,
        message: "Nenhuma correspondência de imagem encontrada para os produtos"
      };
    }
    
    // 2. Atualizar URLs de imagens dos produtos
    const updatedCount = await updateProductImageUrls(userId, catalogId, imageMappings);
    
    return {
      success: true,
      updated: updatedCount,
      message: `${updatedCount} produtos atualizados com novas URLs de imagens`
    };
  } catch (error) {
    console.error('Erro ao corrigir imagens dos produtos:', error);
    return {
      success: false,
      updated: 0,
      message: `Erro ao processar correção de imagens: ${error}`
    };
  }
}

/**
 * Exporta as funções principais do módulo
 */
export default {
  mapImagesToProducts,
  updateProductImageUrls,
  fixProductImages
};