import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Analisador avançado de Excel com suporte a imagens
 * 
 * Este módulo implementa funções para analisar arquivos Excel,
 * extraindo posicionamento preciso de imagens e relacionando-as
 * com dados de células próximas para melhorar a associação
 * entre produtos e suas imagens.
 */

// Análise avançada do Excel incluindo posicionamento de imagens e células próximas
export async function analyzeExcelAdvanced(filePath: string): Promise<{
  hasImages: boolean;
  type: string;
  structure: any;
  imageInfo?: Array<{
    imageName: string;
    row: number;
    col: number;
    nearbyData?: {
      left?: string | null;
      right?: string | null;
      top?: string | null;
      bottom?: string | null;
      sameCellValue?: string | null;
    };
  }>;
}> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const worksheet = workbook.getWorksheet(1);
    
    // Verificar a estrutura do documento
    const columns: any[] = [];
    
    if (worksheet && worksheet.columns) {
      worksheet.columns.forEach((column, index) => {
        columns.push({
          index,
          key: column.key || `Column ${index + 1}`, 
        });
      });
    }
    
    // Informações sobre imagens e seus arredores
    let hasImages = false;
    const imageInfo: Array<{
      imageName: string;
      row: number;
      col: number;
      nearbyData?: {
        left?: string | null;
        right?: string | null;
        top?: string | null;
        bottom?: string | null;
        sameCellValue?: string | null;
      };
    }> = [];
    
    try {
      if (worksheet && (worksheet as any)._images && (worksheet as any)._images.length > 0) {
        hasImages = true;
        
        // Coletar informações sobre cada imagem e seus arredores para mapeamento
        for (const img of (worksheet as any)._images) {
          const imageName = img.name || `image${img.index || imageInfo.length + 1}`;
          const row = img.range.tl.nativeRow + 1; // Converte para 1-based para compatibilidade
          const col = img.range.tl.nativeCol + 1; // Converte para 1-based
          
          // Buscar dados em células próximas para melhorar a associação
          const nearbyData: {
            left?: string | null;
            right?: string | null;
            top?: string | null;
            bottom?: string | null;
            sameCellValue?: string | null;
          } = {};
          
          // Valor na mesma célula (pode ocorrer em alguns Excels)
          try {
            const sameCell = worksheet.getCell(row, col);
            nearbyData.sameCellValue = sameCell && sameCell.value ? String(sameCell.value) : null;
          } catch (e) {
            nearbyData.sameCellValue = null;
          }
          
          // Célula à esquerda
          if (col > 1) {
            try {
              const leftCell = worksheet.getCell(row, col - 1);
              nearbyData.left = leftCell && leftCell.value ? String(leftCell.value) : null;
            } catch (e) {
              nearbyData.left = null;
            }
          }
          
          // Célula à direita
          try {
            const rightCell = worksheet.getCell(row, col + 1);
            nearbyData.right = rightCell && rightCell.value ? String(rightCell.value) : null;
          } catch (e) {
            nearbyData.right = null;
          }
          
          // Célula acima
          if (row > 1) {
            try {
              const topCell = worksheet.getCell(row - 1, col);
              nearbyData.top = topCell && topCell.value ? String(topCell.value) : null;
            } catch (e) {
              nearbyData.top = null;
            }
          }
          
          // Célula abaixo
          try {
            const bottomCell = worksheet.getCell(row + 1, col);
            nearbyData.bottom = bottomCell && bottomCell.value ? String(bottomCell.value) : null;
          } catch (e) {
            nearbyData.bottom = null;
          }
          
          imageInfo.push({
            imageName,
            row,
            col,
            nearbyData
          });
        }
      }
    } catch (error) {
      console.error('Erro ao analisar imagens com ExcelJS:', error);
    }
    
    return {
      hasImages,
      type: 'xlsx',
      structure: {
        columnCount: columns.length,
        columns
      },
      imageInfo: hasImages ? imageInfo : undefined
    };
  } catch (error) {
    console.error('Erro ao analisar Excel avançado:', error);
    return {
      hasImages: false,
      type: 'unknown',
      structure: null
    };
  }
}

// Análise básica do arquivo Excel sem processamento de imagens
export async function analyzeExcelBasic(filePath: string): Promise<{ hasImages: boolean; type: string; structure: any }> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const worksheet = workbook.getWorksheet(1);
    
    // Verificar a estrutura do documento (sem processar imagens)
    const columns: any[] = [];
    
    if (worksheet && worksheet.columns) {
      worksheet.columns.forEach((column, index) => {
        columns.push({
          index,
          key: column.key || `Column ${index + 1}`, 
        });
      });
    }
    
    // Tentativa de acessar as imagens (apenas para verificar se existem)
    let hasImages = false;
    
    try {
      if (worksheet && (worksheet as any)._images && (worksheet as any)._images.length > 0) {
        hasImages = true;
      }
    } catch (error) {
      console.error('Erro ao verificar imagens com ExcelJS:', error);
    }
    
    return {
      hasImages,
      type: 'xlsx',
      structure: {
        columnCount: columns.length,
        columns
      }
    };
  } catch (error) {
    console.error('Erro ao analisar Excel:', error);
    return {
      hasImages: false,
      type: 'unknown',
      structure: null
    };
  }
}

/**
 * Identifica a associação correta entre produtos e imagens usando dados contextuais
 * 
 * @param products Lista de produtos extraídos do Excel
 * @param imageInfo Informações sobre imagens extraídas incluindo posicionamento
 * @returns Lista de produtos com URLs de imagens atualizadas para correspondência correta
 */
export function associateProductsWithImages(
  products: any[],
  imageInfo: Array<{
    imageName: string;
    row: number;
    col: number;
    nearbyData?: {
      left?: string | null;
      right?: string | null;
      top?: string | null;
      bottom?: string | null;
      sameCellValue?: string | null;
    };
    extractedPath?: string;
  }>
): any[] {
  // Se não temos imagens ou produtos, retornar os produtos como estão
  if (!imageInfo || imageInfo.length === 0 || !products || products.length === 0) {
    return products;
  }
  
  // Clonar produtos para não modificar o array original
  const updatedProducts = [...products];
  
  // Mapeamento de características dos produtos para melhorar a correspondência
  const productKeywords = updatedProducts.map(product => ({
    id: product.id,
    name: product.name?.toLowerCase() || '',
    code: product.code?.toLowerCase() || '',
    description: product.description?.toLowerCase() || '',
    // Extrair qualquer número presente no código (para correspondência numérica)
    codeNumbers: (product.code?.match(/\d+/g) || []).join('')
  }));
  
  // Para cada imagem, encontrar o produto mais provável para associação
  for (const image of imageInfo) {
    // Prepara dados contextuais para matching
    const contextData = {
      left: image.nearbyData?.left?.toLowerCase() || '',
      right: image.nearbyData?.right?.toLowerCase() || '',
      top: image.nearbyData?.top?.toLowerCase() || '',
      bottom: image.nearbyData?.bottom?.toLowerCase() || '',
      sameCell: image.nearbyData?.sameCellValue?.toLowerCase() || ''
    };
    
    // Pontuação de correspondência para cada produto
    const matchScores = productKeywords.map((product, index) => {
      let score = 0;
      
      // Verificar correspondência exata com nome do produto
      if (contextData.left.includes(product.name) || 
          contextData.right.includes(product.name) ||
          contextData.top.includes(product.name) ||
          contextData.bottom.includes(product.name) ||
          contextData.sameCell.includes(product.name)) {
        score += 5;
      }
      
      // Verificar correspondência exata com código do produto
      if (contextData.left.includes(product.code) || 
          contextData.right.includes(product.code) ||
          contextData.top.includes(product.code) ||
          contextData.bottom.includes(product.code) ||
          contextData.sameCell.includes(product.code)) {
        score += 4;
      }
      
      // Verificar correspondência numérica (útil para códigos de produtos)
      if (product.codeNumbers) {
        if (contextData.left.includes(product.codeNumbers) || 
            contextData.right.includes(product.codeNumbers) ||
            contextData.top.includes(product.codeNumbers) ||
            contextData.bottom.includes(product.codeNumbers) ||
            contextData.sameCell.includes(product.codeNumbers)) {
          score += 3;
        }
      }
      
      // Correspondência parcial com partes da descrição
      const descriptionWords = product.description
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((word: string) => word.length > 3);
      
      for (const word of descriptionWords) {
        if (contextData.left.includes(word) || 
            contextData.right.includes(word) ||
            contextData.top.includes(word) ||
            contextData.bottom.includes(word) ||
            contextData.sameCell.includes(word)) {
          score += 1;
        }
      }
      
      return { productIndex: index, score };
    });
    
    // Ordenar por pontuação e obter o melhor match
    matchScores.sort((a, b) => b.score - a.score);
    
    if (matchScores.length > 0 && matchScores[0].score > 0) {
      const bestMatchIndex = matchScores[0].productIndex;
      
      // Construir URL da imagem no formato esperado pelo sistema
      const baseImageName = path.basename(image.imageName);
      const imageUrl = `https://mock-firebase-storage.com/1/local-4/${baseImageName}`;
      
      // Associar imagem ao produto
      updatedProducts[bestMatchIndex].imageUrl = imageUrl;
      updatedProducts[bestMatchIndex]._matchScore = matchScores[0].score;
      updatedProducts[bestMatchIndex]._matchedImage = baseImageName;
    }
  }
  
  return updatedProducts;
}