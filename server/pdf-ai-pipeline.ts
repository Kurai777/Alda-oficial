/**
 * Pipeline completo para processamento de PDFs com IA
 * 
 * Este módulo coordena a extração de imagens do PDF, processamento com IA
 * para identificar produtos e suas características, e o armazenamento
 * das imagens dos produtos no Firebase Storage.
 */

import fs from 'fs';
import path from 'path';
import { generateImagesFromPdf } from './alternative-pdf-processor';
import { processImageWithOpenAI, processFileWithAdvancedAI } from './advanced-ai-extractor';
import { extractAllProductImages } from './image-extractor';
import sharp from 'sharp';

/**
 * Interface para produto extraído dos catálogos
 */
export interface ExtractedProduct {
  nome: string;
  codigo: string;
  descricao?: string;
  preco?: string;
  fornecedor?: string;
  categoria?: string;
  dimensoes?: {
    altura?: number;
    largura?: number;
    profundidade?: number;
  };
  cores?: string[];
  materiais?: string[];
  imageUrl?: string;
  pageNumber?: number;
}

/**
 * Converte um PDF em array de buffers de imagem (um por página)
 * @param pdfPath Caminho para o arquivo PDF
 * @returns Array de Buffers com as imagens das páginas
 */
export async function convertPdfToImages(pdfPath: string): Promise<Buffer[]> {
  try {
    // Confirmar que o arquivo existe
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo PDF não encontrado: ${pdfPath}`);
    }
    
    // Criar diretório temporário para as imagens se não existir
    const tempDir = path.join(__dirname, '../temp/pdf-images');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Usar o processador de PDF para gerar imagens
    const pdfImages = await generateImagesFromPdf(pdfPath, {
      dpi: 200, // Resolução suficiente para OCR
      outputDir: tempDir
    });
    
    // Retornar os buffers das imagens
    return pdfImages.map(img => img.buffer);
    
  } catch (error) {
    console.error('Erro ao converter PDF para imagens:', error);
    throw new Error(`Falha ao processar o PDF: ${error.message}`);
  }
}

/**
 * Extrai a imagem individual do produto de uma página do PDF
 * @param pageBuffer Buffer da imagem da página
 * @param pageNumber Número da página
 * @param outputDir Diretório para salvar a imagem extraída
 * @param fileName Nome base do arquivo
 * @returns Caminho para a imagem extraída
 */
async function extractProductImageFromPage(
  pageBuffer: Buffer,
  pageNumber: number,
  outputDir: string,
  fileName: string
): Promise<string> {
  try {
    // Garantir que o diretório de saída exista
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Para catálogos Fratini, sabemos que as imagens de produtos geralmente estão
    // no topo da página, ocupando aproximadamente 40-60% da altura
    
    // Criar uma imagem temporária para análise
    const tempImagePath = path.join(outputDir, `temp_${pageNumber}_${Date.now()}.png`);
    await fs.promises.writeFile(tempImagePath, pageBuffer);
    
    // Obter dimensões da imagem
    const metadata = await sharp(pageBuffer).metadata();
    const { width = 800, height = 1000 } = metadata;
    
    // Para catálogos Fratini, a imagem do produto geralmente ocupa o terço superior da página
    const productImageTop = Math.floor(height * 0.05);  // 5% do topo
    const productImageHeight = Math.floor(height * 0.35); // 35% da altura
    const productImageWidth = Math.floor(width * 0.8);  // 80% da largura
    const productImageLeft = Math.floor((width - productImageWidth) / 2); // centralizado
    
    console.log(`Extraindo imagem do produto da página ${pageNumber} em: top=${productImageTop}, height=${productImageHeight}`);
    
    // Recortar a área onde provavelmente está a imagem do produto
    const productImageBuffer = await sharp(pageBuffer)
      .extract({
        left: productImageLeft,
        top: productImageTop,
        width: productImageWidth,
        height: productImageHeight
      })
      .toBuffer();
    
    // Salvar a imagem do produto extraída
    const outputFilename = `product_${fileName}_page${pageNumber}_${Date.now()}.png`;
    const outputPath = path.join(outputDir, outputFilename);
    await fs.promises.writeFile(outputPath, productImageBuffer);
    
    console.log(`Extraída imagem de produto da página ${pageNumber} em: ${outputPath}`);
    
    // Remover imagem temporária
    fs.unlinkSync(tempImagePath);
    
    return outputPath;
  } catch (error) {
    console.error(`Erro ao extrair imagem do produto da página ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Função principal que executa o pipeline completo de processamento de PDF
 * @param pdfPath Caminho para o arquivo PDF
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Lista de produtos extraídos com suas imagens
 */
export async function processPdfWithAI(
  pdfPath: string,
  userId: string,
  catalogId: string
): Promise<ExtractedProduct[]> {
  try {
    console.log(`Iniciando processamento de PDF: ${pdfPath}`);
    
    // 1. Converter PDF para imagens
    const pdfImages = await convertPdfToImages(pdfPath);
    console.log(`PDF convertido em ${pdfImages.length} imagens`);
    
    // Diretório para imagens extraídas de produtos
    const productImagesDir = path.join(process.cwd(), 'uploads', 'product_images');
    if (!fs.existsSync(productImagesDir)) {
      fs.mkdirSync(productImagesDir, { recursive: true });
    }
    
    // 2. Processar cada página (imagem) para extrair produtos
    // Agora processamos TODAS as páginas em vez de apenas as primeiras
    let allProducts: ExtractedProduct[] = [];
    
    // Processar todas as páginas com OpenAI
    for (let i = 0; i < pdfImages.length; i++) {
      const pageBuffer = pdfImages[i];
      const pageNumber = i + 1;
      const fileName = `${path.basename(pdfPath, '.pdf')}`;
      
      try {
        // Extrair a imagem do produto da página
        const productImagePath = await extractProductImageFromPage(
          pageBuffer,
          pageNumber,
          productImagesDir,
          fileName
        );
        
        // Ler o buffer da imagem extraída do produto
        const productImageBuffer = await fs.promises.readFile(productImagePath);
        
        // Converter caminho absoluto para caminho relativo para armazenamento no banco de dados
        const relativeProductImagePath = '/' + path.relative(process.cwd(), productImagePath);
        
        // Extrair produtos da imagem usando OpenAI
        const pageProducts = await processFileWithAdvancedAI(
          pageBuffer, // Enviamos a página completa para análise do texto
          fileName,
          userId,
          catalogId
        );
        
        // Adicionar metadados adicionais e a imagem isolada do produto
        const enhancedProducts = pageProducts.map(product => ({
          ...product,
          pageNumber,
          // Usar o caminho da imagem isolada do produto em vez da página completa
          imageUrl: relativeProductImagePath 
        }));
        
        allProducts = [...allProducts, ...enhancedProducts];
        console.log(`Processada página ${pageNumber} com OpenAI: ${pageProducts.length} produtos extraídos`);
        
      } catch (error) {
        console.error(`Erro ao processar página ${pageNumber}:`, error);
      }
    }
    
    // 3. Deduplicar produtos com base no código e garantir que cada um tenha uma imagem
    const uniqueProducts = deduplicateProducts(allProducts);
    console.log(`Extração concluída: ${uniqueProducts.length} produtos únicos identificados`);
    
    return uniqueProducts;
    
  } catch (error) {
    console.error('Erro no pipeline de processamento de PDF:', error);
    throw new Error(`Falha no processamento do PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Remove produtos duplicados da lista com base no código
 * @param products Lista de produtos extraídos
 * @returns Lista de produtos sem duplicatas
 */
function deduplicateProducts(products: ExtractedProduct[]): ExtractedProduct[] {
  const productMap = new Map<string, ExtractedProduct>();
  
  // Para cada produto, verificar se já existe um com o mesmo código
  for (const product of products) {
    const codigo = product.codigo;
    
    // Pular produtos sem código
    if (!codigo) continue;
    
    // Se o produto já existe no map, mesclar informações
    if (productMap.has(codigo)) {
      const existingProduct = productMap.get(codigo)!;
      
      // Manter a imagem se existir
      if (product.imageUrl && !existingProduct.imageUrl) {
        existingProduct.imageUrl = product.imageUrl;
      }
      
      // Manter informações mais completas
      if (product.descricao && (!existingProduct.descricao || existingProduct.descricao.length < product.descricao.length)) {
        existingProduct.descricao = product.descricao;
      }
      
      if (product.preco && !existingProduct.preco) {
        existingProduct.preco = product.preco;
      }
      
      // Mesclar arrays
      if (product.cores && Array.isArray(product.cores)) {
        existingProduct.cores = Array.from(new Set([
          ...(existingProduct.cores || []),
          ...product.cores
        ]));
      }
      
      if (product.materiais && Array.isArray(product.materiais)) {
        existingProduct.materiais = Array.from(new Set([
          ...(existingProduct.materiais || []),
          ...product.materiais
        ]));
      }
      
    } else {
      // Se o produto não existe, adicionar ao map
      productMap.set(codigo, { ...product });
    }
  }
  
  // Converter o map de volta para array
  return Array.from(productMap.values());
}