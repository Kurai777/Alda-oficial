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
    
    // Ler o arquivo
    const fileData = await readFile(filePath);
    const workbook = XLSX.read(fileData);
    
    // Obter a primeira planilha
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rawData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Extraídos ${rawData.length} registros brutos do Excel`);
    
    // Mapear para o formato de produto padrão
    const products = normalizeExcelProducts(rawData as ExcelProduct[]);
    
    console.log(`Processados ${products.length} produtos do Excel`);
    
    return products;
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
  return rawProducts
    .filter(product => {
      // Filtrar linhas vazias ou inválidas
      // Um produto válido deve ter pelo menos nome e preço ou código
      const hasName = !!(product.nome || product.name);
      const hasPrice = !!(product.preco || product.price || product.valor);
      const hasCode = !!(product.codigo || product.code);
      
      return hasName && (hasPrice || hasCode);
    })
    .map(rawProduct => {
      // Normalizar o nome
      const name = rawProduct.nome || rawProduct.name || 'Produto sem nome';
      
      // Normalizar a descrição
      const description = rawProduct.descricao || rawProduct.description || '';
      
      // Normalizar o código
      const code = rawProduct.codigo || rawProduct.code || `AUTO-${Date.now().toString().slice(-8)}`;
      
      // Normalizar e converter o preço para centavos
      let price = 0;
      const rawPrice = rawProduct.preco || rawProduct.price || rawProduct.valor;
      
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
        category = determineProductCategory(name);
      }
      
      // Processar cores (pode ser string separada por vírgulas ou array)
      let colors: string[] = [];
      const rawColors = rawProduct.cores || rawProduct.colors;
      
      if (Array.isArray(rawColors)) {
        colors = rawColors.map(c => c.toString().trim());
      } else if (typeof rawColors === 'string') {
        colors = rawColors.split(/,|;/).map(c => c.trim()).filter(c => c);
      }
      
      // Processar materiais (pode ser string separada por vírgulas ou array)
      let materials: string[] = [];
      const rawMaterials = rawProduct.materiais || rawProduct.materials;
      
      if (Array.isArray(rawMaterials)) {
        materials = rawMaterials.map(m => m.toString().trim());
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
      return {
        name,
        description,
        code,
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
      };
    });
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