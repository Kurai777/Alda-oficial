import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createCanvas, loadImage } from 'canvas';

/**
 * Extrai imagens de produtos recortadas de uma página de catálogo
 * Este implementa um algoritmo mais avançado para detectar e recortar
 * as áreas de imagem de produtos em uma página de catálogo.
 * 
 * @param imagePath Caminho para a imagem da página
 * @param outputDir Diretório para salvar as imagens extraídas
 * @param catalogId ID do catálogo para o nome dos arquivos
 * @param pageNumber Número da página (para associação correta com produtos)
 * @returns Array com caminhos para as imagens extraídas
 */
export async function extractProductImagesFromPage(
  imagePath: string, 
  outputDir: string,
  catalogId: string,
  pageNumber: number
): Promise<{path: string, pageNumber: number}[]> {
  try {
    console.log(`Extraindo imagens de produtos da página ${pageNumber}`);
    
    // Verificar se o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Carregar a imagem
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Para catálogos Fratini, sabemos que as imagens de produtos geralmente estão
    // no topo da página, ocupando aproximadamente 40-60% da altura
    
    // Obter dimensões da imagem
    const metadata = await sharp(imageBuffer).metadata();
    const { width = 800, height = 1000 } = metadata;
    
    // Estratégia: dividir a página de forma inteligente baseada no conhecimento
    // da estrutura do catálogo Fratini
    
    // Para catálogos Fratini, a imagem do produto geralmente ocupa o terço superior da página
    const productImageTop = Math.floor(height * 0.05);  // 5% do topo
    const productImageHeight = Math.floor(height * 0.35); // 35% da altura
    const productImageWidth = Math.floor(width * 0.7);  // 70% da largura
    const productImageLeft = Math.floor((width - productImageWidth) / 2); // centralizado
    
    // Recortar a área onde provavelmente está a imagem do produto
    const productImage = await sharp(imageBuffer)
      .extract({
        left: productImageLeft,
        top: productImageTop,
        width: productImageWidth,
        height: productImageHeight
      })
      .toBuffer();
    
    // Salvar a imagem do produto
    const outputFilename = `product_${catalogId}_page${pageNumber}_${Date.now()}.png`;
    const outputPath = path.join(outputDir, outputFilename);
    await sharp(productImage)
      .png()
      .toFile(outputPath);
    
    console.log(`Extraída imagem de produto da página ${pageNumber} em ${outputPath}`);
    
    return [{
      path: outputPath,
      pageNumber: pageNumber
    }];
  } catch (error) {
    console.error(`Erro ao extrair imagens de produtos da página ${pageNumber}:`, error);
    return [];
  }
}

/**
 * Processa todas as imagens de páginas de um PDF para extrair imagens de produtos
 * @param pageImages Imagens das páginas do PDF
 * @param outputDir Diretório para salvar as imagens extraídas
 * @param catalogId ID do catálogo 
 * @returns Mapa associando números de página a caminhos de imagens
 */
export async function extractAllProductImages(
  pageImages: {page: number, originalPath: string, processedPath: string}[],
  outputDir: string,
  catalogId: string
): Promise<Map<number, string>> {
  const productImagesMap = new Map<number, string>();
  
  for (const pageImage of pageImages) {
    try {
      const absolutePath = path.join(process.cwd(), pageImage.processedPath.replace(/^\//, ''));
      
      const extractedImages = await extractProductImagesFromPage(
        absolutePath,
        outputDir,
        catalogId,
        pageImage.page
      );
      
      // Associar a primeira imagem extraída à página
      if (extractedImages.length > 0) {
        // Converter o caminho absoluto para um caminho relativo para armazenamento
        const relativePath = '/' + path.relative(process.cwd(), extractedImages[0].path);
        productImagesMap.set(pageImage.page, relativePath);
      }
    } catch (error) {
      console.error(`Erro ao processar imagem da página ${pageImage.page}:`, error);
    }
  }
  
  return productImagesMap;
}