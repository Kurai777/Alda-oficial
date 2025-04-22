import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';

const readFile = promisify(fs.readFile);

export interface ExtractedProduct {
  nome: string;
  descricao: string;
  codigo_comercial: string[];
  cores: string[];
  preco: string;
  imagem: string;
  page: number;
}

/**
 * Process a PDF file using OCR to extract product information
 * @param pdfPath Path to the PDF file
 * @returns Array of extracted products
 */
export async function processPdfWithOcr(pdfPath: string): Promise<ExtractedProduct[]> {
  try {
    console.log(`Iniciando processamento OCR do PDF: ${pdfPath}`);
    
    // Get the output JSON path
    const outputJsonPath = path.join(
      path.dirname(pdfPath),
      `${path.basename(pdfPath, '.pdf')}_products.json`
    );
    
    // Run the Python script as a child process
    const pythonProcess = spawn('python', [
      path.join(process.cwd(), 'server', 'pdf_ocr_processor.py'),
      pdfPath,
      outputJsonPath
    ]);
    
    // Log output from the Python script
    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python OCR output: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python OCR error: ${data}`);
    });
    
    // Wait for the Python process to complete
    await new Promise<void>((resolve, reject) => {
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`Python OCR process completed successfully`);
          resolve();
        } else {
          console.error(`Python OCR process exited with code ${code}`);
          reject(new Error(`Python OCR process exited with code ${code}`));
        }
      });
    });
    
    // Check if the output JSON file exists
    if (!fs.existsSync(outputJsonPath)) {
      throw new Error(`Output JSON file not found: ${outputJsonPath}`);
    }
    
    // Read the output JSON file
    const jsonContent = await readFile(outputJsonPath, 'utf-8');
    const products = JSON.parse(jsonContent) as ExtractedProduct[];
    
    console.log(`Extraídos ${products.length} produtos do PDF via OCR`);
    
    return products;
  } catch (error) {
    console.error('Erro ao processar PDF com OCR:', error);
    throw new Error(`Falha ao processar PDF com OCR: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

/**
 * Convert OCR-extracted products to the application's product format
 * @param products OCR-extracted products
 * @param userId User ID
 * @param catalogId Catalog ID
 * @returns Formatted products ready for storage
 */
export function convertOcrProductsToAppFormat(products: ExtractedProduct[], userId: number, catalogId: number) {
  return products.map(product => {
    // Convert price from "R$ XXX,XX" format to cents (integer)
    let priceInCents = 0;
    if (product.preco) {
      const priceMatch = product.preco.match(/R\$\s*(\d+[.,]?\d*)/);
      if (priceMatch) {
        const priceStr = priceMatch[1].replace(',', '.');
        priceInCents = Math.round(parseFloat(priceStr) * 100);
      }
    }
    
    return {
      userId,
      catalogId,
      name: product.nome || "Produto sem nome",
      description: product.descricao || "",
      code: product.codigo_comercial.length > 0 ? product.codigo_comercial[0] : `AUTO-${Math.floor(Math.random() * 10000)}`,
      price: priceInCents,
      category: determineProductCategory(product.nome),
      colors: product.cores,
      materials: extractMaterialsFromDescription(product.descricao),
      sizes: [],
      imageUrl: product.imagem || ""
    };
  });
}

