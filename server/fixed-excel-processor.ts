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
  // Adicionar campo para armazenar caminho local da imagem
  imagePath?: string;
  // Adicionar campo para armazenar dados binários da imagem (se necessário)
  imageData?: Buffer;
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
    
    // NOVO MÉTODO: Tentar usar o extrator direto que salva imagens localmente
    try {
      console.log(`Tentando usar método direto de extração de imagens para ${filePath}`);
      const { processExcelDirectly } = require('./direct-excel-extractor');
      
      // Processar utilizando o método direto
      const directProducts = await processExcelDirectly(
        filePath, 
        String(userId || 'unknown'), 
        String(catalogId || 'unknown')
      );
      
      console.log(`Método direto extraiu ${directProducts.length} produtos com imagens locais`);
      
      // Adicionar campos necessários
      const processedProducts = directProducts.map(product => ({
        nome: product.nome,
        local: product.local || '',
        fornecedor: product.fornecedor || '',
        codigo: product.codigo || '',
        descricao: product.descricao || '',
        preco: product.preco || 0,
        imageUrl: product.imageUrl || undefined,
        userId,
        catalogId,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
      
      return processedProducts;
    } catch (directError) {
      // Se o método direto falhar, registrar erro e continuar com método antigo
      console.error('Método direto falhou, usando fallback:', directError);
    }
    
    // MÉTODO ANTIGO: Fallback para o método original
    console.log('Usando método antigo de extração de imagens...');
    
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
  
  // Criar diretório para salvar imagens localmente
  const localImageDir = path.join(process.cwd(), 'uploads', 'extracted_images');
  if (!fs.existsSync(localImageDir)) {
    await mkdir(localImageDir, { recursive: true });
  }
  
  // Criar um subdiretório para este catálogo específico
  const catalogDir = path.join(localImageDir, `catalog-${catalogId}`);
  if (!fs.existsSync(catalogDir)) {
    await mkdir(catalogDir, { recursive: true });
  }
  
  console.log(`Processando ${images.length} imagens extraídas do Excel...`);
  
  // Para cada produto, verificar se tem imagem associada
  for (const product of products) {
    const codigo = product.codigo;
    
    // Log para debug
    console.log(`Processando produto: ${codigo} - ${product.nome}`);
    
    // Se o produto já tem imagem em base64, converter para URL do Firebase
    if (product.imagem && product.imagem.startsWith('data:image/')) {
      try {
        // Extrair base64 da string data URL
        const base64Data = product.imagem.split(',')[1];
        
        // Nome do arquivo para o Firebase Storage
        const fileName = `${codigo}.png`;
        
        // Salvar também localmente
        const localPath = path.join(catalogDir, fileName);
        fs.writeFileSync(localPath, Buffer.from(base64Data, 'base64'));
        
        // Registrar o caminho local
        product.imagePath = localPath;
        
        // Salvar no Firebase Storage
        try {
          const imageUrl = await saveImageToFirebaseStorage(
            base64Data,
            fileName,
            String(userId || 'unknown'),
            String(catalogId || 'unknown')
          );
          
          // Atualizar URL da imagem no produto
          product.imageUrl = imageUrl;
          
          console.log(`Imagem para produto ${codigo} enviada para Firebase: ${imageUrl}`);
        } catch (fbError) {
          console.error(`Erro ao salvar no Firebase, usando caminho local: ${localPath}`, fbError);
          // Se falhar no Firebase, usar caminho local relativo como URL
          product.imageUrl = `/uploads/extracted_images/catalog-${catalogId}/${fileName}`;
        }
        
      } catch (error) {
        console.error(`Erro ao processar imagem para produto ${codigo}:`, error);
      }
    }
    // Se não tem imagem mas existe no mapa de imagens extraídas
    else if (imagesByCode[codigo]) {
      try {
        const img = imagesByCode[codigo];
        
        // Nome do arquivo para o Firebase Storage
        const fileName = img.filename || `${codigo}.png`;
        
        // Salvar também localmente
        const localPath = path.join(catalogDir, fileName);
        fs.writeFileSync(localPath, Buffer.from(img.base64, 'base64'));
        
        // Registrar o caminho local
        product.imagePath = localPath;
        
        // Salvar no Firebase Storage
        try {
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
        } catch (fbError) {
          console.error(`Erro ao salvar no Firebase, usando caminho local: ${localPath}`, fbError);
          // Se falhar no Firebase, usar caminho local relativo como URL
          product.imageUrl = `/uploads/extracted_images/catalog-${catalogId}/${fileName}`;
        }
        
      } catch (error) {
        console.error(`Erro ao processar imagem para produto ${codigo}:`, error);
      }
    } else {
      console.log(`Produto ${codigo} (${product.nome}) não tem imagem associada`);
    }
  }
  
  // Relatar estatísticas
  const productsWithImages = products.filter(p => p.imageUrl).length;
  console.log(`Processadas imagens para ${productsWithImages} de ${products.length} produtos (${Math.round(productsWithImages/products.length*100)}%)`);
}

export default {
  processExcelWithFixedColumns
};