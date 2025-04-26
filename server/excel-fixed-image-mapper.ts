import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { ProcessedProduct } from './excel-processor';

interface ExcelImage {
  index: number;
  name: string;
  path: string;
  anchorRow?: number; // Posição Y aproximada da imagem
  altText?: string;   // Texto alternativo da imagem, se disponível
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
  extractedImagesDir: string,
  uniqueImagesDir: string
): Promise<ProductImageMapping[]> {
  // 1. Carregar todos os produtos do catálogo
  const products = await storage.getProductsByCatalogId(catalogId);
  
  // 2. Obter informações das imagens extraídas
  const images = getExtractedImagesInfo(extractedImagesDir);
  console.log(`Encontradas ${images.length} imagens para mapear em ${products.length} produtos`);
  
  const mappings: ProductImageMapping[] = [];
  
  // 3. Para cada produto, tentar encontrar a imagem correspondente
  for (const product of products) {
    // Ignorar produtos sem código ou com código vazio
    if (!product.code || product.code.trim() === '') continue;
    
    const productCode = product.code.toLowerCase().trim();
    let bestMatch: { image: ExcelImage; confidence: number } | null = null;
    
    // A. Primeira estratégia: correspondência exata por código no nome da imagem ou texto alternativo
    for (const image of images) {
      // Verificar correspondência por código no nome da imagem
      if (image.name.toLowerCase().includes(productCode) || 
          (image.altText && image.altText.toLowerCase().includes(productCode))) {
        // Correspondência exata por código tem confiança alta
        bestMatch = { image, confidence: 0.9 };
        break;
      }
    }
    
    // B. Segunda estratégia: correspondência por posição na planilha (±1 linha de tolerância)
    if (!bestMatch) {
      // Tentar extrair número de linha do produto
      const rowMatch = /row_(\d+)/.exec(product.description || '');
      if (rowMatch) {
        const productRow = parseInt(rowMatch[1], 10);
        
        for (const image of images) {
          if (image.anchorRow) {
            // Verificar se a imagem está ancorada próxima à linha do produto (±1 linha)
            const rowDifference = Math.abs(image.anchorRow - productRow);
            if (rowDifference <= 1) {
              const confidence = rowDifference === 0 ? 0.8 : 0.6; // Confiança menor se não for exatamente na mesma linha
              
              // Atualizar melhor correspondência apenas se for melhor que a atual
              if (!bestMatch || confidence > bestMatch.confidence) {
                bestMatch = { image, confidence };
              }
            }
          }
        }
      }
    }
    
    // C. Terceira estratégia: correspondência por índice (mantida para compatibilidade)
    if (!bestMatch) {
      // Extrair índice do produto
      const indexMatch = /index_(\d+)/.exec(product.description || '');
      if (indexMatch) {
        const productIndex = parseInt(indexMatch[1], 10);
        
        // Encontrar imagem com o mesmo índice
        const matchingImage = images.find(img => img.index === productIndex);
        if (matchingImage) {
          bestMatch = { image: matchingImage, confidence: 0.5 };
        }
      }
    }
    
    // D. Se ainda não encontrou, tentar pela linha mais próxima
    if (!bestMatch && product.description) {
      // Tentar extrair linha do produto de outras formas (ex: do código do produto)
      const codeMatch = /(\d+)/.exec(product.code);
      if (codeMatch) {
        const codeNumber = parseInt(codeMatch[0], 10);
        
        for (const image of images) {
          if (image.anchorRow) {
            // Usar uma tolerância maior agora
            const rowDifference = Math.abs(image.anchorRow - codeNumber);
            if (rowDifference <= 3) { // Tolerância maior
              bestMatch = { image, confidence: 0.3 };
              break;
            }
          }
        }
      }
    }
    
    // Se encontrou uma correspondência, criar uma cópia única da imagem
    if (bestMatch) {
      // Garantir que o diretório de imagens únicas existe
      if (!fs.existsSync(uniqueImagesDir)) {
        fs.mkdirSync(uniqueImagesDir, { recursive: true });
      }
      
      // Gerar nome de arquivo único baseado no código do produto e timestamp
      const timestamp = Date.now();
      const uniqueFilename = `${productCode.replace(/[^a-z0-9]/gi, '_')}_${product.id}_${timestamp}${path.extname(bestMatch.image.path)}`;
      const uniqueImagePath = path.join(uniqueImagesDir, uniqueFilename);
      
      // Copiar a imagem para o novo local
      fs.copyFileSync(bestMatch.image.path, uniqueImagePath);
      
      // Adicionar ao mapeamento
      mappings.push({
        productId: product.id,
        productCode: product.code,
        imagePath: uniqueImagePath,
        confidence: bestMatch.confidence
      });
      
      console.log(`Mapeada imagem para produto ${product.code} (ID: ${product.id}) com confiança ${bestMatch.confidence}`);
    }
  }
  
  return mappings;
}

/**
 * Obtém informações sobre as imagens extraídas, incluindo posição e texto alternativo se disponível
 */
function getExtractedImagesInfo(extractedImagesDir: string): ExcelImage[] {
  if (!fs.existsSync(extractedImagesDir)) {
    console.error(`Diretório de imagens extraídas não encontrado: ${extractedImagesDir}`);
    return [];
  }
  
  const images: ExcelImage[] = [];
  const files = fs.readdirSync(extractedImagesDir);
  
  for (const file of files) {
    if (!/\.(png|jpg|jpeg|gif)$/i.test(file)) continue;
    
    const filePath = path.join(extractedImagesDir, file);
    
    // Extrair índice da imagem (formato comum: img_X.png ou imageX.jpg)
    const indexMatch = /img_(\d+)|image(\d+)/i.exec(file);
    const index = indexMatch ? parseInt(indexMatch[1] || indexMatch[2], 10) : -1;
    
    // Ler metadados adicionais se existirem
    let anchorRow: number | undefined;
    let altText: string | undefined;
    
    const metadataPath = path.join(extractedImagesDir, `${path.basename(file, path.extname(file))}_metadata.json`);
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        anchorRow = metadata.anchorRow;
        altText = metadata.altText;
      } catch (error) {
        console.error(`Erro ao ler metadados da imagem ${file}:`, error);
      }
    }
    
    images.push({
      index,
      name: file,
      path: filePath,
      anchorRow,
      altText
    });
  }
  
  return images;
}

/**
 * Atualiza as URLs de imagens dos produtos com base no novo mapeamento
 */
export async function updateProductImageUrls(
  catalogId: number, 
  mappings: ProductImageMapping[]
): Promise<number> {
  let updatedCount = 0;
  
  for (const mapping of mappings) {
    try {
      // Criar URL relativa para a imagem
      const relativePath = mapping.imagePath.replace(process.cwd(), '');
      const imageUrl = `/api/product-images${relativePath}`;
      
      // Atualizar URL da imagem no produto
      await storage.updateProductImageUrl(mapping.productId, imageUrl);
      updatedCount++;
    } catch (error) {
      console.error(`Erro ao atualizar URL da imagem para o produto ${mapping.productId}:`, error);
    }
  }
  
  return updatedCount;
}

/**
 * Processo completo de correção de imagens para um catálogo
 */
export async function fixProductImages(
  catalogId: number
): Promise<{ detected: number; fixed: number; }> {
  const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
  const uniqueImagesDir = path.join(process.cwd(), 'uploads', 'unique-images');
  
  // Garantir que os diretórios existem
  if (!fs.existsSync(uniqueImagesDir)) {
    fs.mkdirSync(uniqueImagesDir, { recursive: true });
  }
  
  // 1. Mapear imagens para produtos
  const mappings = await mapImagesToProducts(catalogId, extractedImagesDir, uniqueImagesDir);
  
  // 2. Atualizar URLs das imagens dos produtos
  const updatedCount = await updateProductImageUrls(catalogId, mappings);
  
  return {
    detected: mappings.length,
    fixed: updatedCount
  };
}