// pdf-converter-wrapper.js
// Este arquivo é um wrapper para pdf-img-convert que permite
// utilizá-lo de forma compatível com o deploy no Replit

// Importar biblioteca principal e o método alternativo
import alternativePdfProcessor from './alternative-pdf-processor.js';

// Função que tenta importar o pdf-img-convert, mas cai no fallback se falhar
async function getPdfConverter() {
  try {
    // Tentar importar pdf-img-convert
    const pdfImgConvert = await import('pdf-img-convert');
    console.log('Usando biblioteca pdf-img-convert para processamento de PDFs');
    return pdfImgConvert.default;
  } catch (error) {
    // Se falhar, usar nosso processador alternativo
    console.warn('Não foi possível carregar pdf-img-convert, usando método alternativo:', error.message);
    return alternativePdfProcessor;
  }
}

// Exporte as funções que precisamos
export async function convertPdfToImages(filePath, options) {
  try {
    // Obter o conversor apropriado
    const converter = await getPdfConverter();
    // Executar a conversão
    return await converter.convert(filePath, options);
  } catch (error) {
    console.error('Erro ao converter PDF para imagens:', error);
    // Em caso de erro, tentar método alternativo diretamente
    console.log('Tentando método alternativo para processamento de PDF...');
    try {
      return await alternativePdfProcessor.convert(filePath, options);
    } catch (fallbackError) {
      console.error('Falha no método alternativo:', fallbackError);
      throw error; // Manter o erro original se o fallback também falhar
    }
  }
}

export default {
  convert: convertPdfToImages
};