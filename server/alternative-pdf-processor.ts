/**
 * Processador alternativo de PDFs
 * 
 * Este módulo oferece implementações alternativas para extrair imagens de PDFs,
 * processar produtos e associar imagens específicas dos produtos.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ExtractedProduct } from './pdf-ai-pipeline';

const execPromise = promisify(exec);

interface PdfPage {
  pageNumber: number;
  buffer: Buffer;
  path: string;
}

interface PdfImageExtractionOptions {
  dpi?: number;
  pagesToProcess?: number[];
  outputDir?: string;
}

/**
 * Gera imagens das páginas de um PDF
 * @param pdfPath Caminho para o arquivo PDF
 * @param options Opções de extração
 * @returns Lista de objetos contendo buffers e metadados das imagens
 */
export async function generateImagesFromPdf(
  pdfPath: string,
  options: PdfImageExtractionOptions = {}
): Promise<PdfPage[]> {
  // Valores padrão
  const dpi = options.dpi || 150;
  const pagesToProcess = options.pagesToProcess || [];
  const outputDir = options.outputDir || path.join(__dirname, '../temp/pdf-images');
  
  try {
    // Garantir que o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Criar nome de arquivo base para as imagens
    const baseFileName = path.basename(pdfPath, '.pdf');
    const pagePattern = path.join(outputDir, `${baseFileName}-page-%d.png`);
    
    // Construir comando para converter PDF em imagens
    let command = `pdftoppm -png -r ${dpi} `;
    
    // Se páginas específicas foram solicitadas
    if (pagesToProcess.length > 0) {
      const pageRanges = pagesToProcess.map(p => `-f ${p} -l ${p}`).join(' ');
      command += `${pageRanges} `;
    }
    
    command += `"${pdfPath}" "${path.join(outputDir, baseFileName)}"`;
    
    // Executar o comando
    console.log(`Executando: ${command}`);
    await execPromise(command);
    
    // Localizar os arquivos gerados
    const files = fs.readdirSync(outputDir)
      .filter(file => file.startsWith(baseFileName) && file.endsWith('.png'))
      .sort(); // Garantir que as páginas estão em ordem
    
    // Criar array de objetos com os buffers das imagens
    const pages: PdfPage[] = await Promise.all(files.map(async (file, index) => {
      const filePath = path.join(outputDir, file);
      const buffer = await fs.promises.readFile(filePath);
      
      // Extrair número da página do nome do arquivo (formato: basename-page-X.png)
      const pageNumberMatch = file.match(/-(\d+)\.png$/);
      const pageNumber = pageNumberMatch ? parseInt(pageNumberMatch[1]) : index + 1;
      
      return {
        pageNumber,
        buffer,
        path: filePath
      };
    }));
    
    return pages;
    
  } catch (error) {
    console.error('Erro ao gerar imagens do PDF:', error);
    
    // Tentar alternativa com imagemagick se pdftoppm falhar
    try {
      console.log('Tentando método alternativo com imagemagick...');
      await execPromise(`convert -density ${dpi} "${pdfPath}" "${path.join(outputDir, baseFileName)}-%03d.png"`);
      
      const files = fs.readdirSync(outputDir)
        .filter(file => file.startsWith(baseFileName) && file.endsWith('.png'))
        .sort();
      
      const pages: PdfPage[] = await Promise.all(files.map(async (file, index) => {
        const filePath = path.join(outputDir, file);
        const buffer = await fs.promises.readFile(filePath);
        return {
          pageNumber: index + 1,
          buffer,
          path: filePath
        };
      }));
      
      return pages;
      
    } catch (error) {
      console.error('Erro ao usar método alternativo:', error);
      throw new Error(`Falha ao extrair imagens do PDF: ${error.message}`);
    }
  }
}

/**
 * Extrai imagens específicas dos produtos do PDF (SIMULAÇÃO)
 * @param pdfPath Caminho para o arquivo PDF
 * @param userId ID do usuário (REMOVIDO - não usado aqui)
 * @param catalogId ID do catálogo (REMOVIDO - não usado aqui)
 * @returns Mapa associando códigos de produtos a URLs de imagens (VAZIO NESTA VERSÃO)
 */
export async function extractProductImagesFromPdf(
  pdfPath: string,
  // userId: string,
  // catalogId: string
): Promise<Map<string, string>> {
  // Implementação simplificada - SIMULAÇÃO
  // Em um caso real, usaríamos detecção de objetos
  // A lógica de upload para S3/Firebase foi removida daqui.
  
  const productImagesMap = new Map<string, string>();
  console.warn("Função extractProductImagesFromPdf é apenas uma simulação e não extrai/salva imagens reais.");

  // try {
  //   // Extrair imagens das páginas
  //   const pageImages = await generateImagesFromPdf(pdfPath, {
  //     dpi: 200,
  //     outputDir: path.join(__dirname, '../temp/product-images')
  //   });
    
  //   // REMOVIDO Bloco de upload para Firebase
  //   // for (let i = 0; i < Math.min(pageImages.length, 5); i++) {
  //   //   const page = pageImages[i];
  //   //   const productCode = `PROD-${i + 100}`;
  //   //   const imageFileName = `product_${productCode}_${path.basename(pdfPath, '.pdf')}.png`;
  //   //   const imageUrl = await saveImageToFirebaseStorage(...);
  //   //   if (imageUrl) { productImagesMap.set(productCode, imageUrl); }
  //   // }
    
  // } catch (error) {
  //   console.error('Erro na simulação de extração de imagens de produtos:', error);
  // }
  
  // Retorna mapa vazio pois o upload/extração real foi removido
  return productImagesMap; 
}

/**
 * Associa imagens de produtos extraídas aos produtos correspondentes
 * @param products Lista de produtos extraídos
 * @param productImagesMap Mapa associando códigos de produtos a URLs de imagens
 * @returns Lista de produtos com imagens associadas
 */
export function associateImagesToProducts(
  products: ExtractedProduct[],
  productImagesMap: Map<string, string>
): ExtractedProduct[] {
  // Copiar os produtos para não modificar o array original
  const productsWithImages = [...products];
  
  // Para cada produto, verificar se há uma imagem correspondente no mapa
  for (const product of productsWithImages) {
    if (product.codigo && productImagesMap.has(product.codigo)) {
      product.imageUrl = productImagesMap.get(product.codigo);
    }
  }
  
  return productsWithImages;
}