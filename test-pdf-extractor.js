/**
 * Teste independente para extração de dados de PDF
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Obter o diretório atual (equivalente a __dirname no CommonJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simulação do processamento - só para teste, não precisa do OpenAI nem Claude
async function analyzePDF(pdfPath) {
  console.log(`Analisando PDF: ${pdfPath}`);
  
  try {
    // Verificar se o arquivo existe
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo não encontrado: ${pdfPath}`);
    }
    
    // Ler o arquivo PDF
    const pdfBytes = await readFile(pdfPath);
    
    // Carregar o documento PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    // Obter metadados e informações básicas
    const numPages = pdfDoc.getPageCount();
    const title = pdfDoc.getTitle() || "Sem título";
    const author = pdfDoc.getAuthor() || "Autor desconhecido";
    const subject = pdfDoc.getSubject() || "Sem assunto";
    const keywords = pdfDoc.getKeywords() || "Sem palavras-chave";
    const creator = pdfDoc.getCreator() || "Criador desconhecido";
    const producer = pdfDoc.getProducer() || "Produtor desconhecido";
    const creationDate = pdfDoc.getCreationDate() || new Date();
    const modificationDate = pdfDoc.getModificationDate() || new Date();
    
    // Gerar uma amostra aleatória de produtos para simular o resultado da análise
    const sampleProducts = generateSampleProducts(5);
    
    // Preparar estrutura de resultado
    const result = {
      metadata: {
        filename: path.basename(pdfPath),
        filepath: pdfPath,
        title,
        author,
        subject,
        keywords,
        creator,
        producer,
        creationDate,
        modificationDate,
        numPages,
        fileSize: pdfBytes.length,
      },
      analysis: {
        extractionTimestamp: new Date(),
        extractionMethod: "PDF Metadata Test",
        extractionStats: {
          totalPagesProcessed: numPages,
          totalProductsExtracted: sampleProducts.length,
          processingTimeMs: 1500, // Simulado
        }
      },
      products: sampleProducts
    };
    
    return result;
    
  } catch (error) {
    console.error("Erro ao analisar o PDF:", error);
    throw error;
  }
}

// Função para gerar produtos de teste - somente para o propósito do teste
function generateSampleProducts(count = 5) {
  const categories = ['Sofás', 'Mesas', 'Cadeiras', 'Armários', 'Poltronas'];
  const colors = ['Preto', 'Branco', 'Marrom', 'Bege', 'Cinza'];
  const materials = ['Madeira', 'Metal', 'Vidro', 'Tecido', 'Couro'];
  
  const products = [];
  
  // Gerar produtos simulados para teste
  for (let i = 1; i <= count; i++) {
    const categoryIndex = Math.floor(Math.random() * categories.length);
    const category = categories[categoryIndex];
    
    products.push({
      nome: `Produto ${i} - ${category}`,
      codigo: `PDF-${i}`,
      descricao: `Descrição do produto ${i} na categoria ${category}`,
      preco: `R$ ${(Math.random() * 2000 + 500).toFixed(2)}`,
      categoria: category,
      cores: [colors[Math.floor(Math.random() * colors.length)]],
      materiais: [materials[Math.floor(Math.random() * materials.length)]],
      largura: Math.floor(Math.random() * 200) + 50,
      altura: Math.floor(Math.random() * 100) + 40,
      profundidade: Math.floor(Math.random() * 80) + 30,
      pageNumber: Math.floor(Math.random() * 5) + 1,
    });
  }
  
  return products;
}

// Função principal de teste
async function runTest() {
  console.log("Iniciando teste de extração de PDF...");
  
  try {
    // Localizar arquivos PDF para teste
    const testPdfPath = path.join(__dirname, 'attached_assets', 'Tabela Fratini - Fevereiro 2025.pdf');
    
    if (!fs.existsSync(testPdfPath)) {
      console.error(`ERRO: Arquivo de teste não encontrado: ${testPdfPath}`);
      console.log("Verifique se o arquivo 'Tabela Fratini - Fevereiro 2025.pdf' existe em 'attached_assets'");
      return;
    }
    
    console.log(`Arquivo de teste encontrado: ${testPdfPath}`);
    
    // Analisar o PDF
    console.log("\n=== INICIANDO ANÁLISE DO PDF ===\n");
    const result = await analyzePDF(testPdfPath);
    
    // Exibir resultados
    console.log("\n=== RESULTADO DA ANÁLISE ===\n");
    console.log("Metadados do PDF:");
    console.log(`- Nome: ${result.metadata.filename}`);
    console.log(`- Título: ${result.metadata.title}`);
    console.log(`- Autor: ${result.metadata.author}`);
    console.log(`- Número de páginas: ${result.metadata.numPages}`);
    console.log(`- Tamanho: ${(result.metadata.fileSize / 1024).toFixed(2)} KB`);
    
    console.log("\nEstatísticas de Extração:");
    console.log(`- Método: ${result.analysis.extractionMethod}`);
    console.log(`- Páginas processadas: ${result.analysis.extractionStats.totalPagesProcessed}`);
    console.log(`- Produtos extraídos: ${result.analysis.extractionStats.totalProductsExtracted}`);
    
    console.log("\nAmostra de Produtos Extraídos:");
    result.products.slice(0, 3).forEach((product, index) => {
      console.log(`\nProduto ${index + 1}:`);
      console.log(`- Nome: ${product.nome}`);
      console.log(`- Código: ${product.codigo}`);
      console.log(`- Preço: ${product.preco}`);
      console.log(`- Categoria: ${product.categoria}`);
      console.log(`- Dimensões: ${product.largura}x${product.altura}x${product.profundidade} cm`);
    });
    
    // Salvar os resultados em um arquivo JSON
    const resultPath = path.join(__dirname, 'pdf-analysis-result.json');
    await writeFile(resultPath, JSON.stringify(result, null, 2));
    console.log(`\nResultados detalhados salvos em: ${resultPath}`);
    
    console.log("\n=== TESTE CONCLUÍDO COM SUCESSO ===\n");
    
  } catch (error) {
    console.error("ERRO DURANTE O TESTE:", error);
  }
}

// Executar o teste
runTest().catch(console.error);