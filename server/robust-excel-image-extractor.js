/**
 * Módulo robusto para extração de imagens de Excel
 * 
 * Este módulo é um wrapper simples do extrator avançado para manter
 * compatibilidade com código existente.
 */

// Importar o extrator avançado
import { extractImagesFromExcel as extractAdvanced, hasExcelImages as hasExcelImagesAdvanced } from './advanced-excel-image-extractor.js';

/**
 * Extrai imagens de um arquivo Excel
 * Este é um wrapper do extrator avançado para compatibilidade com código existente
 */
export async function extractImagesFromExcel(filePath, products, userId, catalogId) {
  console.log('Usando extrator avançado via wrapper de compatibilidade');
  return extractAdvanced(filePath, products, userId, catalogId);
}

/**
 * Verifica se um arquivo Excel contém imagens
 * Este é um wrapper do extrator avançado para compatibilidade com código existente
 */
export async function hasExcelImages(filePath) {
  console.log('Verificando presença de imagens via wrapper de compatibilidade');
  return hasExcelImagesAdvanced(filePath);
}

// Exportar as funções
export default {
  extractImagesFromExcel,
  hasExcelImages
};