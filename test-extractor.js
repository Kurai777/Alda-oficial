/**
 * Script de teste básico para extração de imagens do Excel
 */
import { hasExcelImages, extractImagesFromExcel } from './server/robust-excel-image-extractor.js';

// Caminho para o arquivo de teste
const testFile = './attached_assets/Tabela Fratini - Fevereiro 2025.pdf';

// Testar verificação de imagens
async function testImageDetection() {
  console.log('=== TESTE DE DETECÇÃO DE IMAGENS ===');
  console.log(`Arquivo: ${testFile}`);

  try {
    const hasImages = await hasExcelImages(testFile);
    console.log(`Contém imagens: ${hasImages ? 'SIM' : 'NÃO'}`);
  } catch (error) {
    console.error('Erro ao verificar imagens:', error.message);
  }
}

// Executar teste
testImageDetection().then(() => {
  console.log('Teste concluído');
}).catch(error => {
  console.error('Erro no teste:', error);
});