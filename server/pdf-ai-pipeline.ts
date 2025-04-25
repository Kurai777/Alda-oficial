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
import { processImageWithClaude } from './claude-ai-extractor';
import { saveImageToFirebaseStorage } from './firebase-admin';
import { extractAllProductImages } from './image-extractor';

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
    
    // 2. Processar cada página (imagem) para extrair produtos
    // Para demonstração, alternamos entre OpenAI e Claude para as primeiras páginas
    let allProducts: ExtractedProduct[] = [];
    
    // Processar primeiras páginas com OpenAI (limite para demonstração)
    const pagesForOpenAI = pdfImages.slice(0, Math.min(3, pdfImages.length));
    
    for (let i = 0; i < pagesForOpenAI.length; i++) {
      const pageBuffer = pagesForOpenAI[i];
      const fileName = `page_${i + 1}_${path.basename(pdfPath, '.pdf')}.png`;
      
      try {
        // Salvar imagem da página no Firebase
        const pageImageUrl = await saveImageToFirebaseStorage(
          pageBuffer,
          fileName,
          userId,
          catalogId
        );
        
        // Extrair produtos da imagem usando OpenAI
        const pageProducts = await processFileWithAdvancedAI(
          pageBuffer,
          fileName,
          userId,
          catalogId
        );
        
        // Adicionar metadados adicionais
        const enhancedProducts = pageProducts.map(product => ({
          ...product,
          pageNumber: i + 1,
          pageImageUrl: pageImageUrl || undefined
        }));
        
        allProducts = [...allProducts, ...enhancedProducts];
        console.log(`Processada página ${i + 1} com OpenAI: ${pageProducts.length} produtos extraídos`);
        
      } catch (error) {
        console.error(`Erro ao processar página ${i + 1} com OpenAI:`, error);
      }
    }
    
    // 3. Processar algumas páginas adicionais com Claude (opcionalmente, para demonstração)
    if (pdfImages.length > 3) {
      const pagesForClaude = pdfImages.slice(3, Math.min(5, pdfImages.length));
      
      for (let i = 0; i < pagesForClaude.length; i++) {
        const pageIndex = i + 3; // Começando da página 4
        const pageBuffer = pagesForClaude[i];
        const fileName = `page_${pageIndex + 1}_${path.basename(pdfPath, '.pdf')}.png`;
        
        try {
          // Extrair produtos da imagem usando Claude
          const pageProducts = await processImageWithClaude(
            pageBuffer,
            fileName,
            userId,
            catalogId,
            pageIndex + 1
          );
          
          allProducts = [...allProducts, ...pageProducts];
          console.log(`Processada página ${pageIndex + 1} com Claude: ${pageProducts.length} produtos extraídos`);
          
        } catch (error) {
          console.error(`Erro ao processar página ${pageIndex + 1} com Claude:`, error);
        }
      }
    }
    
    // 4. Deduplicar produtos com base no código
    const uniqueProducts = deduplicateProducts(allProducts);
    console.log(`Extração concluída: ${uniqueProducts.length} produtos únicos identificados`);
    
    return uniqueProducts;
    
  } catch (error) {
    console.error('Erro no pipeline de processamento de PDF:', error);
    throw new Error(`Falha no processamento do PDF: ${error.message}`);
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