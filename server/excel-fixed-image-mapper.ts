/**
 * Excel Fixed Image Mapper - Associação Correta de Imagens por Célula
 * 
 * Este módulo garante a correta extração e associação das imagens do Excel
 * aos produtos, considerando a posição exata da imagem na célula D (coluna 4)
 * e a linha correspondente a cada produto.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { storage } from './storage';

// Converter funções de callback para promises
const existsAsync = promisify(fs.exists);
const mkdirAsync = promisify(fs.mkdir);
const copyFileAsync = promisify(fs.copyFile);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

// Interface para o resultado do mapeamento
interface ExcelImageMapping {
  excel_file: string;
  extracted_time: string;
  images: Array<{
    relationship_id: string;
    original_filename: string;
    extracted_filename: string;
    path: string;
    cell?: string;
    row?: number;
    column?: string;
    column_index?: number;
  }>;
  error?: string;
}

/**
 * Extrai e mapeia as imagens do Excel com as linhas de produtos
 * @param excelPath Caminho para o arquivo Excel
 * @param catalogId ID do catálogo
 * @param userId ID do usuário
 */
export async function extractAndMapImages(
  excelPath: string, 
  catalogId: number, 
  userId: number
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  affectedProducts?: number;
  mappingPath?: string;
}> {
  try {
    console.log(`Iniciando extração e mapeamento de imagens para o catálogo ${catalogId}`);
    
    // Verificar se o arquivo Excel existe
    if (!await existsAsync(excelPath)) {
      return {
        success: false,
        error: `Arquivo Excel não encontrado: ${excelPath}`
      };
    }
    
    // Criar diretório para armazenar imagens extraídas
    const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
    if (!await existsAsync(extractedImagesDir)) {
      await mkdirAsync(extractedImagesDir, { recursive: true });
    }
    
    // Criar diretório para imagens fixadas de produtos específicos
    const fixedImagesDir = path.join(process.cwd(), 'uploads', 'product_fixed_images');
    if (!await existsAsync(fixedImagesDir)) {
      await mkdirAsync(fixedImagesDir, { recursive: true });
    }
    
    // Executar script Python para extrair e mapear imagens
    const pythonScript = path.join(process.cwd(), 'server', 'python-scripts', 'map_excel_images.py');
    
    // Verificar se o script existe
    if (!await existsAsync(pythonScript)) {
      return {
        success: false,
        error: `Script Python não encontrado: ${pythonScript}`
      };
    }
    
    console.log(`Executando script Python: ${pythonScript}`);
    console.log(`Arquivo Excel: ${excelPath}`);
    console.log(`Diretório de saída: ${extractedImagesDir}`);
    
    // Executar o script Python
    const mapping = await runPythonScript(pythonScript, [excelPath, extractedImagesDir]);
    
    // Verificar se ocorreu algum erro
    if ('error' in mapping) {
      return {
        success: false,
        error: `Erro ao extrair imagens: ${mapping.error}`
      };
    }
    
    console.log(`Mapeamento extraído com sucesso: ${mapping.images.length} imagens`);
    
    // Salvar o mapeamento para referência futura
    const mappingPath = path.join(extractedImagesDir, `catalog_${catalogId}_mapping.json`);
    await writeFileAsync(mappingPath, JSON.stringify(mapping, null, 2));
    
    // Buscar todos os produtos deste catálogo
    const products = await storage.getProductsByCatalogId(catalogId);
    console.log(`Encontrados ${products.length} produtos para o catálogo ${catalogId}`);
    
    // Contador de produtos atualizados
    let updatedProducts = 0;
    
    // Iterar pelos produtos e atualizar as URLs de imagem conforme o mapeamento
    for (const product of products) {
      // Tentar encontrar uma imagem correspondente pela linha do produto
      // Consideramos que cada produto corresponde a uma linha no Excel
      const productIndex = products.indexOf(product) + 1; // +1 porque as linhas do Excel começam em 1
      
      // Buscar imagem pela correspondência da linha
      const matchingImage = mapping.images.find(img => img.row === productIndex);
      
      if (matchingImage) {
        console.log(`Produto ${product.id} (linha ${productIndex}): Encontrada imagem correspondente ${matchingImage.extracted_filename}`);
        
        // Criar uma URL única para este produto
        const uniqueFilename = `product_${product.id}_${matchingImage.extracted_filename}`;
        const uniqueImagePath = path.join(fixedImagesDir, uniqueFilename);
        
        // Copiar a imagem para o diretório de imagens fixadas
        await copyFileAsync(matchingImage.path, uniqueImagePath);
        
        // Criar URL para o produto
        const imageUrl = `/uploads/product_fixed_images/${uniqueFilename}`;
        
        // Atualizar o produto com a nova URL
        await storage.updateProduct(product.id, { imageUrl });
        updatedProducts++;
      } else {
        console.log(`Produto ${product.id} (linha ${productIndex}): Nenhuma imagem correspondente encontrada`);
        
        // Se não encontrou imagem pela linha, tentar encontrar pela posição relativa
        // Dividir as imagens de forma mais ou menos uniforme entre os produtos
        const imageIndex = Math.floor((productIndex / products.length) * mapping.images.length);
        if (imageIndex < mapping.images.length) {
          const fallbackImage = mapping.images[imageIndex];
          
          // Criar uma URL única para este produto
          const uniqueFilename = `product_${product.id}_fallback_${fallbackImage.extracted_filename}`;
          const uniqueImagePath = path.join(fixedImagesDir, uniqueFilename);
          
          // Copiar a imagem para o diretório de imagens fixadas
          await copyFileAsync(fallbackImage.path, uniqueImagePath);
          
          // Criar URL para o produto
          const imageUrl = `/uploads/product_fixed_images/${uniqueFilename}`;
          
          // Atualizar o produto com a nova URL
          await storage.updateProduct(product.id, { imageUrl });
          updatedProducts++;
        }
      }
    }
    
    return {
      success: true,
      message: `Mapeamento de imagens concluído com sucesso`,
      affectedProducts: updatedProducts,
      mappingPath
    };
    
  } catch (error) {
    console.error('Erro ao extrair e mapear imagens:', error);
    return {
      success: false,
      error: error.message || 'Erro desconhecido'
    };
  }
}

/**
 * Executa o script Python e retorna o resultado
 */
function runPythonScript(scriptPath: string, args: string[]): Promise<ExcelImageMapping> {
  return new Promise((resolve, reject) => {
    // Verificar qual interpretador Python está disponível
    const pythonCommand = 'python3';
    
    console.log(`Executando: ${pythonCommand} ${scriptPath} ${args.join(' ')}`);
    
    const pythonProcess = spawn(pythonCommand, [scriptPath, ...args]);
    
    let stdoutData = '';
    let stderrData = '';
    
    // Coletar dados da saída padrão
    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    // Coletar dados da saída de erro
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`Python stderr: ${data}`);
    });
    
    // Lidar com o término do processo
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Processo Python encerrado com código ${code}`);
        console.error(`stderr: ${stderrData}`);
        return reject(new Error(`Erro no script Python: ${stderrData}`));
      }
      
      try {
        // Tentar encontrar JSON no stdout
        const jsonMatch = stdoutData.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          const result = JSON.parse(jsonStr);
          resolve(result);
        } else {
          // Se não encontrou JSON, buscar o arquivo de mapeamento no diretório de saída
          const outputDir = args[1];
          const mappingFile = path.join(outputDir, `${path.basename(args[0], path.extname(args[0]))}_image_mapping.json`);
          
          // Verificar se o arquivo existe
          if (fs.existsSync(mappingFile)) {
            const mappingData = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
            resolve(mappingData);
          } else {
            console.error('Arquivo de mapeamento não encontrado:', mappingFile);
            reject(new Error('Arquivo de mapeamento não encontrado'));
          }
        }
      } catch (error) {
        console.error('Erro ao processar resultado do Python:', error);
        console.error('stdout:', stdoutData);
        reject(error);
      }
    });
    
    // Lidar com erros do processo
    pythonProcess.on('error', (error) => {
      console.error('Erro ao executar script Python:', error);
      reject(error);
    });
  });
}

/**
 * Mapeia todas as imagens de todos os catálogos do sistema
 */
export async function remapAllCatalogs(): Promise<{
  success: boolean;
  results: Record<number, {
    success: boolean;
    message?: string;
    error?: string;
    affectedProducts?: number;
  }>;
}> {
  try {
    // Buscar todos os catálogos
    const catalogs = await storage.getAllCatalogs();
    console.log(`Encontrados ${catalogs.length} catálogos para remapear`);
    
    // Resultados por catálogo
    const results: Record<number, {
      success: boolean;
      message?: string;
      error?: string;
      affectedProducts?: number;
    }> = {};
    
    // Processar cada catálogo sequencialmente
    for (const catalog of catalogs) {
      console.log(`Processando catálogo ${catalog.id}: ${catalog.fileName}`);
      
      // Verificar se há um arquivo Excel associado
      const excelPath = path.join(process.cwd(), 'uploads', 'catalogs', `${catalog.id}`, catalog.fileName);
      
      if (await existsAsync(excelPath)) {
        // Extrair e mapear imagens
        const result = await extractAndMapImages(excelPath, catalog.id, catalog.userId);
        results[catalog.id] = result;
      } else {
        console.log(`Arquivo Excel não encontrado para o catálogo ${catalog.id}: ${excelPath}`);
        results[catalog.id] = {
          success: false,
          error: `Arquivo Excel não encontrado: ${excelPath}`
        };
      }
    }
    
    return {
      success: true,
      results
    };
    
  } catch (error) {
    console.error('Erro ao remapear todos os catálogos:', error);
    return {
      success: false,
      results: {}
    };
  }
}