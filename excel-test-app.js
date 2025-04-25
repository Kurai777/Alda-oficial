/**
 * Script de teste básico para extração de imagens de Excel e detecção de contéudo
 */

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Verifica se um arquivo Excel contém imagens
async function hasExcelImages(filePath) {
  try {
    // Ler o arquivo Excel
    const excelData = await fs.promises.readFile(filePath);
    
    // Carregar como ZIP
    const zip = await JSZip.loadAsync(excelData);
    
    // Verificar pastas comuns que contêm imagens
    const entries = Object.keys(zip.files);
    
    // Procurar por padrões de arquivo de imagem
    const imageEntries = entries.filter(entry => {
      return entry.match(/\.(png|jpeg|jpg|gif|bmp|wmf|emf)$/i) ||
             entry.match(/xl\/media\/image\d+/i) ||
             entry.match(/xl\/drawings\/media\/image\d+/i);
    });
    
    return {
      hasImages: imageEntries.length > 0,
      count: imageEntries.length,
      examples: imageEntries.slice(0, 3)
    };
  } catch (error) {
    console.error(`Erro ao verificar imagens: ${error.message}`);
    return { hasImages: false, error: error.message };
  }
}

// Extrai dados básicos de um Excel
function extractBasicExcelData(filePath, limit = 5) {
  try {
    // Se o arquivo for um PDF, retornar uma mensagem informativa
    if (filePath.toLowerCase().endsWith('.pdf')) {
      return {
        type: 'pdf',
        message: 'Arquivo é um PDF, não um Excel. Use o extrator de PDF adequado.'
      };
    }
    
    // Para fins de teste, vamos simular dados extraídos
    return {
      fileName: path.basename(filePath),
      type: path.extname(filePath).toLowerCase(),
      message: 'Este é um extrator simplificado para testes. Sem processamento real de dados.',
      sampleData: [
        { message: 'Este é um extrator de demonstração que não processa o conteúdo real do arquivo.' },
        { message: 'No sistema completo, os produtos seriam extraídos aqui com seus dados e imagens.' },
        { message: 'Para testes de UI e fluxo, você pode usar estes dados simulados.' }
      ]
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Função principal
async function main() {
  // Caminho para o PDF de teste
  const pdfPath = path.join(process.cwd(), 'attached_assets', 'Tabela Fratini - Fevereiro 2025.pdf');
  
  console.log('=== TESTE DE ANÁLISE DE ARQUIVOS ===');
  
  if (fs.existsSync(pdfPath)) {
    console.log(`\nTestando PDF: ${pdfPath}`);
    
    // Testar função de verificação de imagens
    console.log('Verificando se contém imagens (deve falhar para PDF):');
    const hasImages = await hasExcelImages(pdfPath).catch(err => {
      console.log('Erro esperado ao tentar ler PDF como Excel:', err.message);
      return { hasImages: false, error: err.message };
    });
    console.log(hasImages);
    
    // Verificar extração básica
    console.log('\nExtração básica de dados:');
    const basicData = extractBasicExcelData(pdfPath);
    console.log(basicData);
  } else {
    console.log(`Arquivo não encontrado: ${pdfPath}`);
  }
  
  console.log('\n=== TESTE CONCLUÍDO ===');
}

// Executar
main().catch(console.error);