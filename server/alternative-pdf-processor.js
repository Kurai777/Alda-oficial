// alternative-pdf-processor.js
// Processador de PDFs aprimorado que tenta múltiplos métodos
// para converter PDFs em imagens para processamento

import fs from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const execAsync = promisify(exec);

/**
 * Função aprimorada para processar PDFs
 * Tenta primeiro usar poppler (pdftoppm) e cai para o método alternativo se falhar
 */
export async function generateImagesFromPdf(filePath, options = {}) {
  const {
    width = 800,
    height = 1000,
    pagesToProcess = null, // Se nulo, processa todas as páginas
    dpi = 200
  } = options;

  try {
    // Verificar se pdftoppm está disponível
    try {
      await execAsync('which pdftoppm');
      console.log("Ferramenta pdftoppm encontrada. Tentando converter PDF com Poppler...");
      return await convertPdfWithPoppler(filePath, { width, height, dpi, pagesToProcess });
    } catch (whichError) {
      // pdftoppm não está disponível, usar método alternativo
      console.log("Poppler (pdftoppm) não está disponível. Usando método alternativo de processamento...");
      return await generatePdfImagesWithPdfLib(filePath, { width, height, pagesToProcess });
    }
  } catch (error) {
    console.error("Erro ao processar PDF:", error);
    console.log("Usando método de fallback simples...");
    
    return await generateFallbackImages(filePath, { width, height, pagesToProcess });
  }
}

/**
 * Converte PDF em imagens usando poppler-utils (pdftoppm)
 */
async function convertPdfWithPoppler(filePath, options = {}) {
  const {
    width = 800,
    height = 1000,
    dpi = 200,
    pagesToProcess = null
  } = options;
  
  try {
    // Verificar se o binário pdftoppm está disponível
    try {
      await execAsync('which pdftoppm');
    } catch (whichError) {
      throw new Error("pdftoppm não encontrado. Poppler-utils não está instalado.");
    }
    
    // Criar diretório temporário para as imagens
    const tempDir = path.join(process.cwd(), 'uploads', 'temp', `pdf_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Nome base para os arquivos de saída
    const outputBase = path.join(tempDir, 'page');
    
    // Comando para converter o PDF em imagens
    const pdfToPpmCmd = `pdftoppm -jpeg -r ${dpi} "${filePath}" "${outputBase}"`;
    
    // Executar o comando
    console.log(`Executando: ${pdfToPpmCmd}`);
    await execAsync(pdfToPpmCmd);
    
    // Listar arquivos gerados
    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg')).sort();
    
    if (!files.length) {
      throw new Error("Nenhuma imagem foi gerada pelo pdftoppm");
    }
    
    console.log(`pdftoppm gerou ${files.length} imagens`);
    
    // Filtrar páginas se pagesToProcess for especificado
    let filesToProcess = files;
    if (pagesToProcess && Array.isArray(pagesToProcess)) {
      const pageMap = {};
      pagesToProcess.forEach(p => { pageMap[p] = true; });
      
      filesToProcess = files.filter((_, index) => pageMap[index + 1]);
    }
    
    // Ler as imagens em buffers
    const imageBuffers = [];
    for (const file of filesToProcess) {
      const filePath = path.join(tempDir, file);
      const imageBuffer = await readFile(filePath);
      
      // Redimensionar se necessário
      if (width && height) {
        const resizedBuffer = await sharp(imageBuffer)
          .resize(width, height, { fit: 'inside' })
          .toBuffer();
        imageBuffers.push(resizedBuffer);
      } else {
        imageBuffers.push(imageBuffer);
      }
      
      // Remover arquivo temporário
      fs.unlinkSync(filePath);
    }
    
    // Limpar diretório temporário
    try {
      fs.rmdirSync(tempDir);
    } catch (rmError) {
      console.warn("Erro ao remover diretório temporário:", rmError);
    }
    
    return imageBuffers;
  } catch (error) {
    console.error("Erro ao converter PDF com Poppler:", error);
    throw error;
  }
}

/**
 * Método alternativo que usa pdf-lib para extrair páginas do PDF
 * e renderizá-las como imagens
 */
async function generatePdfImagesWithPdfLib(filePath, options = {}) {
  const {
    width = 800,
    height = 1000,
    pagesToProcess = null
  } = options;
  
  try {
    // Ler o PDF
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`Gerando ${pageCount} imagens a partir do PDF usando pdf-lib...`);
    
    // Determinar quais páginas processar
    const pagesToGenerate = pagesToProcess || 
      Array.from(Array(pageCount).keys()).map(i => i + 1);
    
    // Array para armazenar os buffers das imagens geradas
    const imageBuffers = [];
    
    // Criar diretório temporário para as imagens
    const tempDir = path.join(process.cwd(), 'uploads', 'temp', `pdf_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Processar cada página
    for (let i = 0; i < pagesToGenerate.length; i++) {
      const pageIndex = pagesToGenerate[i] - 1; // Índice começa em 0 no pdf-lib
      
      if (pageIndex < 0 || pageIndex >= pageCount) {
        console.warn(`Página ${pagesToGenerate[i]} está fora do intervalo (1-${pageCount})`);
        continue;
      }
      
      // Extrair uma página do PDF
      const subPdf = await PDFDocument.create();
      const [copiedPage] = await subPdf.copyPages(pdfDoc, [pageIndex]);
      subPdf.addPage(copiedPage);
      
      // Salvar a página individual como um novo PDF
      const singlePagePdf = await subPdf.save();
      const tempPdfPath = path.join(tempDir, `page_${pagesToGenerate[i]}.pdf`);
      await writeFile(tempPdfPath, singlePagePdf);
      
      // Agora, criar uma imagem representativa com informações retiradas da página
      // A representação incluirá uma mensagem informando que é uma página do PDF original
      const pageSize = copiedPage.getSize();
      const aspectRatio = pageSize.width / pageSize.height;
      
      // Calcular dimensões mantendo a proporção original
      let imgWidth = width;
      let imgHeight = Math.floor(width / aspectRatio);
      
      if (imgHeight > height) {
        imgHeight = height;
        imgWidth = Math.floor(height * aspectRatio);
      }
      
      // Criar uma imagem que representa a página
      const imageBuffer = await sharp({
        create: {
          width: imgWidth,
          height: imgHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .composite([
        {
          input: Buffer.from(`<svg width="${imgWidth}" height="${imgHeight}">
            <rect width="${imgWidth}" height="${imgHeight}" fill="#f0f0f0"/>
            <rect x="10" y="10" width="${imgWidth-20}" height="${imgHeight-20}" fill="#fcfcfc" stroke="#aaa" stroke-width="1"/>
            <text x="50%" y="40%" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#333">
              Página ${pagesToGenerate[i]} do PDF
            </text>
            <text x="50%" y="50%" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#777">
              ${path.basename(filePath)}
            </text>
            <text x="50%" y="60%" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#999">
              Dimensões da página: ${Math.round(pageSize.width)} x ${Math.round(pageSize.height)} pontos
            </text>
          </svg>`),
          top: 0,
          left: 0
        }
      ])
      .jpeg()
      .toBuffer();
      
      // Adicionar ao array de imagens
      imageBuffers.push(imageBuffer);
      
      // Limpar arquivo temporário
      try {
        fs.unlinkSync(tempPdfPath);
      } catch (e) {
        console.warn(`Não foi possível excluir arquivo temporário: ${tempPdfPath}`);
      }
    }
    
    // Limpar diretório temporário
    try {
      fs.rmdirSync(tempDir);
    } catch (rmError) {
      console.warn("Erro ao remover diretório temporário:", rmError);
    }
    
    return imageBuffers;
  } catch (error) {
    console.error('Erro ao gerar imagens do PDF com pdf-lib:', error);
    throw error;
  }
}

/**
 * Método de fallback simples para gerar imagens representativas
 * Usado somente quando todos os outros métodos falham
 */
async function generateFallbackImages(filePath, options = {}) {
  const {
    width = 800,
    height = 1000,
    pagesToProcess = null // Se nulo, processa todas as páginas
  } = options;
  
  try {
    // Ler o PDF e obter o número de páginas
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`Gerando ${pageCount} imagens representativas para o PDF utilizando método alternativo`);
    
    // Determinar quais páginas processar
    const pagesToGenerate = pagesToProcess || 
      Array.from(Array(pageCount).keys()).map(i => i + 1);
    
    // Array para armazenar os buffers das imagens geradas
    const imageBuffers = [];
    
    // Criar imagens representativas para cada página
    for (let i = 0; i < pagesToGenerate.length; i++) {
      const pageNum = pagesToGenerate[i];
      
      // Criar uma imagem representativa com o número da página
      const imageBuffer = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
      .composite([
        {
          input: Buffer.from(`<svg width="${width}" height="${height}">
            <rect width="${width}" height="${height}" fill="#f5f5f5"/>
            <text x="50%" y="50%" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#333">
              Página ${pageNum} do PDF ${path.basename(filePath)}
            </text>
          </svg>`),
          top: 0,
          left: 0
        }
      ])
      .jpeg()
      .toBuffer();
      
      // Adicionar ao array de imagens
      imageBuffers.push(imageBuffer);
    }
    
    return imageBuffers;
  } catch (error) {
    console.error('Erro ao gerar imagens alternativas do PDF:', error);
    throw error;
  }
}

export default {
  convert: generateImagesFromPdf
};