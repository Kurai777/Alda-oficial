/**
 * Processador de Excel simplificado
 * 
 * Este módulo oferece uma versão simplificada do processador de Excel,
 * focada em extrair informações básicas de produtos e suas imagens.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Usar apenas extratores CommonJS para evitar problemas de compatibilidade
const robustExtractor = require('./robust-commonjs-extractor.js');

// Mapeamento de colunas para formatos conhecidos
const COLUMN_MAPPINGS = {
  // Formato POE com colunas específicas
  POE: {
    'B': 'code',       // Coluna B (código)
    'C': 'name',       // Coluna C (nome/descrição)
    'D': 'category',   // Coluna D (categoria)
    'E': 'supplier',   // Coluna E (fornecedor)
    'F': 'price'       // Coluna F (preço)
  },
  // Formato genérico baseado em nomes de colunas
  GENERIC: {
    'codigo': 'code',
    'código': 'code',
    'nome': 'name',
    'descrição': 'name',
    'descricao': 'name',
    'preço': 'price',
    'preco': 'price',
    'valor': 'price',
    'categoria': 'category',
    'fornecedor': 'supplier',
    'marca': 'brand'
  }
};

/**
 * Extrai produtos de um arquivo Excel
 * @param {string} filePath Caminho para o arquivo Excel
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos processados
 */
async function processExcelFile(filePath, userId, catalogId) {
  try {
    console.log(`Processador simplificado: processando ${filePath}`);
    
    // Ler arquivo Excel
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    
    // Processar primeira planilha
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Extraídos ${rawData.length} registros da planilha`);
    
    // Identificar se é formato POE (verificando se existem códigos "POE" na coluna B)
    const isPOEFormat = rawData.some(row => 
      row.B && typeof row.B === 'string' && row.B.toString().toUpperCase().includes('POE')
    );
    
    console.log(`Formato detectado: ${isPOEFormat ? 'POE' : 'Genérico'}`);
    
    // Selecionar mapeamento de colunas apropriado
    const columnMapping = isPOEFormat ? COLUMN_MAPPINGS.POE : COLUMN_MAPPINGS.GENERIC;
    
    // Extrair cabeçalhos (primeira linha) em formato genérico
    let headerRow = 0;
    let headerToFieldMap = {};
    
    if (!isPOEFormat) {
      // Buscar linha de cabeçalho (até as primeiras 10 linhas)
      for (let i = 0; i < Math.min(10, rawData.length); i++) {
        const row = rawData[i];
        const rowValues = Object.values(row).map(v => 
          v ? v.toString().toLowerCase() : ''
        );
        
        // Se encontrarmos palavras como "código", "nome", "preço" é provavelmente um cabeçalho
        if (
          rowValues.some(v => v.includes('codigo') || v.includes('código')) &&
          rowValues.some(v => v.includes('nome') || v.includes('descri'))
        ) {
          headerRow = i;
          
          // Criar mapeamento do cabeçalho para campos
          for (const [column, value] of Object.entries(row)) {
            if (!value) continue;
            
            const lowerValue = value.toString().toLowerCase();
            
            // Mapear para campo apropriado baseado no texto do cabeçalho
            for (const [headerText, fieldName] of Object.entries(COLUMN_MAPPINGS.GENERIC)) {
              if (lowerValue.includes(headerText)) {
                headerToFieldMap[column] = fieldName;
                break;
              }
            }
          }
          
          break;
        }
      }
    }
    
    console.log(`Linha de cabeçalho: ${headerRow}`);
    console.log(`Mapeamento de colunas: ${JSON.stringify(isPOEFormat ? columnMapping : headerToFieldMap)}`);
    
    // Processar os dados convertendo para formato padrão de produto
    const products = [];
    
    // Começar na linha após o cabeçalho (ou na primeira linha para formato POE)
    const startRow = isPOEFormat ? 0 : headerRow + 1;
    
    for (let i = startRow; i < rawData.length; i++) {
      const row = rawData[i];
      
      if (isPOEFormat) {
        // Extrair dados usando mapeamento POE direto
        const code = row.B ? row.B.toString().trim() : '';
        const name = row.C ? row.C.toString().trim() : '';
        
        // Pular linhas sem código ou nome
        if (!code || !name) continue;
        
        // Normalizar código POE
        let formattedCode = code;
        if (code.toUpperCase().startsWith('POE')) {
          formattedCode = 'POE-' + code.replace(/POE[\s-]*/i, '');
        }
        
        // Converter preço para formato numérico
        let price = 0;
        if (row.F) {
          const priceStr = row.F.toString().replace(/[^\d,.]/g, '').replace(',', '.');
          price = parseFloat(priceStr) || 0;
        }
        
        // Criar objeto do produto
        const product = {
          code: formattedCode,
          name: name,
          price: price,
          category: row.D ? row.D.toString().trim() : '',
          manufacturer: row.E ? row.E.toString().trim() : '',
          userId: userId,
          catalogId: parseInt(catalogId),
          excelRowNumber: i + 1,
          isEdited: false
        };
        
        products.push(product);
      } else {
        // Formato genérico usando o mapeamento de cabeçalhos
        const produto = {};
        let hasCode = false;
        let hasName = false;
        
        for (const [column, value] of Object.entries(row)) {
          if (!value) continue;
          
          // Obter o nome do campo mapeado
          const fieldName = headerToFieldMap[column];
          if (fieldName) {
            produto[fieldName] = value.toString().trim();
            
            if (fieldName === 'code') hasCode = true;
            if (fieldName === 'name') hasName = true;
            
            // Tratar preço especialmente
            if (fieldName === 'price' && typeof value === 'string') {
              const priceStr = value.replace(/[^\d,.]/g, '').replace(',', '.');
              produto[fieldName] = parseFloat(priceStr) || 0;
            }
          }
        }
        
        // Adicionar metadados
        if (hasCode && hasName) {
          produto['userId'] = userId;
          produto['catalogId'] = parseInt(catalogId);
          produto['excelRowNumber'] = i + 1;
          produto['isEdited'] = false;
          
          products.push(produto);
        }
      }
    }
    
    console.log(`Extraídos ${products.length} produtos`);
    
    // Extração de imagens
    if (products.length > 0) {
      try {
        // Criar diretório para imagens
        const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
        
        if (!fs.existsSync(extractedImagesDir)) {
          fs.mkdirSync(extractedImagesDir, { recursive: true });
        }
        
        // Extrair imagens
        console.log(`Extraindo imagens para ${extractedImagesDir}`);
        
        // Usar extrator CommonJS robusto
        const robustResult = await robustExtractor.extractImages(filePath, extractedImagesDir);
        console.log(`Extrator CommonJS: ${robustResult.success ? 'Sucesso' : 'Falha'}, ${robustResult.imageCount} imagens`);
        
        // Verificar quantas imagens foram extraídas
        const extractedFiles = fs.existsSync(extractedImagesDir) ? 
          fs.readdirSync(extractedImagesDir).filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file)) : [];
        
        console.log(`Total de ${extractedFiles.length} imagens extraídas`);
        
        // Associar imagens aos produtos
        if (extractedFiles.length > 0) {
          console.log('Associando imagens aos produtos...');
          const productsWithImages = await robustExtractor.associateImagesWithProducts(
            products, extractedImagesDir, userId, catalogId
          );
          
          const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
          console.log(`${productsWithImagesCount} produtos associados com imagens`);
          
          return productsWithImages;
        }
      } catch (imageError) {
        console.error('Erro ao processar imagens:', imageError);
      }
    }
    
    return products;
  } catch (error) {
    console.error('Erro ao processar Excel:', error);
    throw error;
  }
}

// Exportar para ser compatível com CommonJS
module.exports = { processExcelFile };