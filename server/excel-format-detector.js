/**
 * Detector de formato de planilhas Excel
 * 
 * Este módulo analisa estruturalmente um arquivo Excel para identificar o formato
 * e mapear corretamente as colunas para os campos do sistema (nome, preço, etc).
 */

import XLSX from 'xlsx';

// Mapeamento expandido de palavras-chave para facilitar a identificação
const FIELD_KEYWORDS = {
  // Campo: nome do produto
  name: [
    'nome', 'produto', 'descrição', 'descricao', 'item', 'título', 'titulo',
    'designação', 'designacao', 'material', 'modelo', 'denominacao', 'denominação'
  ],
  
  // Campo: código do produto
  code: [
    'código', 'codigo', 'referência', 'referencia', 'ref', 'ref.', 'sku',
    'id', 'identificação', 'identificacao', 'cód', 'cod'
  ],
  
  // Campo: preço
  price: [
    'preço', 'preco', 'valor', 'custo', 'r$', 'price', 'preço unitário',
    'preco unitario', 'vl unitário', 'vl unitario', 'preço un', 'preco un',
    'preço unit', 'preco unit', 'preço final', 'preco final'
  ],
  
  // Campo: categoria
  category: [
    'categoria', 'category', 'grupo', 'família', 'familia', 'tipo', 'class',
    'classificação', 'classificacao', 'departamento', 'segmento', 'linha'
  ],
  
  // Campo: marca / fabricante
  manufacturer: [
    'marca', 'fabricante', 'fornecedor', 'brand', 'manufacturer', 'producer',
    'produtor', 'indústria', 'industria', 'supplier', 'origem'
  ],
  
  // Campo: dimensões
  dimensions: [
    'dimensões', 'dimensoes', 'tamanho', 'medidas', 'medida', 'tam', 'dimension',
    'altura', 'largura', 'profundidade', 'comprimento', 'diâmetro', 'diametro',
    'alt', 'larg', 'prof', 'comp', 'diam', 'medida', 'measure'
  ],
  
  // Campo: cor
  color: [
    'cor', 'color', 'acabamento', 'finish', 'coloração', 'coloracao', 'tonalidade',
    'tone', 'matiz'
  ],
  
  // Campo: material
  material: [
    'material', 'composição', 'composicao', 'tecido', 'fabric', 'matéria-prima',
    'materia-prima', 'estrutura'
  ],
  
  // Campo: estoque
  stock: [
    'estoque', 'qtd', 'quantidade', 'stock', 'inventory', 'disponível', 'disponivel',
    'qtde', 'saldo', 'disponibilidade'
  ],
  
  // Campo: descrição técnica
  technicalDescription: [
    'descrição técnica', 'descricao tecnica', 'especificação', 'especificacao',
    'detalhe técnico', 'detalhe tecnico', 'característica', 'caracteristica',
    'tech', 'técnico', 'tecnico'
  ]
};

/**
 * Detecta o tipo de dado em uma coluna baseado em seu conteúdo
 * 
 * @param {Array} column Array de valores da coluna
 * @returns {Object} Informações sobre o tipo de dados da coluna
 */
function detectColumnType(column) {
  // Filtrar valores nulos e vazios
  const nonEmptyValues = column.filter(v => v !== null && v !== undefined && v !== '');
  if (nonEmptyValues.length === 0) {
    return { type: 'unknown', confidence: 0 };
  }
  
  // Inicializar contadores de tipos
  let numericCount = 0;
  let stringCount = 0;
  let priceFormatCount = 0;
  let wordCount = 0;
  let codePatternCount = 0;
  
  // Analisar cada valor
  for (const value of nonEmptyValues) {
    const stringValue = String(value).trim();
    
    // Verificar se parece preço (contém R$, $, €, começa com cifra ou termina com cifra)
    if (/^[R$€£¥$]?\s*[0-9.,]+\s*$|^[0-9.,]+\s*[R$€£¥$]$/.test(stringValue)) {
      priceFormatCount++;
    }
    
    // Verificar se é numérico (permite vírgulas e pontos)
    if (/^[0-9.,]+$/.test(stringValue)) {
      numericCount++;
    } 
    // Se tem mais de uma palavra, provavelmente é descrição/nome
    else if (stringValue.split(/\s+/).length > 1) {
      wordCount++;
    }
    
    // Verificar padrões de código (letras+números, com traços ou pontos)
    if (/^[A-Za-z0-9][-_.][A-Za-z0-9]/i.test(stringValue) || 
        /^[A-Za-z]{1,3}[-_.]?[0-9]{2,}$/i.test(stringValue)) {
      codePatternCount++;
    }
    
    // Contagem básica de strings vs números
    if (typeof value === 'string') {
      stringCount++;
    } else if (typeof value === 'number') {
      numericCount++;
    }
  }
  
  // Calcular porcentagens
  const total = nonEmptyValues.length;
  const numericPercent = numericCount / total;
  const pricePercent = priceFormatCount / total;
  const wordPercent = wordCount / total;
  const codePercent = codePatternCount / total;
  
  // Determinar o tipo mais provável
  if (pricePercent > 0.5) {
    return { type: 'price', confidence: pricePercent };
  } else if (codePercent > 0.5) {
    return { type: 'code', confidence: codePercent };
  } else if (wordPercent > 0.5) {
    return { type: 'name', confidence: wordPercent };
  } else if (numericPercent > 0.7) {
    return { type: 'numeric', confidence: numericPercent };
  } else {
    return { type: 'string', confidence: 1 - numericPercent };
  }
}

/**
 * Compara o cabeçalho com as palavras-chave para inferir o campo
 * 
 * @param {string} header Texto do cabeçalho
 * @returns {Object} Campo correspondente e nível de confiança
 */
function matchHeaderToField(header) {
  if (!header) return { field: null, confidence: 0 };
  
  // Normalizar o cabeçalho para comparação (remover acentos, minúsculas)
  const normalizedHeader = header.toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  let bestMatch = { field: null, confidence: 0 };
  
  // Verificar cada campo
  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedHeader === keyword) {
        // Correspondência exata tem confiança máxima
        return { field, confidence: 1 };
      } else if (normalizedHeader.includes(keyword)) {
        // Correspondência parcial - calcular confiança baseada no tamanho relativo
        const confidence = keyword.length / normalizedHeader.length;
        if (confidence > bestMatch.confidence) {
          bestMatch = { field, confidence };
        }
      }
    }
  }
  
  return bestMatch;
}

/**
 * Analisa uma coluna para encontrar cabeçalhos
 * 
 * @param {Array} data Dados da planilha
 * @param {number} maxRowsToScan Número máximo de linhas para procurar cabeçalhos
 * @returns {Object} Informações sobre cabeçalhos encontrados
 */
function findHeaderRow(data, maxRowsToScan = 15) {
  // Limitar número de linhas para análise
  const rowsToScan = Math.min(maxRowsToScan, data.length);
  const candidates = [];
  
  // Analisar cada linha para ver se pode ser um cabeçalho
  for (let i = 0; i < rowsToScan; i++) {
    const row = data[i];
    const rowKeys = Object.keys(row);
    
    // Se a linha não tem células, pular
    if (rowKeys.length === 0) continue;
    
    let headerScore = 0;
    let fieldMatches = 0;
    const matchedFields = new Set();
    
    // Analisar cada célula da linha
    for (const key of rowKeys) {
      const cellValue = row[key];
      if (!cellValue) continue;
      
      const cellStr = String(cellValue).toLowerCase();
      const { field, confidence } = matchHeaderToField(cellStr);
      
      if (field && confidence > 0.5) {
        headerScore += confidence;
        fieldMatches++;
        matchedFields.add(field);
      }
    }
    
    // Pontuação baseada em correspondência e variedade de campos
    const uniqueFieldScore = matchedFields.size / 5; // Normalizado para 5 campos únicos
    const finalScore = (headerScore / rowKeys.length) * (fieldMatches / rowKeys.length) * (1 + uniqueFieldScore);
    
    candidates.push({
      row: i,
      score: finalScore,
      matchedFields: Array.from(matchedFields)
    });
  }
  
  // Ordenar candidatos pela pontuação
  candidates.sort((a, b) => b.score - a.score);
  
  // Verificar se temos um candidato forte
  if (candidates.length > 0 && candidates[0].score > 0.2) {
    return {
      headerRow: candidates[0].row,
      confidence: candidates[0].score,
      matchedFields: candidates[0].matchedFields
    };
  } else {
    // Nenhum cabeçalho forte encontrado
    return { headerRow: -1, confidence: 0, matchedFields: [] };
  }
}

/**
 * Analisa uma planilha para detectar seu formato e coleta informações 
 * sobre a estrutura dos dados.
 * 
 * @param {string} filePath Caminho para o arquivo Excel
 * @returns {Object} Detalhes sobre o formato da planilha
 */
export async function detectExcelFormat(filePath) {
  try {
    console.log(`Analisando formato do Excel: ${filePath}`);
    
    // Ler arquivo Excel
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    
    // Usar primeira planilha
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON usando A1 como cabeçalho
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    // Detectar linha de cabeçalho
    const headerInfo = findHeaderRow(rawData);
    
    // Mapear colunas para campos
    const columnMappings = {};
    const dataTypes = {};
    
    // Obter todas as colunas utilizadas
    const allColumns = new Set();
    rawData.forEach(row => {
      Object.keys(row).forEach(col => allColumns.add(col));
    });
    
    if (headerInfo.headerRow >= 0) {
      // Se encontramos um cabeçalho, usar para mapear
      const headerRow = rawData[headerInfo.headerRow];
      
      for (const column of allColumns) {
        const headerValue = headerRow[column];
        if (!headerValue) continue;
        
        const { field, confidence } = matchHeaderToField(headerValue);
        if (field && confidence > 0.5) {
          columnMappings[column] = field;
        }
      }
    }
    
    // Detectar tipos de dados por coluna
    for (const column of allColumns) {
      // Extrair valores da coluna
      const values = rawData.map(row => row[column]).filter(v => v !== undefined);
      
      // Detectar tipo
      dataTypes[column] = detectColumnType(values);
    }
    
    // Se não encontramos colunas suficientes pelo cabeçalho,
    // tentar inferir pelos tipos de dados
    if (Object.keys(columnMappings).length < 2) {
      // Procurar coluna de preço pelo tipo de dados
      const priceColumns = Object.entries(dataTypes)
        .filter(([_, info]) => info.type === 'price')
        .sort((a, b) => b[1].confidence - a[1].confidence);
      
      if (priceColumns.length > 0) {
        columnMappings[priceColumns[0][0]] = 'price';
      }
      
      // Procurar coluna de nome pelo tipo de dados
      const nameColumns = Object.entries(dataTypes)
        .filter(([_, info]) => info.type === 'name')
        .sort((a, b) => b[1].confidence - a[1].confidence);
      
      if (nameColumns.length > 0) {
        columnMappings[nameColumns[0][0]] = 'name';
      }
      
      // Procurar coluna de código pelo tipo de dados
      const codeColumns = Object.entries(dataTypes)
        .filter(([_, info]) => info.type === 'code')
        .sort((a, b) => b[1].confidence - a[1].confidence);
      
      if (codeColumns.length > 0) {
        columnMappings[codeColumns[0][0]] = 'code';
      }
    }
    
    // Verificar POE específico ou outros formatos conhecidos
    const isPOEFormat = rawData.some(row => 
      row.B && typeof row.B === 'string' && row.B.toString().toUpperCase().includes('POE')
    );
    
    // Se é formato POE, definir o mapeamento POE padrão
    if (isPOEFormat) {
      columnMappings.B = 'code';
      columnMappings.C = 'name';
      columnMappings.D = 'category';
      columnMappings.E = 'manufacturer';
      columnMappings.F = 'price';
    }
    
    // Preparar informações sobre o formato
    const formatInfo = {
      totalRows: rawData.length,
      headerRow: headerInfo.headerRow,
      headerConfidence: headerInfo.confidence,
      startRow: headerInfo.headerRow >= 0 ? headerInfo.headerRow + 1 : 0,
      columnMappings,
      dataTypes,
      isPOEFormat,
      hasHeader: headerInfo.headerRow >= 0,
      detectedFields: headerInfo.matchedFields,
      missingFields: []
    };
    
    // Verificar campos essenciais que estão faltando
    const essentialFields = ['name', 'price'];
    formatInfo.missingFields = essentialFields.filter(field => 
      !Object.values(columnMappings).includes(field)
    );
    
    console.log(`Formato detectado: ${isPOEFormat ? 'POE' : 'Genérico'}`);
    console.log(`Linha de cabeçalho: ${formatInfo.headerRow}`);
    console.log(`Mapeamento de colunas: ${JSON.stringify(formatInfo.columnMappings)}`);
    
    return formatInfo;
  } catch (error) {
    console.error('Erro ao detectar formato do Excel:', error);
    return {
      error: error.message,
      isPOEFormat: false,
      headerRow: 0,
      columnMappings: {},
      startRow: 0,
      totalRows: 0,
      hasHeader: false,
      missingFields: ['name', 'price', 'code']
    };
  }
}

/**
 * Verifica se uma célula contém o valor formatado como preço
 * 
 * @param {any} value Valor da célula
 * @returns {number} Preço convertido
 */
export function extractPrice(value) {
  if (!value) return 0;
  
  // Converter para string
  const str = String(value);
  
  // Remover símbolos de moeda e extrair apenas números/pontos/vírgulas
  const cleaned = str.replace(/[^\d,.]/g, '');
  
  // Verificar formatação brasileira (vírgula como decimal)
  if (cleaned.indexOf(',') > cleaned.indexOf('.') || 
      (cleaned.indexOf(',') >= 0 && cleaned.indexOf('.') === -1)) {
    // Formato brasileiro: trocar vírgula por ponto
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  } else {
    // Formato internacional ou indefinido
    return parseFloat(cleaned.replace(/,/g, '')) || 0;
  }
}

/**
 * Extrai nome de produto da célula, limpando formatos indesejados
 * 
 * @param {any} value Valor da célula
 * @returns {string} Nome limpo
 */
export function extractProductName(value) {
  if (!value) return '';
  
  // Converter para string e limpar
  const str = String(value).trim();
  
  // Remover caracteres HTML ou códigos
  const cleaned = str
    .replace(/<[^>]*>/g, '') // Remover tags HTML
    .replace(/\[[^\]]*\]/g, '') // Remover texto entre colchetes
    .replace(/\([^)]*\)/g, '') // Remover texto entre parênteses se começar com números/códigos
    .replace(/\s{2,}/g, ' '); // Remover espaços extras
  
  return cleaned.trim();
}

/**
 * Função utilitária para ajudar no processamento de arquivos Excel
 * com formatação detectada
 */
export function getExcelFormatHelper() {
  return {
    detectExcelFormat,
    extractPrice,
    extractProductName,
    matchHeaderToField
  };
}