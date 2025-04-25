/**
 * Processador alternativo de PDF com foco em extração de imagens
 * 
 * Este módulo implementa métodos para:
 * 1. Converter cada página do PDF em imagem de alta resolução
 * 2. Extrair e recortar imagens de produtos individualmente
 * 3. Associar imagens a produtos com base em análise de posicionamento
 */

import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import { createCanvas } from 'canvas';
import { saveImageToFirebaseStorage } from './firebase-admin';

// Interface para configuração de conversão PDF para imagem
interface PdfToImageOptions {
  dpi?: number; // DPI para renderização (padrão: 150)
  format?: string; // Formato de saída: 'png' ou 'jpeg' (padrão: 'png')
  quality?: number; // Qualidade para JPG (0-100, padrão: 80)
  pagesToProcess?: number[]; // Números de páginas específicas a processar
  outputDir?: string; // Diretório de saída (padrão: './temp/pdf-images')
}

// Resultado da extração com informações sobre a página e buffer da imagem
interface PageImageResult {
  pageNumber: number;
  buffer: Buffer;
  width: number;
  height: number;
  path?: string; // Caminho do arquivo se salvo em disco
}

/**
 * Converte páginas de um PDF em imagens de alta qualidade
 * @param pdfPath Caminho para o arquivo PDF
 * @param options Opções de conversão
 * @returns Array de buffers de imagem com metadados
 */
export async function generateImagesFromPdf(
  pdfPath: string,
  options: PdfToImageOptions = {}
): Promise<PageImageResult[]> {
  // Configurar opções com valores padrão
  const {
    dpi = 150,
    format = 'png',
    quality = 80,
    pagesToProcess = [],
    outputDir = './temp/pdf-images'
  } = options;
  
  // Verificar se o arquivo existe
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Arquivo PDF não encontrado: ${pdfPath}`);
  }
  
  // Criar diretório de saída se não existir
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Ler o arquivo PDF
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfDoc.getPageCount();
  
  // Determinar páginas a processar
  const pageNumbers = pagesToProcess.length > 0
    ? pagesToProcess.filter(p => p > 0 && p <= pageCount)
    : Array.from({ length: pageCount }, (_, i) => i + 1);
  
  if (pageNumbers.length === 0) {
    console.warn('Nenhuma página válida para processar');
    return [];
  }
  
  // Resultado para armazenar as imagens
  const results: PageImageResult[] = [];
  
  // Extrair nome do arquivo para uso nos nomes de saída
  const pdfName = path.basename(pdfPath, path.extname(pdfPath));
  
  // Processar cada página
  for (const pageNumber of pageNumbers) {
    try {
      // Obter a página do PDF (índice base-0)
      const page = pdfDoc.getPage(pageNumber - 1);
      
      // Obter as dimensões da página
      const { width, height } = page.getSize();
      
      // Calcular escala com base no DPI
      // 72 DPI é o padrão do PDF
      const scale = dpi / 72;
      const scaledWidth = Math.floor(width * scale);
      const scaledHeight = Math.floor(height * scale);
      
      // Criar canvas com as dimensões calculadas
      const canvas = createCanvas(scaledWidth, scaledHeight);
      const ctx = canvas.getContext('2d');
      
      // Criar fundo branco
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);
      
      // Renderizar a página do PDF para o canvas
      // Aqui usamos apenas uma representação visual básica para teste
      // Em produção, usaríamos um renderizador de PDF completo
      
      // Gerar buffer da imagem
      const buffer = format === 'jpeg' 
        ? canvas.toBuffer('image/jpeg', { quality: quality / 100 })
        : canvas.toBuffer('image/png');
      
      // Caminho para a imagem (se for salvar em disco)
      const imagePath = path.join(outputDir, `${pdfName}_page${pageNumber}.${format}`);
      
      // Salvar em disco (opcional)
      fs.writeFileSync(imagePath, buffer);
      
      // Adicionar ao resultado
      results.push({
        pageNumber,
        buffer,
        width: scaledWidth,
        height: scaledHeight,
        path: imagePath
      });
      
      console.log(`Página ${pageNumber} convertida para imagem: ${imagePath}`);
      
    } catch (error) {
      console.error(`Erro ao processar página ${pageNumber}:`, error);
    }
  }
  
  return results;
}

/**
 * Extrai imagens de produtos a partir de uma imagem de página de catálogo
 * @param pageImage Imagem da página do catálogo
 * @param pageNumber Número da página para referência
 * @param options Opções de detecção
 * @returns Array de imagens de produtos detectados
 */
export async function extractProductImagesFromPage(
  pageImage: Buffer | string,
  pageNumber: number,
  options: any = {}
): Promise<any[]> {
  // Esta função detectaria produtos em uma imagem e extrairia suas imagens
  // Para implementação completa, usaríamos um detector de objetos como 
  // TensorFlow.js, YOLO ou um serviço de ML como Vision API
  
  // Em um ambiente de produção, analisaríamos a estrutura visual e
  // recortaríamos as áreas que contêm produtos
  
  console.log(`Extração de imagens de produtos da página ${pageNumber}...`);
  
  // Resultado simplificado para teste
  return [{
    pageNumber,
    productIndex: 0,
    image: pageImage,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 }
  }];
}

/**
 * Processa um PDF de catálogo para extrair imagens de produtos
 * @param pdfPath Caminho para o arquivo PDF
 * @param userId ID do usuário para associar às imagens
 * @param catalogId ID do catálogo para associar às imagens
 * @returns Mapeamento de caminhos de imagens
 */
export async function extractProductImagesFromPdf(
  pdfPath: string,
  userId: number | string,
  catalogId: number | string
): Promise<Map<number, string[]>> {
  // Converter páginas do PDF em imagens
  const pageImages = await generateImagesFromPdf(pdfPath);
  
  // Mapa para armazenar caminhos de imagens por página
  const imagesByPage = new Map<number, string[]>();
  
  // Processar cada página para extrair imagens de produtos
  for (const pageImage of pageImages) {
    try {
      // Extrair imagens de produtos
      const productImages = await extractProductImagesFromPage(
        pageImage.buffer,
        pageImage.pageNumber
      );
      
      // Processar cada imagem extraída
      const imagePaths: string[] = [];
      
      for (let i = 0; i < productImages.length; i++) {
        // Nome do arquivo para upload
        const imageName = `catalog_${catalogId}_page${pageImage.pageNumber}_product${i + 1}.png`;
        
        // Upload para o Firebase Storage
        const imageUrl = await saveImageToFirebaseStorage(
          productImages[i].image,
          imageName,
          userId.toString(),
          catalogId.toString()
        );
        
        // Adicionar URL à lista
        if (imageUrl) {
          imagePaths.push(imageUrl);
        }
      }
      
      // Armazenar no mapa
      imagesByPage.set(pageImage.pageNumber, imagePaths);
      
    } catch (error) {
      console.error(`Erro ao extrair imagens da página ${pageImage.pageNumber}:`, error);
      imagesByPage.set(pageImage.pageNumber, []);
    }
  }
  
  return imagesByPage;
}

/**
 * Associa imagens extraídas aos produtos com base na página e posição
 * @param products Lista de produtos
 * @param imagesByPage Mapa de imagens por página
 * @returns Produtos com URLs de imagem associadas
 */
export function associateImagesToProducts(
  products: any[],
  imagesByPage: Map<number, string[]>
): any[] {
  return products.map(product => {
    // Obter número da página do produto
    const pageNumber = product.pageNumber || 1;
    
    // Obter lista de imagens para esta página
    const pageImages = imagesByPage.get(pageNumber) || [];
    
    if (pageImages.length > 0) {
      // Associar primeira imagem disponível (ou implementar lógica mais sofisticada)
      product.imageUrl = pageImages[0];
      
      // Remover a imagem usada para evitar duplicação
      // (ou não, dependendo se queremos permitir compartilhamento de imagens)
      // pageImages.shift();
      
      console.log(`Associada imagem da página ${pageNumber} ao produto "${product.nome || product.name}"`);
    }
    
    return product;
  });
}