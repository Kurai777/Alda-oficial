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
 * Verifica se um valor parece ser um cabeçalho ou palavra-chave irrelevante.
 * @param {*} value O valor da célula.
 * @returns {boolean} True se parecer um cabeçalho/keyword.
 */
function looksLikeHeaderOrKeyword(value) {
  if (value === null || value === undefined) return false;
  const lowerVal = value.toString().toLowerCase().trim();
  if (lowerVal.length === 0) return false;
  
  const keywords = [
    'nome', 'produto', 'item', 'desc', 'descrição', 'descricao', 
    'cod', 'código', 'codigo', 'ref', 'referência', 'referencia',
    'preco', 'preço', 'valor', 'price', 'cost', 
    'qtd', 'quant', 'quantidade', 'estoque', 'stock',
    'cat', 'categoria', 'category', 'segmento',
    'forn', 'fornecedor', 'fabricante', 'marca', 'supplier', 'brand',
    'local', 'localização', 'location', 'piso', 'andar', 'depósito', 'deposito', 'outlet',
    'material', 'cor', 'cores', 'color', 'colour', 'acabamento',
    'dimens', 'dimensão', 'dimensões', 'dimensions', 'medida', 'tamanho', 'size',
    'imagem', 'foto', 'image', 'picture',
    'total', 'subtotal', 'obs', 'observação', 'observacoes', 'detalhes',
    'linha', 'row', 'coluna', 'column', 'planilha', 'sheet',
    'data', 'date', 'atualizado', 'criado', 'modificado',
    'sim', 'não', 'yes', 'no', 'true', 'false', // Evitar booleanos como nome/código
    'r$' // Evitar apenas o símbolo de moeda
  ];
  
  // Verifica se é exatamente uma keyword ou um padrão comum não-produto
  return keywords.includes(lowerVal) || 
         /^\d+k$/i.test(lowerVal) ||        // "50k"
         /^\d+\s*-\s*\d+k$/i.test(lowerVal) || // "20-40k"
         /^\d+º?\s*(piso|andar)/i.test(lowerVal) || // "2 piso", "1º andar"
         /^(depósito|outlet|showroom)$/i.test(lowerVal) || // "depósito"
         /^[-_=]{4,}$/.test(lowerVal); // Linha separadora "----"
}

/**
 * Verifica se uma linha deve ser ignorada (cabeçalhos, totais, vazias, etc).
 * @param {Object} row Linha do Excel 
 * @param {Object} columnMapping Mapeamento de colunas detectado (ex: {name: 'A', code: 'F'})
 * @returns {boolean} True se a linha deve ser ignorada
 */
function isIgnorableLine(row, columnMapping) {
  const nameCol = columnMapping.name;
  const codeCol = columnMapping.code;
  const priceCol = columnMapping.price;
  const descCol = columnMapping.description;

  const nameVal = nameCol && row[nameCol] ? row[nameCol].toString().trim() : '';
  const codeVal = codeCol && row[codeCol] ? row[codeCol].toString().trim() : '';
  const priceIsPresent = priceCol && row[priceCol] !== undefined && row[priceCol] !== null && row[priceCol] !== '';
  const descVal = descCol && row[descCol] ? row[descCol].toString().trim() : '';

  let reason = '';

  // 1. Linha quase vazia? (Verifica se tem pelo menos 2 campos com algum texto)
  const significantFields = Object.values(row).filter(v => v && v.toString().trim().length > 1).length;
  if (significantFields < 2) {
    reason = 'Poucos campos significativos';
    console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
        return true;
      }

  // 2. Colunas essenciais (Nome E Código) parecem cabeçalho/keyword?
  const nameLooksBad = !nameVal || nameVal.length < 2 || looksLikeHeaderOrKeyword(nameVal);
  // Código pode ser numérico, então a validação é mais branda, mas não pode ser keyword
  const codeLooksBad = !codeVal || codeVal.length < 1 || looksLikeHeaderOrKeyword(codeVal); 
  
  if (nameLooksBad && codeLooksBad) {
    reason = `Nome ('${nameVal}') e Código ('${codeVal}') inválidos ou ausentes`;
    console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
    return true;
  }
  
  // 3. Nome OU Código isoladamente parecem cabeçalho? (Se o outro estiver faltando)
  if (nameLooksBad && !codeVal) {
      reason = `Nome inválido ('${nameVal}') e Código ausente`;
      console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
      return true; 
    }
   if (codeLooksBad && !nameVal) {
      reason = `Código inválido ('${codeVal}') e Nome ausente`;
      console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
      return true;
  }
  
  // 4. Linha parece ser um total/subtotal? (Tem preço mas nome/código inválido)
  if (priceIsPresent && nameLooksBad && codeLooksBad) {
       reason = `Preço presente mas Nome ('${nameVal}') e Código ('${codeVal}') inválidos (provável total)`;
       console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
      return true;
    }

  // 5. Verificar se *todas* as colunas mapeadas contêm keywords (forte indício de cabeçalho)
  let mappedColsAreKeywords = true;
  let mappedColsCount = 0;
  for(const field in columnMapping) {
      const col = columnMapping[field];
      if(row[col]){
          mappedColsCount++;
          if(!looksLikeHeaderOrKeyword(row[col])) {
              mappedColsAreKeywords = false;
              break;
          }
      }
  }
  if (mappedColsCount > 1 && mappedColsAreKeywords) {
      reason = `Todas as colunas mapeadas (${Object.values(columnMapping).join(',')}) contêm keywords`;
       console.log(`Ignorando linha (${reason}):`, JSON.stringify(row));
       return true;
  }

  // Se passou por tudo, provavelmente é uma linha de produto válida
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
 * Processa um arquivo Excel com detecção automática de colunas
 */
export async function processExcelUniversal(filePath, userId, catalogId) {
  try {
    console.log(`\n=== INICIANDO PROCESSAMENTO UNIVERSAL (NOVA VERSÃO) ===`);
    console.log(`Arquivo: ${filePath}`);
    
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) throw new Error('Planilha vazia ou inválida');
    console.log(`Extraídos ${rawData.length} registros da planilha`);
    
    const columnMapping = detectColumnMapping(rawData);
    console.log("\nMapeamento de colunas detectado:", columnMapping);

    if (!columnMapping.name || !columnMapping.code) {
        console.error("ERRO CRÍTICO: Não foi possível detectar colunas essenciais de Nome e Código. Verifique a planilha e a função detectColumnMapping.");
        throw new Error("Mapeamento de colunas essenciais (Nome, Código) falhou.");
    }

    const products = [];
    let skippedProductLines = 0;
    
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;
      
      console.log(`\n--- Processando Linha Excel ${rowNum} ---`);
      // Log limitado para não poluir muito: console.log(`Dados Brutos: ${JSON.stringify(row)}`);

      // *** Passa o mapeamento para a função de ignorar ***
      if (isIgnorableLine(row, columnMapping)) {
        // A razão já foi logada dentro de isIgnorableLine
        skippedProductLines++;
        continue;
      }
      
      // Extrair dados usando o mapeamento detectado
      const nameColumn = columnMapping.name;
      const codeColumn = columnMapping.code;
      const priceColumn = columnMapping.price;
      const descColumn = columnMapping.description;

      // Extração com fallback para string vazia
      const potentialName = row[nameColumn] ? row[nameColumn].toString().trim() : '';
      const potentialCode = row[codeColumn] ? row[codeColumn].toString().trim() : '';
      let potentialPrice = 0;
      if (priceColumn && row[priceColumn]) {
          potentialPrice = extractPrice(row[priceColumn]); // extractPrice já trata erros
      }
      let potentialDescription = '';
      if (descColumn && row[descColumn]) {
          potentialDescription = row[descColumn].toString().trim();
      }
      // Usar nome como descrição apenas se a descrição estiver vazia
      if (!potentialDescription) {
          potentialDescription = potentialName; 
      }

      console.log(`Dados extraídos brutos: Nome='${potentialName}', Código='${potentialCode}', Preço=${potentialPrice}, Desc='${potentialDescription.substring(0,30)}...'`);

      // **Validação Final Rigorosa**
      // Nome: não pode ser keyword, deve ter min 2 chars
      if (!potentialName || potentialName.length < 2 || looksLikeHeaderOrKeyword(potentialName)) {
         console.log(`Linha ${rowNum} IGNORADA PÓS-EXTRAÇÃO: Nome inválido/keyword (\'${potentialName}\').`);
         skippedProductLines++;
         continue;
      }
      // Código: não pode ser keyword (mas pode ser curto/numérico)
      let generateCode = false;
      if (!potentialCode || potentialCode.length < 1 || looksLikeHeaderOrKeyword(potentialCode)) {
         console.log(`Linha ${rowNum}: Código inválido/keyword (\'${potentialCode}\'). Será gerado um código.`);
         generateCode = true;
      }
      // Preço: Ignorar se for zero E descrição for igual ao nome (sem info extra)
       if (potentialPrice === 0 && potentialDescription === potentialName) {
           console.log(`Linha ${rowNum} IGNORADA PÓS-EXTRAÇÃO: Preço zero e sem descrição adicional.`);
           skippedProductLines++;
           continue;
       }

      // Se chegou aqui, é um produto!
      console.log(`Linha ${rowNum} validada como PRODUTO.`);
      
      let productCode = potentialCode;
      if (generateCode) {
         // Gerar código único se necessário
         productCode = `AUTOGEN-${rowNum}-${Date.now().toString().slice(-5)}`; 
         console.log(`Código final gerado: \"${productCode}\"`);
      }
      
      const category = inferCategory(potentialName, potentialDescription);
      const materials = extractMaterials(potentialDescription || potentialName);
      
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        name: potentialName,
        code: productCode,
        description: potentialDescription,
        price: potentialPrice,
        category: category,
        materials: materials,
        colors: [],
        excelRowNumber: rowNum,
        isEdited: false,
        // Campos opcionais que podem vir de outras colunas (exemplo)
        manufacturer: columnMapping.manufacturer && row[columnMapping.manufacturer] ? row[columnMapping.manufacturer].toString().trim() : '',
        location: columnMapping.location && row[columnMapping.location] ? row[columnMapping.location].toString().trim() : '',
      };
      
      products.push(product);
      console.log(`✅ Produto Adicionado: ${product.name} (${product.code}) - R$ ${(product.price/100).toFixed(2)}`);
    }
    
    console.log(`\n=== PROCESSAMENTO EXCEL CONCLUÍDO ===`);
    console.log(`Total de produtos extraídos: ${products.length}`);
    console.log(`Total de linhas puladas (não produto): ${skippedProductLines}`);
    
    if (products.length === 0 && rawData.length > 0) {
        console.warn("ATENÇÃO: NENHUM produto válido foi extraído da planilha. Verifique o arquivo ou a lógica de detecção/validação.");
    }
    
    return products;
    
  } catch (error) {
    console.error('Erro CRÍTICO ao processar arquivo Excel:', error);
    // Lançar o erro para que a rota de upload possa tratá-lo
    throw new Error(`Falha no processamento do Excel: ${error.message}`);
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