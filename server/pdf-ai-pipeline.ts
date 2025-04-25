/**
 * Pipeline de processamento de PDF com IA
 * 
 * Este módulo implementa um fluxo completo para processamento de catálogos em PDF:
 * 1. Converte as páginas do PDF em imagens
 * 2. Analisa cada imagem com IA (OpenAI Vision) para extrair produtos
 * 3. Detecta e processa imagens de produtos
 * 4. Consolida os resultados em uma lista de produtos normalizada
 */

import fs from 'fs';
import path from 'path';
import { generateImagesFromPdf } from './alternative-pdf-processor';
import { processImageWithOpenAI } from './advanced-ai-extractor';
import { processImageWithClaude } from './claude-ai-extractor';
import { saveImageToFirebaseStorage } from './firebase-admin';
import { ExcelProduct } from './excel-processor';
import { extractDimensionsFromString, formatProductPrice } from './utils';

// Intervalo entre chamadas de API para evitar rate limiting
const API_CALL_DELAY = 1500; // ms

/**
 * Interface para configurações do processamento de PDF
 */
export interface PdfProcessingOptions {
  userId: number | string;
  catalogId: string | number;
  maxPages?: number;
  startPage?: number;
  useClaudeFallback?: boolean;
  extractImages?: boolean;
  maxProductsPerPage?: number;
}

/**
 * Espera por um tempo determinado
 * @param ms Milissegundos para esperar
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Função principal para processar um catálogo em PDF
 * @param pdfPath Caminho para o arquivo PDF
 * @param options Opções de processamento
 * @returns Lista de produtos extraídos
 */
export async function processCatalogPdf(
  pdfPath: string, 
  options: PdfProcessingOptions
): Promise<ExcelProduct[]> {
  
  console.log(`Iniciando processamento do PDF: ${pdfPath}`);
  const startTime = Date.now();
  
  try {
    // Extrair nome do arquivo para referência
    const fileName = path.basename(pdfPath);
    
    // Configurar opções padrão
    const {
      userId,
      catalogId,
      maxPages = 50,
      startPage = 1,
      useClaudeFallback = true,
      extractImages = true,
      maxProductsPerPage = 15
    } = options;
    
    // 1. Converter PDF em imagens
    console.log('Convertendo PDF em imagens...');
    const pageImages = await generateImagesFromPdf(pdfPath, {
      pagesToProcess: Array.from({ length: maxPages }, (_, i) => startPage + i)
    });
    
    console.log(`Conversão concluída. ${pageImages.length} páginas processadas.`);
    
    // 2. Processar cada página com IA
    console.log('Analisando páginas com IA...');
    
    let allProducts: ExcelProduct[] = [];
    let pageNumber = startPage;
    
    for (const pageImage of pageImages) {
      console.log(`Processando página ${pageNumber}...`);
      
      try {
        // Tentar primeiro com OpenAI
        let pageProducts: ExcelProduct[] = [];
        try {
          console.log(`Analisando página ${pageNumber} com OpenAI...`);
          const imageBase64 = pageImage.toString('base64');
          pageProducts = await processImageWithOpenAI(imageBase64, `${fileName}_p${pageNumber}`);
          
          // Limitar número de produtos por página se necessário
          if (pageProducts.length > maxProductsPerPage) {
            console.log(`Página ${pageNumber} retornou ${pageProducts.length} produtos. Limitando a ${maxProductsPerPage}.`);
            pageProducts = pageProducts.slice(0, maxProductsPerPage);
          }
          
        } catch (error) {
          // Falha na OpenAI, tentar com Claude se habilitado
          if (useClaudeFallback) {
            console.log(`Fallback: Analisando página ${pageNumber} com Claude...`);
            const imageBase64 = pageImage.toString('base64');
            pageProducts = await processImageWithClaude(imageBase64, `${fileName}_p${pageNumber}`, userId, catalogId);
          } else {
            console.error(`Erro ao processar página ${pageNumber} com IA:`, error);
            throw error;
          }
        }
        
        // Enriquecer produtos com metadados e normalizar
        pageProducts = pageProducts.map((product, index) => {
          return {
            ...product,
            // Garantir campos padronizados
            nome: product.nome || product.name || '',
            codigo: product.codigo || product.code || `${catalogId}-P${pageNumber}-${index + 1}`,
            preco: formatProductPrice(product.preco || product.price || 0),
            descricao: product.descricao || product.description || '',
            // Adicionar metadados
            pageNumber,
            catalogId,
            userId,
            processedAt: new Date().toISOString()
          };
        });
        
        console.log(`Extraídos ${pageProducts.length} produtos da página ${pageNumber}`);
        
        // Adicionar à lista completa
        allProducts = [...allProducts, ...pageProducts];
        
        // Esperar um pouco entre chamadas para evitar rate limiting
        await delay(API_CALL_DELAY);
      } catch (innerError) {
        console.error(`Erro ao processar página ${pageNumber}:`, innerError);
        // Continuar com a próxima página mesmo em caso de erro
      }
      
      pageNumber++;
    }
    
    // 3. Processar imagens de produtos se necessário
    if (extractImages && allProducts.length > 0) {
      console.log(`Extraindo imagens para ${allProducts.length} produtos...`);
      
      // Extrair e processar imagens de produtos (implementar futuramente)
      // Esta etapa extrairia recortes de imagens de produtos das páginas
      // e as associaria aos produtos correspondentes
    }
    
    // 4. Processar e normalizar detalhes
    console.log('Finalizando processamento...');
    allProducts = allProducts.map(product => {
      // Processar dimensões
      const dimensionsFromDescription = extractDimensionsFromString(product.descricao || '');
      
      return {
        ...product,
        // Outros processamentos específicos
        categoriaDetectada: detectarCategoria(product),
        materiaisDetectados: detectarMateriais(product),
        // Adicionar dimensões extraídas
        ...dimensionsFromDescription
      };
    });
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`Processamento concluído em ${duration.toFixed(2)}s. Extraídos ${allProducts.length} produtos.`);
    
    return allProducts;
    
  } catch (error) {
    console.error('Erro no processamento do PDF:', error);
    throw new Error(`Falha ao processar o PDF: ${error.message}`);
  }
}

/**
 * Detectar categoria do produto com base em sua descrição e nome
 * @param product Produto para análise
 * @returns Categoria detectada
 */
function detectarCategoria(product: ExcelProduct): string {
  const text = `${product.nome || ''} ${product.descricao || ''}`.toLowerCase();
  
  if (/sofa|sofá|sofas|sofás|chaise|recamier/i.test(text)) return 'Sofás';
  if (/mesa|mesas|bancada|escrivaninha/i.test(text)) return 'Mesas';
  if (/cadeira|cadeiras|poltrona|poltronas/i.test(text)) return 'Cadeiras';
  if (/armario|armário|estante|estantes|rack|racks/i.test(text)) return 'Armários e Estantes';
  if (/cama|camas|colchao|colchão|cabeceira/i.test(text)) return 'Camas';
  if (/comoda|cômoda|criado|criado-mudo|mudo/i.test(text)) return 'Cômoda e Criados';
  if (/acessorio|acessório|espelho|quadro|tapete/i.test(text)) return 'Acessórios';
  
  return 'Outros';
}

/**
 * Detectar materiais do produto com base em sua descrição
 * @param product Produto para análise
 * @returns Lista de materiais detectados
 */
function detectarMateriais(product: ExcelProduct): string[] {
  const text = `${product.nome || ''} ${product.descricao || ''}`.toLowerCase();
  const materiais: string[] = [];
  
  if (/madeira|lamin|mdp|mdf|jequitiba|pinus|eucalipto/i.test(text)) materiais.push('Madeira');
  if (/couro|courino|couro sintético|leath/i.test(text)) materiais.push('Couro');
  if (/tecido|algodao|algodão|cotton|veludo|linho|suede|linen/i.test(text)) materiais.push('Tecido');
  if (/vidro|glass|espelho|mirror/i.test(text)) materiais.push('Vidro');
  if (/metal|metalico|metálico|inox|ferro|aluminio|alumínio|aço/i.test(text)) materiais.push('Metal');
  if (/plastico|plástico|poliprop|polietil|acrilico|acrílico/i.test(text)) materiais.push('Plástico');
  if (/marmore|mármore|granito|quartzo|pedra/i.test(text)) materiais.push('Pedra');
  if (/rattan|vime|palha|junco|natural|fibra/i.test(text)) materiais.push('Fibras Naturais');
  
  return materiais;
}