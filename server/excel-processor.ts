import * as XLSX from 'xlsx';
import { readFile } from 'fs/promises';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';

export interface ExcelProduct {
  nome?: string;
  name?: string;
  descricao?: string;
  description?: string;
  codigo?: string;
  code?: string;
  preco?: string | number;
  price?: string | number;
  valor?: string | number;
  categoria?: string;
  category?: string;
  cores?: string;
  colors?: string;
  materiais?: string;
  materials?: string;
  imagem?: string;
  image?: string;
  imageUrl?: string;
  // Campos adicionais encontrados em planilhas de produtos
  largura?: string | number;
  width?: string | number;
  altura?: string | number;
  height?: string | number;
  profundidade?: string | number;
  depth?: string | number;
  estoque?: string | number;
  stock?: string | number;
  [key: string]: any;
}

/**
 * Processar um arquivo Excel para extrair produtos
 * @param filePath Caminho para o arquivo Excel
 * @returns Array de produtos processados
 */
export async function processExcelFile(filePath: string): Promise<any[]> {
  try {
    console.log(`Iniciando processamento do Excel: ${filePath}`);
    
    // Ler o arquivo com opções para arquivos grandes
    console.log(`Lendo arquivo Excel (pode demorar para arquivos grandes): ${filePath}`);
    const fileData = await readFile(filePath);
    console.log(`Arquivo lido com sucesso: ${(fileData.length / (1024*1024)).toFixed(2)} MB`);
    
    // Usar opções específicas para arquivos grandes
    const workbook = XLSX.read(fileData, {
      type: 'buffer',
      cellFormula: false, // Desabilitar fórmulas para melhorar desempenho
      cellHTML: false,    // Desabilitar HTML para melhorar desempenho
      cellStyles: false,  // Desabilitar estilos para melhorar desempenho
      cellDates: true,    // Manter datas
      cellNF: false,      // Não preservar formato numérico
      cellText: true      // Preservar texto
    });
    
    // Processar todas as planilhas do arquivo
    const allProducts: any[] = [];
    
    console.log(`Encontradas ${workbook.SheetNames.length} planilhas no arquivo Excel`);
    
    for (const sheetName of workbook.SheetNames) {
      try {
        console.log(`Processando planilha: ${sheetName}`);
        const worksheet = workbook.Sheets[sheetName];
        
        // Converter para JSON com opções específicas
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          defval: null,   // Valor padrão para células vazias
          raw: true       // Manter valores brutos
        });
        
        console.log(`Extraídos ${rawData.length} registros brutos da planilha ${sheetName}`);
        
        if (rawData.length > 0) {
          // Mapear para o formato de produto padrão
          const productsFromSheet = normalizeExcelProducts(rawData as ExcelProduct[]);
          allProducts.push(...productsFromSheet);
          console.log(`Processados ${productsFromSheet.length} produtos da planilha ${sheetName}`);
        }
      } catch (sheetError) {
        console.error(`Erro ao processar planilha ${sheetName}:`, sheetError);
        // Continuar para a próxima planilha mesmo se houver erro
      }
    }
    
    console.log(`Total de produtos extraídos de todas as planilhas: ${allProducts.length}`);
    
    return allProducts;
  } catch (error) {
    console.error('Erro ao processar arquivo Excel:', error);
    throw new Error(`Falha ao processar arquivo Excel: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

/**
 * Normaliza os dados brutos do Excel para o formato padrão de produtos
 * @param rawProducts Produtos brutos do Excel
 * @returns Produtos normalizados
 */
function normalizeExcelProducts(rawProducts: ExcelProduct[]): any[] {
  console.log(`Iniciando normalização de ${rawProducts.length} produtos brutos do Excel...`);
  
  // Arrays para armazenar os produtos normalizados
  const normalizedProducts: any[] = [];
  
  // Determinar possíveis nomes de campos com base na primeira linha
  const nameFields = ['nome', 'name', 'produto', 'product', 'titulo', 'title', 'item'];
  const codeFields = ['codigo', 'code', 'sku', 'referencia', 'reference', 'id', 'item_id'];
  const priceFields = ['preco', 'price', 'valor', 'value', 'custo', 'cost', 'preco_venda', 'sale_price'];
  
  // Detectar campos adicionais do cabeçalho
  const detectedNameFields: string[] = [];
  const detectedCodeFields: string[] = [];
  const detectedPriceFields: string[] = [];
  
  if (rawProducts.length > 0) {
    const firstProduct = rawProducts[0];
    const fields = Object.keys(firstProduct).map(k => k.toLowerCase());
    
    // Detectar campos por tipo
    fields.forEach(field => {
      if (field.includes('nome') || field.includes('name') || field.includes('produto') || 
         field.includes('product') || field.includes('item') || field.includes('titulo') || 
         field.includes('title')) {
        detectedNameFields.push(field);
      }
      
      if (field.includes('cod') || field.includes('code') || field.includes('sku') || 
          field.includes('ref') || field.includes('id')) {
        detectedCodeFields.push(field);
      }
      
      if (field.includes('prec') || field.includes('price') || field.includes('valor') || 
          field.includes('value') || field.includes('custo') || field.includes('cost')) {
        detectedPriceFields.push(field);
      }
    });
    
    console.log('Campos de nome detectados:', [...nameFields, ...detectedNameFields]);
    console.log('Campos de código detectados:', [...codeFields, ...detectedCodeFields]);
    console.log('Campos de preço detectados:', [...priceFields, ...detectedPriceFields]);
  }
  
  // Processamento em lotes para arquivos grandes
  const BATCH_SIZE = 1000;
  
  for (let i = 0; i < rawProducts.length; i += BATCH_SIZE) {
    const batch = rawProducts.slice(i, i + BATCH_SIZE);
    console.log(`Processando lote ${Math.floor(i/BATCH_SIZE) + 1} de ${Math.ceil(rawProducts.length/BATCH_SIZE)} (${batch.length} produtos)`);
    
    // Processar cada produto no lote
    for (const rawProduct of batch) {
      if (!rawProduct) continue;
      
      // Verificar se é um produto válido
      const allNameFields = [...nameFields, ...detectedNameFields];
      const allCodeFields = [...codeFields, ...detectedCodeFields];
      const allPriceFields = [...priceFields, ...detectedPriceFields];
      
      // Determinar o nome do produto
      let productName = '';
      for (const field of allNameFields) {
        if (rawProduct[field]) {
          productName = rawProduct[field];
          break;
        }
      }
      
      // Determinar o código do produto
      let productCode = '';
      for (const field of allCodeFields) {
        if (rawProduct[field]) {
          productCode = rawProduct[field];
          break;
        }
      }
      
      // Se não tivermos nome nem código, pular este produto
      if (!productName && !productCode) continue;
      
      // Determinar a descrição
      let description = rawProduct.descricao || rawProduct.description || '';
      
      // Determinar o preço
      let price = 0;
      let rawPrice = null;
      
      for (const field of allPriceFields) {
        if (rawProduct[field] !== null && rawProduct[field] !== undefined) {
          rawPrice = rawProduct[field];
          break;
        }
      }
      
      if (typeof rawPrice === 'number') {
        // Se já for um número, apenas multiplicar por 100 (converter para centavos)
        price = Math.round(rawPrice * 100);
      } else if (typeof rawPrice === 'string') {
        // Se for uma string, precisamos extrair o valor numérico
        // Remover R$, espaços, e substituir vírgula por ponto
        const cleanPrice = rawPrice
          .replace(/R\$\s*/g, '')
          .replace(/\s/g, '')
          .replace(/\./g, '')
          .replace(',', '.');
        
        // Converter para número e multiplicar por 100
        const numericPrice = parseFloat(cleanPrice);
        if (!isNaN(numericPrice)) {
          price = Math.round(numericPrice * 100);
        }
      }
      
      // Normalizar categoria
      let category = rawProduct.categoria || rawProduct.category || '';
      if (!category) {
        category = determineProductCategory(productName);
      }
      
      // Processar cores (pode ser string separada por vírgulas ou array)
      let colors: string[] = [];
      const rawColors = rawProduct.cores || rawProduct.colors;
      
      if (Array.isArray(rawColors)) {
        colors = rawColors.map(c => c?.toString().trim()).filter(Boolean);
      } else if (typeof rawColors === 'string') {
        colors = rawColors.split(/,|;/).map(c => c.trim()).filter(c => c);
      }
      
      // Processar materiais (pode ser string separada por vírgulas ou array)
      let materials: string[] = [];
      const rawMaterials = rawProduct.materiais || rawProduct.materials;
      
      if (Array.isArray(rawMaterials)) {
        materials = rawMaterials.map(m => m?.toString().trim()).filter(Boolean);
      } else if (typeof rawMaterials === 'string') {
        materials = rawMaterials.split(/,|;/).map(m => m.trim()).filter(m => m);
      }
      
      // Se não houver materiais especificados, tentar extrair da descrição
      if (materials.length === 0) {
        materials = extractMaterialsFromDescription(description);
      }
      
      // Processar URL da imagem
      const imageUrl = rawProduct.imagem || rawProduct.image || rawProduct.imageUrl || '';
      
      // Processar dimensões
      const width = rawProduct.largura || rawProduct.width;
      const height = rawProduct.altura || rawProduct.height;
      const depth = rawProduct.profundidade || rawProduct.depth;
      
      let sizes: any[] = [];
      if (width || height || depth) {
        sizes.push({
          width: typeof width === 'string' ? parseInt(width, 10) || null : width,
          height: typeof height === 'string' ? parseInt(height, 10) || null : height,
          depth: typeof depth === 'string' ? parseInt(depth, 10) || null : depth,
          label: `L${width || '-'} x A${height || '-'} x P${depth || '-'}`
        });
      }
      
      // Construir o objeto de produto normalizado
      normalizedProducts.push({
        name: productName || 'Produto sem nome',
        description,
        code: productCode || `AUTO-${Date.now().toString().slice(-8)}`,
        price,
        category,
        colors,
        materials,
        sizes,
        imageUrl,
        stock: rawProduct.estoque || rawProduct.stock || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Manter campos originais adicionais
        originalData: { ...rawProduct }
      });
    }
  }
  
  return normalizedProducts;
}

/**
 * Processar vários arquivos Excel e combinar os resultados
 * @param filePaths Caminhos para os arquivos Excel
 * @returns Array combinado de produtos processados
 */
export async function processMultipleExcelFiles(filePaths: string[]): Promise<any[]> {
  try {
    const allProducts: any[] = [];
    
    for (const filePath of filePaths) {
      try {
        const products = await processExcelFile(filePath);
        allProducts.push(...products);
      } catch (error) {
        console.error(`Erro ao processar arquivo ${filePath}:`, error);
        // Continua para o próximo arquivo mesmo se houver erro
      }
    }
    
    return allProducts;
  } catch (error) {
    console.error('Erro ao processar múltiplos arquivos Excel:', error);
    throw new Error('Falha ao processar arquivos Excel');
  }
}

export default {
  processExcelFile,
  processMultipleExcelFiles
};