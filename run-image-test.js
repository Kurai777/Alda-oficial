/**
 * Script de teste independente para verificar a extração de imagens do Excel
 * 
 * Este script executa uma verificação simplificada no arquivo Excel especificado
 * sem depender do servidor express completo ou do Vite.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Para obter o __dirname em ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verificar argumentos
const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: node run-image-test.js <caminho-para-arquivo-excel>');
  process.exit(1);
}

// Verificar se o arquivo existe
if (!fs.existsSync(filePath)) {
  console.error(`Arquivo não encontrado: ${filePath}`);
  process.exit(1);
}

// Verificar extensão
const fileName = path.basename(filePath);
if (!fileName.toLowerCase().endsWith('.xlsx') && !fileName.toLowerCase().endsWith('.xls')) {
  console.error('O arquivo deve ser um Excel (.xlsx ou .xls)');
  process.exit(1);
}

async function runTest() {
  try {
    console.log(`\n===== TESTE DE EXTRAÇÃO DE IMAGENS DO EXCEL =====`);
    console.log(`Arquivo: ${fileName}`);
    
    // Importar os módulos de processamento de Excel
    console.log('\n[1] Importando módulos...');
    const { processExcelFile } = await import('./server/excel-processor.js');
    const { hasExcelImages, extractImagesFromExcel } = await import('./server/robust-excel-image-extractor.js');
    const { hasExcelImagesWithPython, extractImagesWithPythonBridge } = await import('./server/python-excel-bridge.js');
    
    // Extrair produtos básicos
    console.log('\n[2] Extraindo produtos do Excel...');
    const products = await processExcelFile(filePath, "test-user", "test-catalog");
    console.log(`Produtos encontrados: ${products.length}`);
    
    if (products.length > 0) {
      console.log('\nAmostra de produtos:');
      products.slice(0, 3).forEach((p, i) => {
        console.log(`\n[Produto ${i+1}]`);
        console.log(`Nome: ${p.name}`);
        console.log(`Código: ${p.code}`);
        console.log(`Preço: ${p.price}`);
        if (p.category) console.log(`Categoria: ${p.category}`);
        if (p.manufacturer) console.log(`Fabricante: ${p.manufacturer}`);
      });
    }
    
    // Verificar imagens com JavaScript
    console.log('\n[3] Verificando presença de imagens com JavaScript...');
    const hasImages = await hasExcelImages(filePath);
    console.log(`Resultado: ${hasImages ? 'Imagens encontradas' : 'Nenhuma imagem encontrada'}`);
    
    // Verificar imagens com Python
    console.log('\n[4] Verificando presença de imagens com Python...');
    const hasImagesPython = await hasExcelImagesWithPython(filePath);
    console.log(`Resultado: ${hasImagesPython ? 'Imagens encontradas' : 'Nenhuma imagem encontrada'}`);
    
    // Extrair imagens se encontradas
    if (hasImages || hasImagesPython) {
      // Extrair com JavaScript se disponível
      if (hasImages) {
        console.log('\n[5A] Extraindo imagens com JavaScript...');
        try {
          const jsProducts = await extractImagesFromExcel(filePath, products, "test-user", "test-catalog");
          const jsProductsWithImages = jsProducts.filter(p => p.imageUrl);
          
          console.log(`Imagens extraídas: ${jsProductsWithImages.length}/${jsProducts.length}`);
          
          if (jsProductsWithImages.length > 0) {
            console.log('\nAmostra de URLs de imagens:');
            jsProductsWithImages.slice(0, 3).forEach((p, i) => {
              console.log(`[${i+1}] ${p.code}: ${p.imageUrl}`);
            });
          }
        } catch (error) {
          console.error('Erro na extração JS:', error);
        }
      }
      
      // Extrair com Python se disponível
      if (hasImagesPython) {
        console.log('\n[5B] Extraindo imagens com Python...');
        try {
          const pythonProducts = await extractImagesWithPythonBridge(filePath, products, "test-user", "test-catalog");
          const pythonProductsWithImages = pythonProducts.filter(p => p.imageUrl);
          
          console.log(`Imagens extraídas: ${pythonProductsWithImages.length}/${pythonProducts.length}`);
          
          if (pythonProductsWithImages.length > 0) {
            console.log('\nAmostra de URLs de imagens:');
            pythonProductsWithImages.slice(0, 3).forEach((p, i) => {
              console.log(`[${i+1}] ${p.code}: ${p.imageUrl}`);
            });
          }
        } catch (error) {
          console.error('Erro na extração Python:', error);
        }
      }
    } else {
      console.log('\n[5] Nenhuma imagem encontrada para extrair.');
    }
    
    console.log('\n===== TESTE CONCLUÍDO =====');
  } catch (error) {
    console.error('\nERRO DURANTE O TESTE:', error);
  }
}

// Executar o teste
runTest();