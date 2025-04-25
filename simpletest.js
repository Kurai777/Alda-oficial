/**
 * Teste independente para extrator de Excel
 */

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Função básica para extrair imagens de um Excel via JSZip
async function extractImagesWithJSZip(excelPath) {
  console.log(`Extraindo imagens de: ${excelPath}`);

  try {
    // Ler o arquivo Excel
    const excelData = await fs.promises.readFile(excelPath);
    console.log(`Arquivo lido: ${excelData.length} bytes`);

    // Carregar o zip
    const zip = await JSZip.loadAsync(excelData);
    console.log('Arquivo ZIP carregado');
    
    // Listar todas as pastas e arquivos
    const entries = Object.keys(zip.files);
    console.log(`Encontradas ${entries.length} entradas no ZIP`);
    
    // Procurar por imagens nas entradas
    const imageEntries = entries.filter(entry => {
      // Padrões de imagens em Excel (.png, .jpeg, .wmf, imagens embutidas, etc)
      return entry.match(/\.(png|jpeg|jpg|gif|bmp|wmf|emf)$/i) ||
             entry.match(/xl\/media\/image\d+/i) ||
             entry.match(/xl\/drawings\/media\/image\d+/i);
    });
    
    console.log(`Encontradas ${imageEntries.length} imagens potenciais`);
    console.log('Exemplos:', imageEntries.slice(0, 5));
    
    return {
      success: true,
      imagesFound: imageEntries.length,
      imageEntries: imageEntries.slice(0, 10)
    };
  } catch (error) {
    console.error('Erro na extração com JSZip:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Função para testar se há algum arquivo Excel nos attached_assets
function findExcelFiles() {
  const assetsDir = path.join(process.cwd(), 'attached_assets');
  console.log(`Procurando arquivos Excel em: ${assetsDir}`);
  
  try {
    const files = fs.readdirSync(assetsDir);
    const excelFiles = files.filter(file => 
      file.endsWith('.xlsx') || 
      file.endsWith('.xls') || 
      file.endsWith('.xlsm')
    );
    
    console.log(`Encontrados ${excelFiles.length} arquivos Excel: ${excelFiles.join(', ')}`);
    return excelFiles.map(file => path.join(assetsDir, file));
  } catch (error) {
    console.error('Erro ao procurar arquivos Excel:', error);
    return [];
  }
}

// Executar o teste
async function runTest() {
  console.log('=== TESTE DE EXTRAÇÃO DE IMAGENS DO EXCEL ===');
  
  // Encontrar arquivos Excel
  const excelFiles = findExcelFiles();
  
  if (excelFiles.length === 0) {
    console.log('Nenhum arquivo Excel encontrado. Teste não pode continuar.');
    return;
  }
  
  // Testar cada arquivo
  for (let i = 0; i < excelFiles.length; i++) {
    const excelFile = excelFiles[i];
    console.log(`\nTestando arquivo ${i+1}/${excelFiles.length}: ${path.basename(excelFile)}`);
    
    // Extrair imagens
    const result = await extractImagesWithJSZip(excelFile);
    
    console.log(`Resultado: ${result.success ? 'Sucesso' : 'Falha'}`);
    if (result.success) {
      console.log(`Imagens encontradas: ${result.imagesFound}`);
    } else {
      console.log(`Erro: ${result.error}`);
    }
  }
  
  console.log('\n=== TESTE CONCLUÍDO ===');
}

// Executar o teste
runTest().catch(error => {
  console.error('Erro geral do teste:', error);
});