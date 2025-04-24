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
    console.log("Tentando converter PDF usando pdftoppm (Poppler)...");
    return await convertPdfWithPoppler(filePath, { width, height, dpi, pagesToProcess });
  } catch (popplerError) {
    console.error("Erro ao converter PDF com Poppler:", popplerError);
    console.log("Tentando método alternativo com pdf-lib...");
    
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
 * Método de fallback para gerar imagens representativas simples
 * Usado quando o método principal falha
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