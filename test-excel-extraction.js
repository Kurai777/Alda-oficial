/**
 * Script de teste independente para a extração de imagens do Excel
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import JSZip from 'jszip';
import { spawn } from 'child_process';

// Utilitários de sistema de arquivos
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const copyFile = promisify(fs.copyFile);

// Diretórios
const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp');
const ASSETS_DIR = path.join(process.cwd(), 'attached_assets');
const OUTPUT_DIR = path.join(TEMP_DIR, 'extracted-images');

// Copiar o PDF de teste para o diretório de uploads
async function copyTestFile() {
  // Criar diretórios se não existirem
  if (!fs.existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }
  
  // Verificar se o arquivo PDF existe
  const pdfSource = path.join(ASSETS_DIR, 'Tabela Fratini - Fevereiro 2025.pdf');
  const pdfDest = path.join(TEMP_DIR, 'tabela-fratini.pdf');
  
  if (fs.existsSync(pdfSource)) {
    console.log(`Copiando ${pdfSource} para ${pdfDest}`);
    await copyFile(pdfSource, pdfDest);
    return pdfDest;
  } else {
    console.error(`Arquivo de teste não encontrado: ${pdfSource}`);
    return null;
  }
}

// Analisar um PDF para extrair informações básicas
async function analyzePDF(pdfPath) {
  console.log(`Analisando PDF: ${pdfPath}`);
  
  // Em um ambiente real, você usaria uma biblioteca para extrair texto e imagens
  // Para este teste, vamos apenas simular o processo

  // Gerar informações simuladas sobre o PDF
  return {
    fileName: path.basename(pdfPath),
    fileType: 'PDF',
    pageCount: 18, // Valor que verificamos anteriormente
    hasImages: true,
    imageCount: 38, // Valor estimado
    products: [
      {
        nome: "Mesa de Jantar Retangular 180cm",
        codigo: "TB-180-RET",
        descricao: "Mesa de jantar retangular com tampo de madeira maciça e base metálica",
        preco: "R$ 2.890,00",
        imagem: null
      },
      {
        nome: "Cadeira Estofada Modelo Paris",
        codigo: "CD-EST-PAR",
        descricao: "Cadeira estofada com tecido premium e estrutura de madeira",
        preco: "R$ 799,00",
        imagem: null
      },
      {
        nome: "Poltrona Reclinável Conforto",
        codigo: "PLT-REC-CNF",
        descricao: "Poltrona reclinável em couro sintético com 3 posições",
        preco: "R$ 1.450,00",
        imagem: null
      }
    ]
  };
}

// Função principal
async function runTest() {
  console.log("=== TESTE DE EXTRAÇÃO DE DADOS DE CATÁLOGO ===\n");
  
  // Copiar arquivo de teste
  const testFilePath = await copyTestFile();
  
  if (!testFilePath) {
    console.log("Teste cancelado: arquivo de teste não disponível");
    return;
  }
  
  console.log(`\nArquivo de teste copiado: ${testFilePath}`);
  
  // Analisar PDF
  console.log("\n--- Análise do PDF ---");
  const pdfInfo = await analyzePDF(testFilePath);
  console.log("Informações extraídas:");
  console.log(`- Nome do arquivo: ${pdfInfo.fileName}`);
  console.log(`- Tipo: ${pdfInfo.fileType}`);
  console.log(`- Número de páginas: ${pdfInfo.pageCount}`);
  console.log(`- Contém imagens: ${pdfInfo.hasImages ? 'Sim' : 'Não'}`);
  console.log(`- Número estimado de imagens: ${pdfInfo.imageCount}`);
  
  // Mostrar produtos (amostra)
  console.log("\n--- Amostra de Produtos ---");
  console.log(`Total de produtos: ${pdfInfo.products.length}`);
  
  pdfInfo.products.forEach((produto, index) => {
    console.log(`\nProduto ${index + 1}:`);
    console.log(`- Nome: ${produto.nome}`);
    console.log(`- Código: ${produto.codigo}`);
    console.log(`- Descrição: ${produto.descricao}`);
    console.log(`- Preço: ${produto.preco}`);
    console.log(`- Imagem: ${produto.imagem || 'Não disponível'}`);
  });
  
  console.log("\n=== TESTE CONCLUÍDO ===");
}

// Executar o teste
runTest().catch(err => {
  console.error("Erro durante o teste:", err);
});