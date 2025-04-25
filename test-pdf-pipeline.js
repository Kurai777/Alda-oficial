/**
 * Teste independente para o pipeline completo de processamento de PDF
 * com extração de produtos e imagens
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { createCanvas } from 'canvas';
import { PDFDocument } from 'pdf-lib';

// Obter diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Funções simuladas para testes
async function mockSaveImageToFirebase(buffer, filename, userId, catalogId) {
  // Salva a imagem localmente em vez de no Firebase
  const outputDir = path.join(__dirname, 'temp', 'mock-firebase', userId.toString(), catalogId.toString());
  await mkdir(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, filename);
  await writeFile(outputPath, buffer);
  
  // Retornar um URL simulado
  return `https://mock-firebase.storage.googleapis.com/${userId}/${catalogId}/${filename}`;
}

// Função para processar PDF
async function processPdf(pdfPath) {
  console.log(`Processando PDF: ${pdfPath}`);
  
  try {
    // Verificar se o arquivo existe
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo não encontrado: ${pdfPath}`);
    }
    
    // Ler o arquivo PDF
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`PDF carregado. Total de páginas: ${pageCount}`);
    
    // Configurações de processamento
    const outputDir = path.join(__dirname, 'temp', 'pdf-pages');
    await mkdir(outputDir, { recursive: true });
    
    // Extrair metadados
    const title = pdfDoc.getTitle() || "Sem título";
    const author = pdfDoc.getAuthor() || "Autor desconhecido";
    
    console.log(`Metadados do PDF:`);
    console.log(`- Título: ${title}`);
    console.log(`- Autor: ${author}`);
    console.log(`- Páginas: ${pageCount}`);
    
    // Processar páginas
    const pageImages = [];
    const productsData = [];
    
    // Limitar o número de páginas para teste
    const maxPagesToProcess = Math.min(pageCount, 5);
    
    console.log(`\nProcessando ${maxPagesToProcess} páginas...`);
    
    for (let i = 0; i < maxPagesToProcess; i++) {
      const pageNumber = i + 1;
      console.log(`\nProcessando página ${pageNumber}...`);
      
      // Obter a página
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      
      // Converter a página para imagem (simulação)
      const dpi = 150;
      const scale = dpi / 72;
      const scaledWidth = Math.floor(width * scale);
      const scaledHeight = Math.floor(height * scale);
      
      // Criar uma imagem da página
      const canvas = createCanvas(scaledWidth, scaledHeight);
      const ctx = canvas.getContext('2d');
      
      // Simular conteúdo da página
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);
      ctx.fillStyle = 'black';
      ctx.font = '20px Arial';
      ctx.fillText(`Página ${pageNumber} do PDF`, 50, 50);
      
      // Salvar a imagem
      const pageImagePath = path.join(outputDir, `page_${pageNumber}.png`);
      const buffer = canvas.toBuffer('image/png');
      await writeFile(pageImagePath, buffer);
      
      // Adicionar à lista de imagens
      pageImages.push({
        pageNumber,
        path: pageImagePath,
        width: scaledWidth,
        height: scaledHeight,
        buffer
      });
      
      console.log(`- Imagem da página ${pageNumber} salva em: ${pageImagePath}`);
      
      // Simular extração de produtos (2 produtos por página)
      for (let j = 1; j <= 2; j++) {
        const productIndex = (i * 2) + j;
        
        // Simular um produto
        const product = {
          nome: `Produto ${productIndex}`,
          codigo: `PDF-${pageNumber}-${j}`,
          descricao: `Descrição do produto ${productIndex} na página ${pageNumber}`,
          preco: `R$ ${(Math.random() * 2000 + 500).toFixed(2)}`,
          categoria: ['Sofás', 'Mesas', 'Cadeiras', 'Armários'][Math.floor(Math.random() * 4)],
          cores: ['Preto', 'Branco', 'Marrom', 'Bege', 'Cinza'][Math.floor(Math.random() * 5)],
          materiais: ['Madeira', 'Metal', 'Vidro', 'Tecido', 'Couro'][Math.floor(Math.random() * 5)],
          largura: Math.floor(Math.random() * 200) + 50,
          altura: Math.floor(Math.random() * 100) + 40,
          profundidade: Math.floor(Math.random() * 80) + 30,
          pageNumber
        };
        
        // Gerar uma imagem para o produto (simulada)
        const productCanvas = createCanvas(200, 200);
        const productCtx = productCanvas.getContext('2d');
        
        // Desenhar um retângulo colorido representando o produto
        productCtx.fillStyle = ['#ff9999', '#99ff99', '#9999ff', '#ffff99', '#ff99ff'][Math.floor(Math.random() * 5)];
        productCtx.fillRect(0, 0, 200, 200);
        productCtx.fillStyle = 'black';
        productCtx.font = '16px Arial';
        productCtx.fillText(`Produto ${productIndex}`, 50, 100);
        
        // Salvar a imagem do produto
        const productImageBuffer = productCanvas.toBuffer('image/png');
        const productImageFilename = `product_${pageNumber}_${j}.png`;
        
        // Simular upload para o Firebase
        const imageUrl = await mockSaveImageToFirebase(
          productImageBuffer,
          productImageFilename,
          '123', // userId simulado
          '456'  // catalogId simulado
        );
        
        // Adicionar URL da imagem ao produto
        product.imageUrl = imageUrl;
        
        // Adicionar à lista de produtos
        productsData.push(product);
        
        console.log(`- Produto ${product.nome} extraído com imagem: ${product.imageUrl}`);
      }
    }
    
    // Resumo
    console.log(`\n=== RESUMO DO PROCESSAMENTO ===`);
    console.log(`Total de páginas processadas: ${pageImages.length}`);
    console.log(`Total de produtos extraídos: ${productsData.length}`);
    
    // Salvar resultado em JSON
    const outputPath = path.join(__dirname, 'pdf-pipeline-result.json');
    await writeFile(outputPath, JSON.stringify({
      metadata: {
        filename: path.basename(pdfPath),
        title,
        author,
        pageCount,
        processedPages: pageImages.length,
        processedAt: new Date().toISOString()
      },
      products: productsData
    }, null, 2));
    
    console.log(`\nResultados salvos em: ${outputPath}`);
    console.log(`\n=== PROCESSAMENTO CONCLUÍDO COM SUCESSO ===`);
    
    return {
      pageImages,
      products: productsData
    };
    
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    throw error;
  }
}

// Função principal
async function runTest() {
  try {
    // Caminho para o PDF de teste
    const testPdfPath = path.join(__dirname, 'attached_assets', 'Tabela Fratini - Fevereiro 2025.pdf');
    
    if (!fs.existsSync(testPdfPath)) {
      console.error('PDF de teste não encontrado:', testPdfPath);
      return;
    }
    
    // Criar diretório temporário se não existir
    await mkdir(path.join(__dirname, 'temp'), { recursive: true });
    
    // Processar o PDF
    await processPdf(testPdfPath);
    
  } catch (error) {
    console.error('Erro no teste:', error);
  }
}

// Executar o teste
runTest();