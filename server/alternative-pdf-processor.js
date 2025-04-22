// alternative-pdf-processor.js
// Um processador alternativo para PDFs que não depende de pdf-img-convert
// Para ser usado como fallback durante o processo de deploy

import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

/**
 * Função alternativa para processar PDFs
 * Gera imagens representativas de cada página
 */
export async function generateImagesFromPdf(filePath, options = {}) {
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