/**
 * Carregador dinâmico do processador de Excel
 * 
 * Este módulo fornece funções para carregar os processadores 
 * de Excel de forma dinâmica, utilizando import() ESM.
 */

/**
 * Carrega o processador CommonJS
 */
export async function loadExcelProcessor() {
  try {
    // Importar utilizando import() dinâmico que funciona com ESM
    const modulePath = new URL('./excel-processor-simplified.js', import.meta.url).pathname;
    
    // Em Node.js, precisamos converter o caminho do arquivo para um formato URL
    // que funcione com ESM import()
    const fileUrl = `file://${modulePath}`;
    
    // Carregar o módulo dinamicamente
    const module = await import(fileUrl);
    
    return module;
  } catch (err) {
    console.error('Erro ao carregar processador Excel:', err);
    throw err;
  }
}