/**
 * Processador Universal de Catálogos - NOVA VERSÃO
 * 
 * Este processador utiliza um mapeamento explícito de colunas para todos os tipos de catálogos:
 * - Nome do Produto => Coluna G (Descrição)
 * - Código do Produto => Coluna H (Código do Produto)
 * - Preço => Coluna M (Valor Total)
 * - Categoria => Inferida do fornecedor (coluna C) ou nome do produto (coluna G)
 * - Localização => Coluna B (Local)
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

/**
 * Extrai valor de preço de uma string monetária (suporta formato BR e internacional)
 * @param {string} priceStr String contendo o preço (ex: "R$ 1.234,56")
 * @returns {number} Valor em centavos (ex: 123456)
 */
function extractPrice(priceStr) {
  if (!priceStr) return 0;
  
  try {
    // Converter para string se não for
    const priceString = priceStr.toString().trim();
    
    // Log para diagnóstico
    console.log(`Extraindo preço (bruto): "${priceString}"`);
    
    // Se a string contém apenas 0, 0.00, ou algo similar, retornar 0 imediatamente
    if (/^0([.,]0{1,2})?$/.test(priceString) || 
        priceString === "" || 
        priceString === "-" ||
        priceString.toLowerCase() === "r$0,00" ||
        priceString.toLowerCase() === "r$0.00") {
      return 0;
    }
    
    // Remover símbolos de moeda (R$, $, etc.) e espaços
    let sanitized = priceString.replace(/R\$|\$|\€|\£/g, "").trim();
    
    // Remover caracteres não numéricos (exceto ponto e vírgula)
    sanitized = sanitized.replace(/\s/g, "").replace(/[^\d.,]/g, "");
    
    // Detectar o formato brasileiro (1.234,56) vs internacional (1,234.56)
    const isBrazilianFormat = sanitized.includes(',') && 
                            (sanitized.indexOf(',') > sanitized.indexOf('.') || !sanitized.includes('.'));
    
    if (isBrazilianFormat) {
      // Formato brasileiro: remover pontos de milhar, substituir vírgula por ponto
      sanitized = sanitized.replace(/\./g, "");
      sanitized = sanitized.replace(',', '.');
    } else if (sanitized.includes(',') && !sanitized.includes('.')) {
      // Caso especial: número apenas com vírgula (ex: "1,5")
      sanitized = sanitized.replace(',', '.');
    }
    
    // Tentar converter para número
    const value = parseFloat(sanitized);
    
    if (isNaN(value)) {
      console.log(`Erro ao extrair valor numérico de "${priceString}"`);
      return 0;
    }
    
    // Se o valor é zero, retornar zero diretamente
    if (value === 0) {
      return 0;
    }
    
    // Converter para centavos (multiplicar por 100)
    const cents = Math.round(value * 100);
    console.log(`Valor extraído: ${value} -> ${cents} centavos`);
    
    return cents;
  } catch (error) {
    console.error(`Erro ao processar preço "${priceStr}":`, error);
    return 0;
  }
}

/**
 * Verifica se uma linha deve ser ignorada (cabeçalhos, faixas de preço, etc)
 * @param {Object} row Linha do Excel 
 * @returns {boolean} True se a linha deve ser ignorada
 */
function isIgnorableLine(row) {
  // Verificar se é uma linha de cabeçalho
  const headerKeywords = ['descrição', 'código', 'qtd', 'valor', 'local', 'fornecedor'];
  
  // Verificar por textos comuns de cabeçalho em qualquer coluna
  for (const key in row) {
    if (row[key]) {
      const cellValue = row[key].toString().toLowerCase().trim();
      if (headerKeywords.some(keyword => cellValue === keyword || cellValue.includes(keyword))) {
        console.log(`Ignorando linha de cabeçalho: "${cellValue}"`);
        return true;
      }
    }
  }
  
  // Verificar se é uma linha de faixa de preço ou localização
  if (row.B) {
    const valueB = row.B.toString().toLowerCase().trim();
    if (/^\d+k$/i.test(valueB) || 
        /^\d+\s*-\s*\d+k$/i.test(valueB) ||
        valueB.includes('piso') || 
        valueB.includes('andar')) {
      console.log(`Ignorando linha de faixa de preço/localização: "${valueB}"`);
      return true; 
    }
  }
  
  // Verificar também na coluna H (código) se é uma localização
  if (row.H) {
    const valueH = row.H.toString().toLowerCase().trim();
    if (valueH.includes('piso') || 
        valueH.includes('andar') ||
        /^\d+º/i.test(valueH)) {
      console.log(`Ignorando linha com código inválido: "${valueH}"`);
      return true;
    }
  }
  
  return false;
}

/**
 * Infere categoria com base no nome do produto e fornecedor
 * @param {string} productName Nome do produto
 * @param {string} manufacturer Fornecedor/fabricante
 * @returns {string} Categoria inferida
 */
function inferCategory(productName, manufacturer) {
  // Normalizar para busca
  const nameLower = productName ? productName.toLowerCase() : '';
  const mfrLower = manufacturer ? manufacturer.toLowerCase() : '';
  
  // Tentar inferir do nome do produto primeiro
  if (nameLower.includes('sofá') || nameLower.includes('sofa') || nameLower.includes('poltrona')) {
    return 'Sofás';
  } else if (nameLower.includes('mesa')) {
    return 'Mesas';
  } else if (nameLower.includes('cadeira')) {
    return 'Cadeiras';
  } else if (nameLower.includes('estante') || nameLower.includes('prateleira')) {
    return 'Estantes';
  } else if (nameLower.includes('cama') || nameLower.includes('colchão')) {
    return 'Camas';
  } else if (nameLower.includes('luminária') || nameLower.includes('lustre') || nameLower.includes('pendente')) {
    return 'Iluminação';
  } else if (nameLower.includes('tapete') || nameLower.includes('carpete')) {
    return 'Tapetes';
  } else if (nameLower.includes('armário') || nameLower.includes('guarda-roupa')) {
    return 'Armários';
  }
  
  // Depois tentar inferir do fabricante
  if (mfrLower) {
    if (mfrLower === 'boheme' || mfrLower === 'oxy' || mfrLower === 'dalio' || mfrLower.includes('estof')) {
      return 'Sofás';
    } else if (mfrLower.includes('lumin') || mfrLower.includes('light')) {
      return 'Iluminação';
    } else if (mfrLower.includes('chair') || mfrLower.includes('cadeira')) {
      return 'Cadeiras';
    } else if (mfrLower.includes('mesa') || mfrLower.includes('table')) {
      return 'Mesas';
    }
  }
  
  // Categoria padrão
  return 'Móveis';
}

/**
 * Extrai materiais do nome do produto
 * @param {string} productName Nome do produto
 * @returns {Array} Lista de materiais detectados
 */
function extractMaterials(productName) {
  const materials = [];
  if (!productName) return materials;
  
  const nameLower = productName.toLowerCase();
  const materialKeywords = {
    'madeira': 'Madeira',
    'metal': 'Metal',
    'tecido': 'Tecido',
    'couro': 'Couro',
    'vidro': 'Vidro',
    'mármore': 'Mármore',
    'veludo': 'Veludo',
    'inox': 'Aço Inox',
    'fórmica': 'Fórmica',
    'linho': 'Linho',
    'alumínio': 'Alumínio'
  };
  
  for (const [keyword, material] of Object.entries(materialKeywords)) {
    if (nameLower.includes(keyword)) {
      materials.push(material);
    }
  }
  
  return materials;
}

/**
 * Detecta automaticamente o mapeamento de colunas baseado no conteúdo
 * @param {Array} rawData Dados brutos do Excel
 * @returns {Object} Mapeamento de colunas detectado
 */
function detectColumnMapping(rawData) {
  console.log("\n=== DETECTANDO MAPEAMENTO DE COLUNAS ===");
  
  // Estrutura para armazenar pontuação de cada coluna
  const columnScores = {};
  
  // Padrões para identificar tipos de conteúdo
  const patterns = {
    name: {
      keywords: ['nome', 'descrição', 'produto', 'item'],
      patterns: [
        // Padrões comuns de nomes de produtos
        /sofá|sofa|poltrona|cadeira|mesa|estante|cama/i,
        // Nomes com medidas
        /\d+(\.\d+)?(cm|m)\s*(x|×)\s*\d+(\.\d+)?(cm|m)/i
      ]
    },
    code: {
      keywords: ['código', 'cod', 'referência', 'ref'],
      patterns: [
        // Códigos alfanuméricos
        /^[A-Z0-9]{4,10}$/i,
        // Códigos com traço
        /^[A-Z0-9]+-[A-Z0-9]+$/i,
        // Códigos POE
        /^POE-?\d+$/i
      ]
    },
    price: {
      keywords: ['preço', 'valor', 'total', 'r$'],
      patterns: [
        // Valores monetários
        /R?\$?\s*\d+[\.,]\d{2}/i,
        // Números com 2 casas decimais
        /^\d+[\.,]\d{2}$/
      ]
    },
    description: {
      keywords: ['descrição', 'desc', 'detalhes', 'especificação'],
      patterns: [
        // Textos longos com medidas
        /\d+(\.\d+)?(cm|m)\s*(x|×)\s*\d+(\.\d+)?(cm|m)/i,
        // Descrições com materiais
        /(madeira|tecido|couro|metal|vidro|mármore)/i
      ]
    }
  };

  // Analisar as primeiras linhas para identificar cabeçalhos
  const headerRow = {};
  for (let i = 0; i < Math.min(5, rawData.length); i++) {
    const row = rawData[i];
    for (const [col, value] of Object.entries(row)) {
      if (!value) continue;
      const valueStr = value.toString().toLowerCase().trim();
      
      // Verificar se parece um cabeçalho
      for (const [field, fieldPatterns] of Object.entries(patterns)) {
        if (fieldPatterns.keywords.some(keyword => valueStr.includes(keyword))) {
          headerRow[col] = field;
          console.log(`Cabeçalho detectado: Coluna ${col} = ${field} ("${valueStr}")`);
        }
      }
    }
  }

  // Analisar o conteúdo das colunas
  const startRow = Math.min(5, rawData.length); // Pular possíveis cabeçalhos
  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    for (const [col, value] of Object.entries(row)) {
      if (!value) continue;
      const valueStr = value.toString().trim();
      
      if (!columnScores[col]) {
        columnScores[col] = {
          name: 0,
          code: 0,
          price: 0,
          description: 0
        };
      }

      // Pontuar cada coluna baseado no conteúdo
      for (const [field, fieldPatterns] of Object.entries(patterns)) {
        // Verificar padrões
        fieldPatterns.patterns.forEach(pattern => {
          if (pattern.test(valueStr)) {
            columnScores[col][field] += 2;
          }
        });
        
        // Análise adicional baseada no tipo de campo
        switch (field) {
          case 'name':
            // Nomes geralmente têm palavras com inicial maiúscula
            if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+/.test(valueStr)) {
              columnScores[col].name += 1;
            }
            break;
            
          case 'code':
            // Códigos geralmente são mais curtos e consistentes
            if (valueStr.length <= 15 && !/\s/.test(valueStr)) {
              columnScores[col].code += 1;
            }
            break;
            
          case 'price':
            // Preços são números
            if (/^\d+([.,]\d{2})?$/.test(valueStr.replace(/[R$\s]/g, ''))) {
              columnScores[col].price += 3;
            }
            break;
            
          case 'description':
            // Descrições são geralmente mais longas
            if (valueStr.length > 30) {
              columnScores[col].description += 1;
            }
            break;
        }
      }
    }
  }

  // Determinar a melhor coluna para cada campo
  const mapping = {};
  const usedColumns = new Set();

  // Primeiro, usar cabeçalhos detectados
  for (const [col, field] of Object.entries(headerRow)) {
    mapping[field] = col;
    usedColumns.add(col);
  }

  // Depois, usar pontuações para colunas restantes
  ['name', 'code', 'price', 'description'].forEach(field => {
    if (mapping[field]) return; // Já definido por cabeçalho
    
    let bestScore = -1;
    let bestColumn = null;
    
    for (const [col, scores] of Object.entries(columnScores)) {
      if (usedColumns.has(col)) continue;
      if (scores[field] > bestScore) {
        bestScore = scores[field];
        bestColumn = col;
      }
    }
    
    if (bestColumn && bestScore > 0) {
      mapping[field] = bestColumn;
      usedColumns.add(bestColumn);
      console.log(`Coluna detectada para ${field}: ${bestColumn} (pontuação: ${bestScore})`);
    }
  });

  return mapping;
}

/**
 * Processa um arquivo Excel com colunas fixas para extração universal
 * @param {string} filePath Caminho do arquivo Excel
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos processados
 */
export async function processExcelUniversal(filePath, userId, catalogId) {
  try {
    console.log(`\n=== INICIANDO PROCESSAMENTO UNIVERSAL (NOVA VERSÃO) ===`);
    console.log(`Arquivo: ${filePath}`);
    
    // Ler arquivo Excel
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Extraídos ${rawData.length} registros da planilha`);
    
    // Detectar mapeamento de colunas
    const columnMapping = detectColumnMapping(rawData);
    console.log("\nMapeamento de colunas detectado:", columnMapping);
    
    // Lista para armazenar produtos processados
    const products = [];
    
    // Processar cada linha
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;
      
      // Verificar se a linha é válida
      if (isIgnorableLine(row)) {
        continue;
      }
      
      // ETAPA 1: NOME DO PRODUTO
      const nameColumn = columnMapping.name;
      if (!nameColumn || !row[nameColumn]) {
        console.log(`Linha ${rowNum} sem nome de produto. IGNORANDO`);
        continue;
      }
      
      const productName = row[nameColumn].toString().trim();
      if (productName.length < 3) {
        console.log(`Linha ${rowNum} com nome muito curto: "${productName}". IGNORANDO`);
        continue;
      }
      
      console.log(`Nome do produto: "${productName}"`);
      
      // ETAPA 2: CÓDIGO DO PRODUTO
      let productCode = "";
      const codeColumn = columnMapping.code;
      if (codeColumn && row[codeColumn]) {
        productCode = row[codeColumn].toString().trim();
        console.log(`Código do produto: "${productCode}"`);
      } else {
        productCode = `PROD-${rowNum}-${Date.now()}`;
        console.log(`Código gerado: "${productCode}"`);
      }
      
      // ETAPA 3: PREÇO DO PRODUTO
      let productPrice = 0;
      const priceColumn = columnMapping.price;
      if (priceColumn && row[priceColumn]) {
        productPrice = extractPrice(row[priceColumn]);
        console.log(`Preço do produto: ${productPrice} centavos`);
      }
      
      // ETAPA 4: DESCRIÇÃO
      let description = '';
      const descColumn = columnMapping.description;
      if (descColumn && row[descColumn]) {
        description = row[descColumn].toString().trim();
        console.log(`Descrição: "${description}"`);
      } else {
        description = productName;
      }
      
      // ETAPA 5: INFERIR CATEGORIA
      const category = inferCategory(productName, description);
      console.log(`Categoria inferida: "${category}"`);
      
      // ETAPA 6: EXTRAIR MATERIAIS
      const materials = extractMaterials(description || productName);
      if (materials.length > 0) {
        console.log(`Materiais detectados: ${materials.join(', ')}`);
      }
      
      // CRIAR OBJETO DO PRODUTO
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        name: productName,
        code: productCode,
        description: description,
        price: productPrice,
        category: category,
        materials: materials,
        colors: [],
        excelRowNumber: rowNum,
        isEdited: false
      };
      
      // Adicionar produto à lista
      products.push(product);
      console.log(`✅ Produto extraído com sucesso da linha ${rowNum}: ${product.name} (${product.code}) - R$ ${(product.price/100).toFixed(2)}\n`);
    }
    
    console.log(`\n=== PROCESSAMENTO CONCLUÍDO ===`);
    console.log(`Total de produtos extraídos: ${products.length}`);
    
    return products;
    
  } catch (error) {
    console.error('Erro ao processar arquivo Excel:', error);
    throw error;
  }
}

/**
 * Extrai e associa imagens a produtos de catálogo
 * @param {Array} products Lista de produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {string} imagesDir Diretório de imagens extraídas
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos com imagens associadas
 */
export async function associateProductsWithImages(products, excelPath, imagesDir, userId, catalogId) {
  console.log(`\n=== ASSOCIANDO IMAGENS A ${products.length} PRODUTOS ===`);
  
  try {
    // Verificar o diretório de imagens
    if (!fs.existsSync(imagesDir)) {
      console.log(`Diretório de imagens não encontrado: ${imagesDir}`);
      return products;
    }
    
    // Listar todas as imagens extraídas
    const imageFiles = fs.readdirSync(imagesDir);
    console.log(`Encontradas ${imageFiles.length} imagens extraídas em ${imagesDir}`);
    
    if (imageFiles.length === 0) {
      console.log("Nenhuma imagem encontrada para associar");
      return products;
    }
    
    // Pasta para salvar as imagens processadas
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Criar mapeamento de linha do Excel para produto
    const rowToProductMap = {};
    products.forEach(product => {
      if (product.excelRowNumber) {
        rowToProductMap[product.excelRowNumber] = product;
      }
    });
    
    // Associar imagens aos produtos
    const timestamp = Date.now();
    let imagesAssociated = 0;
    
    // Primeira tentativa: associar por número de linha
    for (const imageFile of imageFiles) {
      // Extrair número da imagem do nome do arquivo
      const match = imageFile.match(/image[-_]?(\d+)\.(?:png|jpe?g|gif|webp)/i);
      if (!match) continue;
      
      const imageNumber = parseInt(match[1]);
      if (isNaN(imageNumber)) continue;
      
      // Procurar por produto com número de linha similar
      for (const product of products) {
        // Verificar se o número de linha está próximo do número da imagem
        // Usamos uma tolerância para acomodar diferenças na numeração
        if (Math.abs(product.excelRowNumber - imageNumber) <= 5) {
          // Copiar a imagem para o diretório de destino
          const newImageName = `${timestamp}-${imageFile}`;
          const targetPath = path.join(targetDir, newImageName);
          
          fs.copyFileSync(path.join(imagesDir, imageFile), targetPath);
          
          // Atualizar URL da imagem no produto
          product.imageUrl = `/api/images/${userId}/${catalogId}/${newImageName}`;
          
          console.log(`✅ Imagem ${imageFile} associada ao produto "${product.name}" (${product.code})`);
          imagesAssociated++;
          break;
        }
      }
    }
    
    // Segunda tentativa: distribuir imagens restantes de forma sequencial
    if (imagesAssociated < imageFiles.length && imagesAssociated < products.length) {
      console.log("Distribuindo imagens restantes sequencialmente...");
      
      const productsWithoutImages = products.filter(p => !p.imageUrl);
      const unusedImages = imageFiles.filter(img => {
        const match = img.match(/image[-_]?(\d+)\.(?:png|jpe?g|gif|webp)/i);
        if (!match) return false;
        
        const imageNumber = parseInt(match[1]);
        if (isNaN(imageNumber)) return false;
        
        // Verificar se esta imagem já foi associada
        return !products.some(p => p.imageUrl && p.imageUrl.includes(img));
      });
      
      // Associar imagens na ordem
      const limit = Math.min(productsWithoutImages.length, unusedImages.length);
      for (let i = 0; i < limit; i++) {
        const product = productsWithoutImages[i];
        const imageFile = unusedImages[i];
        
        // Copiar a imagem para o diretório de destino
        const newImageName = `${timestamp}-${imageFile}`;
        const targetPath = path.join(targetDir, newImageName);
        
        fs.copyFileSync(path.join(imagesDir, imageFile), targetPath);
        
        // Atualizar URL da imagem no produto
        product.imageUrl = `/api/images/${userId}/${catalogId}/${newImageName}`;
        
        console.log(`✅ Imagem ${imageFile} associada sequencialmente ao produto "${product.name}" (${product.code})`);
        imagesAssociated++;
      }
    }
    
    console.log(`=== ASSOCIAÇÃO DE IMAGENS CONCLUÍDA ===`);
    console.log(`Total: ${imagesAssociated} imagens associadas de ${imageFiles.length} disponíveis`);
    
    return products;
  } catch (error) {
    console.error("Erro ao associar imagens a produtos:", error);
    // Retorna os produtos sem imagens em caso de erro
    return products;
  }
}