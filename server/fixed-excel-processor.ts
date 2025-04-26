/**
 * Processador de Excel com colunas fixas
 * 
 * Este módulo processa arquivos Excel assumindo um formato fixo de colunas,
 * mais adequado para arquivos de catálogo com estrutura conhecida.
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { extractExcelImages, associateImagesWithProducts } from './python-excel-bridge.js';
import { robust_extractImages } from './robust-excel-image-extractor.js';

/**
 * Processa um arquivo Excel com formato de colunas fixas
 * @param filePath Caminho para o arquivo Excel
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Lista de produtos extraídos
 */
export async function processExcelWithFixedColumns(filePath: string, userId: any, catalogId: any): Promise<any[]> {
  try {
    console.log(`Processando Excel com formato de colunas fixas: ${filePath}`);
    
    // Carregar o workbook
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    
    // Obter a primeira planilha
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON com cabeçalhos alfabéticos (A, B, C...)
    const data = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!data || data.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Planilha contém ${data.length} linhas`);
    
    // Detectar linha de cabeçalho
    let headerRow = 0;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      
      // Verificar se esta linha parece um cabeçalho
      if (Object.values(row).some(val => {
        const str = val ? val.toString().toLowerCase() : '';
        return str.includes('codigo') || str.includes('código') || str.includes('nome') || 
               str.includes('preço') || str.includes('preco');
      })) {
        headerRow = i;
        break;
      }
    }
    
    console.log(`Linha de cabeçalho detectada: ${headerRow}`);
    
    // Mapear colunas
    const headerMapping: {[key: string]: string} = {};
    if (headerRow >= 0) {
      const headerRowData = data[headerRow];
      
      for (const [col, val] of Object.entries(headerRowData)) {
        if (!val) continue;
        
        const valLower = val.toString().toLowerCase();
        
        if (valLower.includes('codigo') || valLower.includes('código') || valLower.includes('cod')) {
          headerMapping['codigo'] = col;
        } else if (valLower.includes('nome') || valLower.includes('descrição') || valLower.includes('descricao') || valLower.includes('desc')) {
          headerMapping['nome'] = col;
        } else if (valLower.includes('preço') || valLower.includes('preco') || valLower.includes('valor')) {
          headerMapping['preco'] = col;
        } else if (valLower.includes('categoria') || valLower.includes('categ')) {
          headerMapping['categoria'] = col;
        } else if (valLower.includes('estoque') || valLower.includes('qtd') || valLower.includes('quant')) {
          headerMapping['quantidade'] = col;
        } else if (valLower.includes('local') || valLower.includes('loc')) {
          headerMapping['local'] = col;
        } else if (valLower.includes('fornecedor') || valLower.includes('marca') || 
                  valLower.includes('fabric') || valLower.includes('manufac')) {
          headerMapping['fornecedor'] = col;
        }
      }
    }
    
    console.log('Mapeamento de colunas detectado:', headerMapping);
    
    if (!headerMapping.codigo || !headerMapping.nome) {
      console.warn('Não foi possível detectar colunas essenciais (código, nome). Usando colunas padrão.');
      headerMapping.codigo = headerMapping.codigo || 'A';
      headerMapping.nome = headerMapping.nome || 'B';
      headerMapping.preco = headerMapping.preco || 'C';
    }
    
    // Extrair produtos
    const products = [];
    
    // Começar da linha após o cabeçalho
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      
      // Obter dados das colunas mapeadas
      const codigo = row[headerMapping.codigo];
      const nome = row[headerMapping.nome];
      
      // Pular linhas sem código ou nome
      if (!codigo || !nome) continue;
      
      // Construir objeto de produto
      const produto: any = {
        codigo: codigo.toString().trim(),
        nome: nome.toString().trim(),
        preco: row[headerMapping.preco] ? row[headerMapping.preco].toString() : '0',
        categoria: row[headerMapping.categoria] ? row[headerMapping.categoria].toString() : '',
        quantidade: row[headerMapping.quantidade] ? row[headerMapping.quantidade].toString() : '0',
        fornecedor: row[headerMapping.fornecedor] ? row[headerMapping.fornecedor].toString() : '',
        local: row[headerMapping.local] ? row[headerMapping.local].toString() : '',
        excelRowNumber: i + 1 // +1 porque as linhas Excel começam em 1, não 0
      };
      
      // Assegurar que preço seja uma string (para parseFloat posterior)
      if (typeof produto.preco !== 'string') {
        produto.preco = produto.preco.toString();
      }
      
      // Limpar o preço para formato numérico
      produto.preco = produto.preco
        .replace('R$', '')
        .replace(/\s+/g, '')
        .replace('.', '')
        .replace(',', '.');
      
      // Adicionar produto à lista
      products.push(produto);
    }
    
    console.log(`Extraídos ${products.length} produtos do arquivo Excel`);
    
    // Extrair imagens e associá-las aos produtos
    // Criar diretório para imagens extraídas
    const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
    
    if (!fs.existsSync(extractedImagesDir)) {
      fs.mkdirSync(extractedImagesDir, { recursive: true });
    }
    
    // Extrair imagens do Excel com métodos robustos
    console.log(`Extraindo imagens de ${filePath} para ${extractedImagesDir}`);
    try {
      // Primeiro, tentar com o extrator robusto
      const robustResult = await robust_extractImages(filePath, extractedImagesDir);
      console.log(`Extrator robusto: ${robustResult.success ? 'Sucesso' : 'Falha'}, ${robustResult.imageCount} imagens`);
      
      // Se falhar ou não encontrar imagens, tentar com Python
      if (!robustResult.success || robustResult.imageCount === 0) {
        console.log('Tentando extrair imagens com Python...');
        const pythonResult = await extractExcelImages(filePath, extractedImagesDir);
        console.log(`Extrator Python: ${pythonResult.success ? 'Sucesso' : 'Falha'}, ${pythonResult.imageCount} imagens`);
      }
      
      // Verificar quantas imagens foram extraídas
      const extractedFiles = fs.existsSync(extractedImagesDir) ? 
        fs.readdirSync(extractedImagesDir).filter(file => 
          /\.(png|jpg|jpeg|gif)$/i.test(file)
        ) : [];
      
      console.log(`Total de ${extractedFiles.length} imagens extraídas`);
      
      // Associar imagens aos produtos
      if (extractedFiles.length > 0) {
        console.log('Associando imagens aos produtos...');
        const productsWithImages = await associateImagesWithProducts(
          products, extractedImagesDir, userId, catalogId
        );
        
        // Contar produtos com imagens
        const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
        console.log(`${productsWithImagesCount} produtos foram associados com imagens`);
        
        return productsWithImages;
      }
    } catch (imageError) {
      console.error('Erro ao extrair ou associar imagens:', imageError);
      // Continuar mesmo se houver erro nas imagens
    }
    
    return products;
  } catch (error) {
    console.error('Erro ao processar Excel com colunas fixas:', error);
    throw error;
  }
}