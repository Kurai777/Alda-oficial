/**
 * Processador especializado de Excel no formato POE
 * 
 * Este módulo é dedicado ao processamento de planilhas Excel no formato POE,
 * que utiliza cabeçalhos alfabéticos (A, B, C...) e tem códigos de produtos
 * começando com "POE".
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { extractExcelImages, associateImagesWithProducts } = require('./python-excel-bridge.js');
const { robust_extractImages } = require('./robust-excel-image-extractor.js');

// Mapeamento de colunas para o formato POE
const POE_COLUMNS = {
  CODIGO: 'B',    // Coluna B contém o código do produto
  NOME: 'C',      // Coluna C contém o nome/descrição do produto
  PRECO: 'F',     // Coluna F contém o preço
  CATEGORIA: 'D', // Coluna D geralmente contém categoria ou descrição adicional
  FORNECEDOR: 'E' // Coluna E pode conter informações do fornecedor
};

/**
 * Processa um arquivo Excel no formato POE
 * @param filePath Caminho para o arquivo Excel
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Lista de produtos extraídos
 */
export async function processPOEExcelFile(filePath: string, userId: any, catalogId: any): Promise<any[]> {
  try {
    console.log(`Processando Excel no formato POE: ${filePath}`);
    
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
    
    console.log(`Planilha POE contém ${data.length} linhas`);
    
    // Verificar se realmente é formato POE
    let isPOE = false;
    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i];
      if (row[POE_COLUMNS.CODIGO] && 
          typeof row[POE_COLUMNS.CODIGO] === 'string' && 
          row[POE_COLUMNS.CODIGO].toString().toUpperCase().includes('POE')) {
        isPOE = true;
        break;
      }
    }
    
    if (!isPOE) {
      console.warn('Arquivo não parece ser no formato POE');
      // Continuar mesmo assim, usando o mapeamento de colunas POE
    }
    
    // Encontrar a primeira linha com dados válidos (pulando cabeçalhos e linhas em branco)
    let startRow = 0;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row[POE_COLUMNS.CODIGO] && row[POE_COLUMNS.NOME]) {
        startRow = i;
        break;
      }
    }
    
    console.log(`Primeira linha de dados detectada: ${startRow}`);
    
    // Extrair produtos
    const products = [];
    
    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      
      // Verificar se a linha tem dados válidos
      if (!row[POE_COLUMNS.CODIGO] || !row[POE_COLUMNS.NOME]) {
        continue;
      }
      
      // Formatação especial para códigos POE
      let codigo = row[POE_COLUMNS.CODIGO].toString().trim();
      if (codigo.toUpperCase().startsWith('POE')) {
        // Garantir formatação consistente
        codigo = 'POE-' + codigo.replace(/POE[\s-]*/i, '');
      }
      
      // Construir objeto do produto
      const produto: any = {
        code: codigo,
        name: row[POE_COLUMNS.NOME].toString().trim(),
        price: row[POE_COLUMNS.PRECO] ? parseFloat(row[POE_COLUMNS.PRECO].toString().replace(/[^\d,.]/g, '').replace(',', '.')) : 0,
        category: row[POE_COLUMNS.CATEGORIA] ? row[POE_COLUMNS.CATEGORIA].toString().trim() : '',
        manufacturer: row[POE_COLUMNS.FORNECEDOR] ? row[POE_COLUMNS.FORNECEDOR].toString().trim() : '',
        userId,
        catalogId: parseInt(catalogId),
        excelRowNumber: i + 1,
        isEdited: false
      };
      
      // Converter campos para strings se necessário
      if (typeof produto.category !== 'string') produto.category = String(produto.category || '');
      if (typeof produto.manufacturer !== 'string') produto.manufacturer = String(produto.manufacturer || '');
      
      // Adicionar à lista
      products.push(produto);
    }
    
    console.log(`Extraídos ${products.length} produtos do arquivo POE`);
    
    // Extrair imagens e associá-las aos produtos
    // Criar diretório para imagens extraídas
    const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
    
    if (!fs.existsSync(extractedImagesDir)) {
      fs.mkdirSync(extractedImagesDir, { recursive: true });
    }
    
    // Extrair imagens do Excel
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
    console.error('Erro ao processar Excel POE:', error);
    throw error;
  }
}