// Script para testar a extração de imagens de arquivos Excel
import { hasExcelImages, extractImagesFromExcel } from './robust-excel-image-extractor.js';
import path from 'path';

// Caminho para um arquivo Excel de teste
const SAMPLE_EXCEL_FILE = path.join(process.cwd(), 'uploads', 'sample-excel.xlsx');

// Função para testar a extração de imagens
async function testExcelImageExtraction() {
  try {
    console.log("Iniciando teste de extração de imagens do Excel");
    console.log(`Arquivo de teste: ${SAMPLE_EXCEL_FILE}`);
    
    // Verificar se o arquivo existe
    const fs = await import('fs');
    if (!fs.existsSync(SAMPLE_EXCEL_FILE)) {
      console.error(`ERRO: Arquivo de teste não encontrado: ${SAMPLE_EXCEL_FILE}`);
      console.log("Por favor, faça upload de um arquivo Excel com imagens para a pasta uploads/ e renomeie para sample-excel.xlsx");
      return;
    }
    
    // Verificar se o arquivo contém imagens
    console.log("Verificando se o arquivo contém imagens...");
    const hasImages = await hasExcelImages(SAMPLE_EXCEL_FILE);
    
    if (!hasImages) {
      console.log("O arquivo não contém imagens. Escolha outro arquivo Excel com imagens embutidas.");
      return;
    }
    
    console.log("O arquivo contém imagens. Extraindo...");
    
    // Dados de exemplo para teste
    const mockProducts = [
      {
        code: "PROD001",
        name: "Sofá de Couro",
        description: "Sofá 3 lugares em couro legítimo",
        price: 2500,
        category: "Sofá"
      },
      {
        code: "PROD002",
        name: "Mesa de Jantar",
        description: "Mesa de jantar em madeira maciça",
        price: 1800,
        category: "Mesa"
      },
      {
        code: "PROD003",
        name: "Poltrona Reclinável",
        description: "Poltrona reclinável em tecido",
        price: 1200,
        category: "Poltrona"
      }
    ];
    
    // Testar a extração e associação de imagens
    console.log("Extraindo imagens e associando aos produtos...");
    const productsWithImages = await extractImagesFromExcel(
      SAMPLE_EXCEL_FILE,
      mockProducts,
      "test-user-123",
      "test-catalog-456"
    );
    
    // Verificar resultados
    console.log("\n=== RESULTADO DO TESTE ===");
    console.log(`Total de produtos processados: ${productsWithImages.length}`);
    
    // Verificar quantos produtos receberam imagens
    const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
    console.log(`Produtos com imagens associadas: ${productsWithImagesCount} de ${productsWithImages.length}`);
    
    // Mostrar detalhes dos produtos com imagens
    console.log("\nDetalhes dos produtos com imagens:");
    productsWithImages.forEach((product, index) => {
      console.log(`\nProduto ${index + 1}: ${product.name} (${product.code})`);
      if (product.imageUrl) {
        console.log(`- Imagem principal: ${product.imageUrl}`);
        if (product.additionalImages && product.additionalImages.length > 0) {
          console.log(`- Imagens adicionais: ${product.additionalImages.length}`);
          product.additionalImages.forEach((img, imgIndex) => {
            console.log(`  - Imagem ${imgIndex + 1}: ${img}`);
          });
        }
      } else {
        console.log(`- Sem imagem associada`);
      }
    });
    
    console.log("\nTeste concluído com sucesso!");
  } catch (error) {
    console.error("ERRO durante o teste:", error);
  }
}

// Executar o teste
testExcelImageExtraction().catch(err => {
  console.error("Falha no teste:", err);
}); 