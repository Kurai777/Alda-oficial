/**
 * Processador de Excel com mapeamento de colunas fixas
 * 
 * Este processador implementa uma estrutura fixa de colunas:
 * A (1): nome do produto (ex: "Sofá Home")
 * B (2): local (ex: "2º Piso", "Depósito")
 * C (3): fornecedor
 * D (4): imagem (objeto gráfico)
 * F (6): código do produto
 * G (7): descrição
 * L (12): valor total (preço do produto)
 */

import * as path from 'path';
import * as fs from 'fs';
import { mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import { saveImageToFirebaseStorage } from './firebase-admin';

interface ProcessedProduct {
  nome: string;
  local: string;
  fornecedor: string;
  codigo: string;
  descricao: string;
  quantidade?: number;
  preco: string;
  imagem?: string;
  imageUrl?: string;
  catalogId?: string | number;
  userId?: string | number;
  isEdited?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Processa um arquivo Excel com mapeamento de colunas fixas
 * 
 * @param filePath Caminho para o arquivo Excel
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Array de produtos processados
 */
export async function processExcelWithFixedColumns(
  filePath: string,
  userId?: string | number,
  catalogId?: string | number
): Promise<ProcessedProduct[]> {
  try {
    console.log(`Processando Excel com colunas fixas: ${filePath}`);
    
    // Criar diretório para imagens extraídas
    const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
    if (!fs.existsSync(extractedImagesDir)) {
      await mkdir(extractedImagesDir, { recursive: true });
    }
    
    // Executar script Python para extração com colunas fixas
    const result = await runPythonExcelProcessor(filePath, extractedImagesDir);
    
    // Processar produtos extraídos
    let products = result.products || [];
    
    // Adicionar ID do usuário e ID do catálogo aos produtos
    products = products.map(product => ({
      ...product,
      userId,
      catalogId,
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    // Extrair imagens para o Firebase Storage
    if (result.images && result.images.length > 0) {
      console.log(`Encontradas ${result.images.length} imagens no Excel. Enviando para o Firebase Storage...`);
      
      try {
        await processExcelImagesForFirebase(result.images, products, userId, catalogId);
      } catch (imageError) {
        console.error("Erro ao processar imagens para Firebase:", imageError);
      }
    }
    
    console.log(`Processados ${products.length} produtos do Excel com colunas fixas`);
    return products;
    
  } catch (error) {
    console.error("Erro ao processar Excel com colunas fixas:", error);
    throw new Error(`Falha ao processar Excel: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

/**
 * Executa o script Python para processar o Excel
 * 
 * @param filePath Caminho para o arquivo Excel
 * @param outputDir Diretório de saída para imagens
 * @returns Resultado do processamento
 */
async function runPythonExcelProcessor(filePath: string, outputDir: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // Caminho para o script Python
    const pythonScript = path.join(process.cwd(), 'server', 'python-scripts', 'excel_fixed_columns.py');
    
    console.log(`Executando script Python: ${pythonScript}`);
    console.log(`Arquivo Excel: ${filePath}`);
    console.log(`Diretório de saída: ${outputDir}`);
    
    // Verificar se o script Python existe
    if (!fs.existsSync(pythonScript)) {
      return reject(new Error(`Script Python não encontrado: ${pythonScript}`));
    }
    
    // Executar script Python
    const pythonProcess = spawn('python3', [pythonScript, filePath, outputDir]);
    
    let stdoutData = '';
    let stderrData = '';
    
    // Capturar saída padrão
    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    // Capturar saída de erro
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`Erro no script Python: ${data.toString()}`);
    });
    
    // Quando o processo terminar
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python script exited with code ${code}: ${stderrData}`));
      }
      
      try {
        // Parsear resultado JSON
        const result = JSON.parse(stdoutData);
        resolve(result);
      } catch (error) {
        reject(new Error(`Erro ao parsear resultado do script Python: ${error}`));
      }
    });
    
    // Em caso de erro no processo
    pythonProcess.on('error', (error) => {
      reject(new Error(`Erro ao executar script Python: ${error.message}`));
    });
  });
}

/**
 * Processa imagens extraídas do Excel para o Firebase Storage
 * 
 * @param images Imagens extraídas
 * @param products Produtos associados
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 */
async function processExcelImagesForFirebase(
  images: any[],
  products: ProcessedProduct[],
  userId?: string | number,
  catalogId?: string | number
): Promise<void> {
  // Mapear imagens por código
  const imagesByCode: Record<string, any> = {};
  images.forEach(img => {
    imagesByCode[img.codigo] = img;
  });
  
  // Para cada produto, verificar se tem imagem associada
  for (const product of products) {
    const codigo = product.codigo;
    
    // Se o produto já tem imagem em base64, converter para URL do Firebase
    if (product.imagem && product.imagem.startsWith('data:image/')) {
      try {
        // Extrair base64 da string data URL
        const base64Data = product.imagem.split(',')[1];
        
        // Nome do arquivo para o Firebase Storage
        const fileName = `${codigo}.png`;
        
        // Salvar no Firebase Storage
        const imageUrl = await saveImageToFirebaseStorage(
          base64Data,
          fileName,
          String(userId || 'unknown'),
          String(catalogId || 'unknown')
        );
        
        // Atualizar URL da imagem no produto
        product.imageUrl = imageUrl;
        
        console.log(`Imagem para produto ${codigo} enviada para Firebase: ${imageUrl}`);
        
      } catch (error) {
        console.error(`Erro ao salvar imagem para produto ${codigo}:`, error);
      }
    }
    // Se não tem imagem mas existe no mapa de imagens extraídas
    else if (imagesByCode[codigo]) {
      try {
        const img = imagesByCode[codigo];
        
        // Nome do arquivo para o Firebase Storage
        const fileName = img.filename || `${codigo}.png`;
        
        // Salvar no Firebase Storage
        const imageUrl = await saveImageToFirebaseStorage(
          img.base64,
          fileName,
          String(userId || 'unknown'),
          String(catalogId || 'unknown')
        );
        
        // Atualizar URL da imagem no produto
        product.imageUrl = imageUrl;
        product.imagem = `data:image/png;base64,${img.base64}`;
        
        console.log(`Imagem para produto ${codigo} enviada para Firebase: ${imageUrl}`);
        
      } catch (error) {
        console.error(`Erro ao salvar imagem para produto ${codigo}:`, error);
      }
    }
  }
}

export default {
  processExcelWithFixedColumns
};