/**
 * Processador Universal de Catálogos
 * 
 * Este processador é projetado para funcionar com qualquer formato de arquivo Excel,
 * usando detecção automática de colunas para identificar:
 * - Nome do produto
 * - Código
 * - Preço
 * - Categoria/Materiais/Informações adicionais
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

/**
 * Extrai preço de qualquer formato (brasileiro ou internacional)
 * @param {any} priceStr String ou valor contendo o preço
 * @returns {number} Valor em centavos
 */
function extractUniversalPrice(priceStr) {
  if (!priceStr) return 0;
  
  try {
    // Converter para string se não for
    const priceString = priceStr.toString().trim();
    
    // Log para diagnóstico
    console.log(`Extraindo preço (bruto): "${priceString}"`);
    
    // Se já é um número, converter diretamente para centavos
    if (typeof priceStr === 'number') {
      return Math.round(priceStr * 100);
    }
    
    // Se a string contém apenas 0, 0.00, ou algo similar, retornar 0 imediatamente
    if (/^0([.,]0{1,2})?$/.test(priceString) || 
        priceString === "" || 
        priceString === "-" ||
        priceString.toLowerCase() === "r$0,00" ||
        priceString.toLowerCase() === "r$0.00") {
      console.log("Preço zero detectado diretamente, retornando 0");
      return 0;
    }
    
    // Remover símbolos de moeda (R$, $, etc.) e espaços
    let sanitized = priceString.replace(/R\$|\$|\€|\£|\s/g, "").trim();
    
    // Remover caracteres não numéricos (exceto ponto e vírgula)
    sanitized = sanitized.replace(/[^\d.,]/g, "");
    
    console.log(`Após limpeza: "${sanitized}"`);
    
    // Detectar formato brasileiro (1.234,56) vs internacional (1,234.56)
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
      console.log(`Não foi possível extrair valor numérico de "${priceString}"`);
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
 * Avalia o conteúdo de uma coluna para detectar que tipo de informação contém
 * @param {Array} columnValues Valores da coluna
 * @returns {string} Tipo de dados detectado
 */
function detectColumnType(columnValues) {
  // Filtra strings vazias e null
  const values = columnValues.filter(val => val !== null && val !== undefined && val.toString().trim() !== '');
  if (values.length === 0) return 'empty';
  
  // Contar tipos de valores
  let priceCount = 0;
  let codeCount = 0;
  let nameCount = 0;
  let dateCount = 0;
  
  for (const val of values) {
    const strVal = val.toString().trim();
    
    // Detecção de preço - contém R$ ou formato numérico com vírgula/ponto
    if (strVal.includes('R$') || /^\d+([.,]\d{1,2})?$/.test(strVal)) {
      priceCount++;
    }
    
    // Detecção de código - sequência alfanumérica curta, frequentemente com hífen
    if (/^[A-Z0-9-]{2,10}$/i.test(strVal) || strVal.includes('-')) {
      codeCount++;
    }
    
    // Detecção de data - formato dd/mm/yyyy ou contém mês abreviado
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(strVal) || 
        /jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez/i.test(strVal)) {
      dateCount++;
    }
    
    // Detecção de nome - textos mais longos
    if (strVal.length > 15 && strVal.includes(' ')) {
      nameCount++;
    }
  }
  
  // Determinar o tipo de coluna baseado na contagem
  if (priceCount > values.length * 0.3) return 'price';
  if (codeCount > values.length * 0.4) return 'code';
  if (dateCount > values.length * 0.3) return 'date';
  if (nameCount > values.length * 0.3) return 'name';
  
  // Verificação adicional
  // Se as strings são curtas e não têm espaço, provavelmente é código
  const shortStrings = values.filter(v => v.toString().length < 15 && !v.toString().includes(' '));
  if (shortStrings.length > values.length * 0.7) return 'code';
  
  // Se as strings são longas, provavelmente é descrição/nome
  const longStrings = values.filter(v => v.toString().length > 15);
  if (longStrings.length > values.length * 0.5) return 'name';
  
  return 'unknown';
}

/**
 * Detecta automaticamente o layout de colunas em um arquivo Excel
 * @param {Array} rows Primeiras linhas do arquivo
 * @returns {Object} Mapeamento de colunas
 */
function autoDetectColumns(rows) {
  // MAPEAMENTO FORÇADO DE COLUNAS CORRETAS PARA GARANTIR CONFIABILIDADE
  console.log('Usando mapeamento explícito para garantir extração de dados correta');
  
  // O mapeamento correto para planilhas comuns é:
  // - Nome do Produto: Coluna G (Descrição)
  // - Código do Produto: Coluna H 
  // - Preço: Coluna M (Valor Total)
  // - Localização/Categoria: Colunas B ou C
  const forcedColumnMap = {
    'G': 'name',      // Descrição do produto SEMPRE vem da coluna G
    'H': 'code',      // Código do produto SEMPRE vem da coluna H
    'M': 'price',     // Preço SEMPRE vem da coluna M (Valor Total)
    'B': 'location',  // Localização geralmente vem da coluna B
    'C': 'supplier'   // Fornecedor geralmente vem da coluna C
  };
  
  // Verificar se as colunas existem na planilha
  const columnMap = {};
  
  console.log(`Analisando ${rows.length} linhas para verificar quais colunas existem`);
  
  // Verificar existência de cada coluna forçada
  for (const [col, type] of Object.entries(forcedColumnMap)) {
    // Verificar se a coluna tem valores
    const hasValues = rows.some(row => row[col] && row[col].toString().trim() !== '');
    
    if (hasValues) {
      columnMap[col] = type;
      console.log(`Coluna ${col} definida como "${type}" (mapeamento explícito)`);
    } else {
      console.log(`Coluna ${col} não encontrada na planilha`);
    }
  }
  
  // Verificar se temos as colunas essenciais
  const hasName = 'G' in columnMap;
  const hasCode = 'H' in columnMap;
  const hasPrice = 'M' in columnMap;
  
  // Fallbacks para casos onde as colunas padrão não existem
  if (!hasName) {
    // Tentar encontrar uma coluna com descrições longas (mínimo 15 caracteres)
    for (const col of ['F', 'I', 'J', 'K']) {
      if (!Object.keys(columnMap).includes(col) && 
          rows.some(r => r[col] && r[col].toString().length > 15)) {
        columnMap[col] = 'name';
        console.log(`Coluna ${col} definida como "name" (fallback)`);
        break;
      }
    }
  }
  
  if (!hasCode) {
    // Tentar encontrar uma coluna com códigos alfanuméricos curtos
    for (const col of ['F', 'I', 'J']) {
      if (!Object.keys(columnMap).includes(col) && 
          rows.some(r => r[col] && /^[A-Z0-9-]{2,15}$/i.test(r[col].toString()))) {
        columnMap[col] = 'code';
        console.log(`Coluna ${col} definida como "code" (fallback)`);
        break;
      }
    }
  }
  
  if (!hasPrice) {
    // Tentar encontrar uma coluna com valores monetários
    for (const col of ['L', 'N', 'O', 'P']) {
      if (!Object.keys(columnMap).includes(col) && 
          rows.some(r => r[col] && (r[col].toString().includes('R$') || 
                                    /^\d+([.,]\d{1,2})?$/.test(r[col].toString())))) {
        columnMap[col] = 'price';
        console.log(`Coluna ${col} definida como "price" (fallback)`);
        break;
      }
    }
  }
  
  // Registrar mapeamento final para depuração
  console.log('MAPEAMENTO FINAL DE COLUNAS:', columnMap);
  return columnMap;
}

/**
 * Processa um arquivo Excel utilizando detecção automática de colunas
 * @param {string} filePath Caminho do arquivo Excel
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos
 */
export async function processUniversalCatalog(filePath, userId, catalogId) {
  try {
    console.log(`Processando catálogo com detector universal: ${filePath}`);
    
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
    
    // Analisar as primeiras linhas para detecção de layout
    const sampleRows = rawData.slice(0, Math.min(20, rawData.length));
    console.log("Amostra de linhas para análise:", JSON.stringify(sampleRows.slice(0, 3)));
    
    // Detectar automaticamente o mapeamento de colunas
    const columnMapping = autoDetectColumns(sampleRows);
    
    console.log("Mapeamento de colunas detectado:", columnMapping);
    
    // Encontrar cabeçalho
    let headerRow = -1;
    const headerKeywords = ['nome', 'descrição', 'código', 'preço', 'valor', 'produto', 'qtd', 'quantidade'];
    
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      // Verificar se esta linha contém palavras-chave de cabeçalho
      const rowValues = Object.values(row).map(v => v ? v.toString().toLowerCase() : '');
      const isHeader = headerKeywords.some(keyword => 
        rowValues.some(value => value.includes(keyword))
      );
      
      if (isHeader) {
        headerRow = i;
        console.log(`Cabeçalho detectado na linha ${i + 1}`);
        break;
      }
    }
    
    // Se não encontrou cabeçalho, assumir linha 0
    if (headerRow === -1) {
      headerRow = 0;
      console.log('Nenhum cabeçalho explícito encontrado, assumindo linha 1');
    }
    
    // Lista para armazenar produtos processados
    const products = [];
    
    // Processar linhas
    for (let i = headerRow + 1; i < rawData.length; i++) {
      const row = rawData[i];
      
      // ======= VERIFICAÇÕES PARA IGNORAR LINHAS QUE NÃO SÃO PRODUTOS =======
      
      // 1. Verificar se há dados úteis na linha
      let hasData = false;
      let hasSignificantData = false;
      
      for (const [col, value] of Object.entries(row)) {
        if (value && value.toString().trim()) {
          hasData = true;
          // Verificar se a coluna é importante
          if (Object.keys(columnMapping).includes(col)) {
            hasSignificantData = true;
            break;
          }
        }
      }
      
      // Pular linhas vazias ou sem dados significativos
      if (!hasData || !hasSignificantData) {
        console.log(`Ignorando linha ${i+1} - sem dados importantes`);
        continue;
      }
      
      // 2. Verificar por linhas de cabeçalho ou subtítulos
      const isHeaderLike = Object.values(row).some(val => {
        if (!val) return false;
        const valStr = val.toString().toLowerCase().trim();
        return headerKeywords.some(keyword => valStr === keyword);
      });
      
      if (isHeaderLike) {
        console.log(`Linha ${i+1} parece ser um sub-cabeçalho, ignorando`);
        continue;
      }
      
      // 3. Verificar se a linha contém faixas de preço (20-40k, 50k, etc)
      const hasPriceRange = Object.values(row).some(val => {
        if (!val) return false;
        const valStr = val.toString().toLowerCase().trim();
        return /^\d+\-\d+k$/i.test(valStr) || /^\d+k$/i.test(valStr);
      });
      
      if (hasPriceRange) {
        console.log(`Linha ${i+1} contém faixa de preço, ignorando`);
        continue;
      }
      
      // 4. Verificar se a linha contém observações ou totais
      const isObservationRow = Object.values(row).some(val => {
        if (!val) return false;
        const valStr = val.toString().toLowerCase().trim();
        return valStr === 'total' || 
               valStr === 'obs' || 
               valStr === 'observação' || 
               valStr === 'observações' ||
               valStr.includes('piso') ||
               valStr.includes('andar');
      });
      
      if (isObservationRow) {
        console.log(`Linha ${i+1} é uma observação ou total, ignorando`);
        continue;
      }
      
      // Inicializar o produto
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        excelRowNumber: i + 1,
        isEdited: false,
        price: 0,
        materials: [],
        colors: []
      };
      
      // Extrair dados baseado no mapeamento de colunas
      let productName = '';
      let productCode = '';
      let productDesc = '';
      
      // Processar cada coluna mapeada
      for (const [col, type] of Object.entries(columnMapping)) {
        if (!row[col]) continue;
        
        const value = row[col];
        const strValue = value.toString().trim();
        
        switch (type) {
          case 'name':
            productName = strValue;
            productDesc = strValue;
            break;
            
          case 'code':
            productCode = strValue;
            break;
            
          case 'price':
            product.price = extractUniversalPrice(value);
            break;
            
          // Outros tipos podem ser adicionados conforme necessário
        }
      }
      
      // Preencher campos do produto
      if (productName) {
        product.name = productName;
        product.description = productDesc;
      } else {
        // Tentar extrair nome de outras fontes
        // Tentar coluna G se disponível
        if (row.G) {
          product.name = row.G.toString().trim();
          product.description = product.name;
        } else {
          // Gerar nome com código ou linha
          product.name = productCode ? 
            `Produto ${productCode}` : 
            `Item ${i + 1}`;
        }
      }
      
      // Definir código do produto
      if (productCode) {
        product.code = productCode;
      } else {
        // Fallbacks em ordem de preferência: coluna H, F, ou gerar
        if (row.H) {
          product.code = row.H.toString().trim();
        } else if (row.F) {
          product.code = row.F.toString().trim();
        } else {
          // Gerar código único
          product.code = `ITEM-${i}-${Date.now()}`;
        }
      }
      
      // SEMPRE priorizar a coluna M (Valor Total) para preço, 
      // mesmo que o mapeamento automático tenha detectado outra coluna
      if (row.M) {
        product.price = extractUniversalPrice(row.M);
        console.log(`Preço extraído prioritariamente da coluna M (Valor Total): ${row.M} -> ${product.price} centavos`);
      }
      
      // Fallbacks apenas se a coluna M não existir ou o preço for zero
      if (product.price === 0) {
        if (row.L) {
          product.price = extractUniversalPrice(row.L);
          console.log(`Preço extraído da coluna L (fallback): ${row.L} -> ${product.price} centavos`);
        }
        if (product.price === 0 && row.N) {
          product.price = extractUniversalPrice(row.N);
          console.log(`Preço extraído da coluna N (fallback): ${row.N} -> ${product.price} centavos`);
        }
        if (product.price === 0 && row.J) {
          product.price = extractUniversalPrice(row.J);
          console.log(`Preço extraído da coluna J (fallback): ${row.J} -> ${product.price} centavos`);
        }
      }
      
      // Definir localização
      if (row.B) {
        product.location = row.B.toString().trim();
      }
      
      // Definir fabricante
      if (row.C) {
        product.manufacturer = row.C.toString().trim();
      }
      
      // Extrair material se possível a partir da descrição
      if (product.description) {
        const desc = product.description.toLowerCase();
        const materialMatches = {
          'madeira': 'Madeira',
          'metal': 'Metal',
          'tecido': 'Tecido',
          'couro': 'Couro',
          'vidro': 'Vidro',
          'mármore': 'Mármore',
          'veludo': 'Veludo',
          'concreto': 'Concreto',
          'fórmica': 'Fórmica',
          'inox': 'Aço Inox'
        };
        
        for (const [keyword, material] of Object.entries(materialMatches)) {
          if (desc.includes(keyword)) {
            product.materials.push(material);
          }
        }
      }
      
      // Determinar categoria baseado em múltiplas fontes (nome, localização, fornecedor)
      product.category = 'Móveis'; // Categoria padrão
      
      // 1. Primeiro tentar inferir do nome do produto
      if (product.name) {
        const itemName = product.name.toLowerCase();
        
        if (itemName.includes('sofá') || itemName.includes('sofa') || itemName.includes('poltrona')) {
          product.category = 'Sofás';
        } else if (itemName.includes('mesa')) {
          product.category = 'Mesas';
        } else if (itemName.includes('cadeira')) {
          product.category = 'Cadeiras';
        } else if (itemName.includes('estante') || itemName.includes('prateleira')) {
          product.category = 'Estantes';
        } else if (itemName.includes('cama') || itemName.includes('colchão')) {
          product.category = 'Camas';
        } else if (itemName.includes('luminária') || itemName.includes('lustre') || itemName.includes('pendente')) {
          product.category = 'Iluminação';
        } else if (itemName.includes('tapete') || itemName.includes('carpete')) {
          product.category = 'Tapetes';
        } else if (itemName.includes('armário') || itemName.includes('guarda-roupa')) {
          product.category = 'Armários';
        }
      }
      
      // 2. Tentar inferir do fornecedor
      if (product.manufacturer) {
        const manufacturer = product.manufacturer.toLowerCase();
        
        if (manufacturer.includes('ilum') || manufacturer.includes('lumin')) {
          product.category = 'Iluminação';
        } else if (manufacturer.includes('sofa') || manufacturer.includes('móveis estof')) {
          product.category = 'Sofás';
        } else if (manufacturer.includes('madeira') || manufacturer.includes('marcen')) {
          product.category = 'Móveis de Madeira';
        } else if (manufacturer.includes('vidro') || manufacturer.includes('cristal')) {
          product.category = 'Vidros e Cristais';
        }
      }
      
      // 3. Tentar inferir da localização
      if (product.location) {
        const location = product.location.toLowerCase();
        
        if (location.includes('cozinha')) {
          product.category = 'Cozinha';
        } else if (location.includes('quarto') || location.includes('dormitório')) {
          product.category = 'Quarto';
        } else if (location.includes('sala')) {
          product.category = 'Sala';
        } else if (location.includes('banho') || location.includes('banheiro')) {
          product.category = 'Banheiro';
        } else if (location.includes('escritório')) {
          product.category = 'Escritório';
        } else if (location.includes('área externa') || location.includes('varanda') || location.includes('jardim')) {
          product.category = 'Área Externa';
        }
      }
      
      // Adicionar produto à lista se tiver dados suficientes
      const isValid = 
        product.name && 
        product.name.trim() !== "" && 
        product.code && 
        product.code.trim() !== "";
      
      // Ignorar produtos que são claramente observações ou valores que não são produtos
      const isObservation = !product.code || 
                           product.code === "LOCAL" || 
                           product.code === "NOME" || 
                           product.code.toLowerCase().includes("total") ||
                           product.code.includes('k') || // Ignorar faixas de preço como "20-40k"
                           product.name.toLowerCase().includes("total") ||
                           product.name.toLowerCase().includes("obs") ||
                           product.name.toLowerCase().includes("piso") ||
                           product.name.toLowerCase().includes("andar") ||
                           /^\d+\-\d+k$/i.test(product.name) || // Ignorar faixas de preço como "20-40k"
                           /^\d+k$/i.test(product.name);  // Ignorar valores como "50k"
      
      if (isValid && !isObservation) {
        console.log(`Criando produto: ${product.name}, código: ${product.code}, preço: ${product.price}`);
        products.push(product);
      } else {
        console.log(`Ignorando linha ${i+1} - dados inválidos ou observação`);
      }
    }
    
    console.log(`Extraídos ${products.length} produtos válidos`);
    
    // Filtrar produtos com preço zero
    const filteredProducts = products.filter(product => product.price > 0);
    console.log(`Produtos após filtrar preços zero: ${filteredProducts.length}`);
    
    return filteredProducts;
  } catch (error) {
    console.error('Erro no processador universal de catálogo:', error);
    throw error;
  }
}

/**
 * Extrai e associa imagens a produtos, funcionando com qualquer tipo de catálogo
 * @param {Array} products Lista de produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {string} imagesDir Diretório de imagens extraídas
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos com imagens associadas
 */
export async function associateUniversalProductsWithImages(products, excelPath, imagesDir, userId, catalogId) {
  try {
    console.log(`Associando imagens universais com ${products.length} produtos`);
    
    // Verificar se o diretório de imagens existe
    if (!fs.existsSync(imagesDir)) {
      console.warn(`Diretório de imagens não encontrado: ${imagesDir}`);
      return products;
    }
    
    // Ler todas as imagens do diretório
    const files = fs.readdirSync(imagesDir).filter(file => 
      /\.(png|jpg|jpeg|gif|webp|bmp|emf)$/i.test(file)
    );
    
    if (files.length === 0) {
      console.warn('Nenhuma imagem encontrada para associar com produtos');
      return products;
    }
    
    console.log(`Encontradas ${files.length} imagens no diretório`);
    
    // Criar diretório para imagens associadas
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Associar imagens com produtos de forma inteligente
    const updatedProducts = await Promise.all(products.map(async (product, index) => {
      // Índice padrão para o caso de não encontrar correspondência
      let fileIndex = index % files.length;
      let matched = false;
      
      // Tentar encontrar uma imagem que corresponda ao código ou nome do produto
      for (const field of ['code', 'name']) {
        if (matched) break;
        
        if (product[field]) {
          const searchTerm = product[field].toString().trim().toLowerCase();
          
          // Ignorar termos muito genéricos para fazer correspondências
          if (searchTerm.length < 3 || 
              ['nome', 'local', 'código', 'preço'].includes(searchTerm)) {
            continue;
          }
          
          // Tentar encontrar correspondência nos nomes dos arquivos
          const matchingFileIndex = files.findIndex(file => 
            file.toLowerCase().includes(searchTerm)
          );
          
          if (matchingFileIndex >= 0) {
            fileIndex = matchingFileIndex;
            matched = true;
            console.log(`Correspondência encontrada para ${searchTerm}: ${files[fileIndex]}`);
          }
        }
      }
      
      // Usar a imagem selecionada
      const file = files[fileIndex];
      const sourceFilePath = path.join(imagesDir, file);
      const targetFileName = `${Date.now()}-${file}`;
      const targetFilePath = path.join(targetDir, targetFileName);
      
      try {
        fs.copyFileSync(sourceFilePath, targetFilePath);
        const imageUrl = `/api/images/${userId}/${catalogId}/${targetFileName}`;
        
        if (matched) {
          console.log(`Associada imagem correspondente ${file} ao produto ${product.code || product.name}`);
        } else {
          console.log(`Associada imagem ${file} (sem correspondência específica) ao produto ${product.code || product.name}`);
        }
        
        return { ...product, imageUrl };
      } catch (copyError) {
        console.error(`Erro ao copiar imagem ${file}:`, copyError);
        return product;
      }
    }));
    
    return updatedProducts;
  } catch (error) {
    console.error('Erro ao associar imagens com produtos:', error);
    return products;
  }
}