/**
 * Detector automático de formato de Excel
 * 
 * Este módulo detecta automaticamente formatos específicos de planilhas Excel
 * com base na estrutura e nos cabeçalhos.
 */

const XLSX = require('xlsx');

/**
 * Resultado da detecção de formato
 */
interface FormatDetectionResult {
  isPOEFormat: boolean;
  isSofaHomeFormat: boolean;
  headerRow: number;
  detectedColumns: string[];
}

/**
 * Detecta automaticamente o formato de um arquivo Excel
 * @param filePath Caminho para o arquivo Excel
 * @returns Informações sobre o formato detectado
 */
export async function detectExcelFormat(filePath: string): Promise<FormatDetectionResult> {
  try {
    // Carregar o workbook
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON para facilitar o processamento
    const data = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!data || data.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Detectando formato para planilha com ${data.length} linhas`);
    
    // Por padrão, assumir que não é nenhum formato especial
    let result: FormatDetectionResult = {
      isPOEFormat: false,
      isSofaHomeFormat: false,
      headerRow: 0,
      detectedColumns: []
    };
    
    // Detectar formato POE
    // Características: 
    // - Usa cabeçalhos alfabéticos (A, B, C...)
    // - Códigos de produto começam com "POE"
    // - Tem colunas específicas para descrição, preço, etc.
    let hasPOECodes = false;
    
    // Verificar as primeiras 20 linhas (ou menos se o arquivo for menor)
    const linesToCheck = Math.min(20, data.length);
    for (let i = 0; i < linesToCheck; i++) {
      const row = data[i];
      
      // Se encontrarmos códigos começando com "POE", é provavelmente formato POE
      if (row && 
          (row.B && typeof row.B === 'string' && row.B.toString().toUpperCase().includes('POE')) ||
          (row.C && typeof row.C === 'string' && row.C.toString().toUpperCase().includes('POE'))) {
        hasPOECodes = true;
        break;
      }
    }
    
    // Tentar detectar cabeçalhos POE
    const headers = data[0] || {};
    const headerKeys = Object.keys(headers);
    
    // Em planilhas POE, os cabeçalhos são alfabéticos e incluem pelo menos 10 colunas
    if (headerKeys.length >= 10) {
      // Verificar se tem um padrão alfabético: A, B, C, D...
      const alphabeticPattern = headerKeys.every((key, index) => {
        return key === String.fromCharCode(65 + index);
      });
      
      if (alphabeticPattern && hasPOECodes) {
        result.isPOEFormat = true;
        result.headerRow = 0;
        result.detectedColumns = headerKeys;
      }
    }
    
    // Detectar formato Sofá Home
    // Características:
    // - Tem cabeçalhos específicos como "código", "nome", "preço"
    // - Geralmente tem uma linha de cabeçalho em português
    for (let i = 0; i < linesToCheck; i++) {
      const row = data[i];
      const rowValues = Object.values(row);
      
      // Converter valores para string para comparação insensível a maiúsculas/minúsculas
      const rowValuesLower = rowValues.map(val => 
        val ? val.toString().toLowerCase() : ''
      );
      
      // Verificar se a linha contém cabeçalhos típicos de Sofá Home
      const hasSofaHomeHeaders = rowValuesLower.some(val => val.includes('codigo') || val.includes('código')) &&
                               rowValuesLower.some(val => val.includes('nome') || val.includes('descricao')) &&
                               rowValuesLower.some(val => val.includes('preco') || val.includes('preço'));
      
      if (hasSofaHomeHeaders) {
        result.isSofaHomeFormat = true;
        result.headerRow = i;
        // Salvar os cabeçalhos originais
        result.detectedColumns = rowValues.map(val => val ? val.toString() : '');
        break;
      }
    }
    
    console.log('Resultado da detecção automática:', result);
    return result;
    
  } catch (error) {
    console.error('Erro na detecção de formato:', error);
    return {
      isPOEFormat: false,
      isSofaHomeFormat: false,
      headerRow: 0,
      detectedColumns: []
    };
  }
}