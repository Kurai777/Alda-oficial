#!/usr/bin/env node

// Script de linha de comando para extrair imagens de um arquivo Excel
import { hasExcelImages, extractImagesFromExcel } from './excel-image-extractor.js';
import path from 'path';
import fs from 'fs';

// Verificar argumentos de linha de comando
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Uso: node extract_excel_images.js <caminho-do-arquivo-excel>");
  process.exit(1);
}

const excelFilePath = args[0];

// Função principal
async function main() {
  try {
    console.log(`Processando arquivo Excel: ${excelFilePath}`);
    
    // Verificar se o arquivo existe
    if (!fs.existsSync(excelFilePath)) {
      console.error(`ERRO: Arquivo não encontrado: ${excelFilePath}`);
      process.exit(1);
    }
    
    // Verificar se o arquivo contém imagens
    console.log("Verificando se o arquivo contém imagens...");
    const hasImages = await hasExcelImages(excelFilePath);
    
    if (!hasImages) {
      console.error("O arquivo não contém imagens detectáveis.");
      process.exit(1);
    }
    
    console.log("Imagens detectadas no arquivo Excel.");
    
    // Criar produtos fictícios para testar a extração
    // Em um caso real, estes produtos viriam do processamento da planilha
    const mockProducts = [
      { code: "PROD001", name: "Sofá de Couro" },
      { code: "PROD002", name: "Mesa de Jantar" },
      { code: "PROD003", name: "Poltrona Reclinável" },
      { code: "PROD004", name: "Cadeira" },
      { code: "PROD005", name: "Mesa de Centro" }
    ];
    
    console.log(`Extraindo e associando imagens a ${mockProducts.length} produtos...`);
    
    // Extrair e associar imagens
    const productsWithImages = await extractImagesFromExcel(
      excelFilePath,
      mockProducts,
      "test-user-" + Date.now(),
      "test-catalog-" + Date.now()
    );
    
    // Verificar resultados
    const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
    console.log(`\nProdutos com imagens associadas: ${productsWithImagesCount} de ${productsWithImages.length}`);
    
    // Mostrar detalhes
    productsWithImages.forEach((product, index) => {
      if (product.imageUrl) {
        console.log(`\nProduto ${product.code}: ${product.name}`);
        console.log(`- Imagem: ${product.imageUrl}`);
        
        if (product.additionalImages && product.additionalImages.length > 0) {
          console.log(`- Imagens adicionais: ${product.additionalImages.length}`);
        }
      }
    });
    
    console.log("\nProcessamento concluído com sucesso!");
  } catch (error) {
    console.error("ERRO durante o processamento:", error);
    process.exit(1);
  }
}

// Executar o script
main().catch(err => {
  console.error("Falha fatal:", err);
  process.exit(1);
}); 