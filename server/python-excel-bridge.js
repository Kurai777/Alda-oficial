/**
 * Ponte para scripts Python de processamento de Excel
 * 
 * Este módulo serve como interface para a execução de scripts Python relacionados
 * ao processamento de arquivos Excel, especialmente para a extração de imagens.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * Executa um script Python com argumentos específicos
 * @param {string} scriptPath Caminho para o script Python
 * @param {string[]} args Argumentos para o script
 * @returns {Promise<object>} Resultado em formato JSON
 */
export async function runPythonScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    // Verificar se o script existe
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script Python não encontrado: ${scriptPath}`));
    }
    
    console.log(`Executando script Python: ${scriptPath}`);
    console.log(`Argumentos: ${args.join(' ')}`);
    
    // Executar o script Python
    const pythonProcess = spawn('python3', [scriptPath, ...args]);
    
    let stdoutData = '';
    let stderrData = '';
    
    // Capturar saída padrão
    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    // Capturar erros
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.log(`[Python Log] ${data.toString()}`);
    });
    
    // Quando o processo terminar
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python script exited with code ${code}`);
        console.error(`Error output: ${stderrData}`);
        
        // Tentar parsear qualquer saída JSON mesmo com erro
        try {
          const result = JSON.parse(stdoutData);
          return resolve(result);
        } catch (parseError) {
          return reject(new Error(`Falha no script Python (código ${code}): ${stderrData}`));
        }
      }
      
      try {
        // Parsear resultado JSON
        const result = JSON.parse(stdoutData);
        resolve(result);
      } catch (error) {
        reject(new Error(`Erro ao parsear resultado do script Python: ${error.message}. Saída: ${stdoutData.substring(0, 200)}...`));
      }
    });
    
    // Em caso de erro no processo
    pythonProcess.on('error', (error) => {
      reject(new Error(`Erro ao executar script Python: ${error.message}`));
    });
  });
}

/**
 * Extrai imagens de um arquivo Excel usando script Python
 * @param {string} excelPath Caminho para o arquivo Excel
 * @returns {Promise<object>} Resultado da extração
 */
export async function extractExcelImagesWithPython(excelPath) {
  try {
    // Criar diretório para saída de imagens
    const outputDir = path.join(process.cwd(), 'uploads', 'excel_images', `excel_${Date.now()}`);
    await mkdir(outputDir, { recursive: true });
    
    // Caminho para o script Python
    const scriptPath = path.join(process.cwd(), 'server', 'python-scripts', 'advanced_excel_extractor.py');
    
    // Executar script
    const result = await runPythonScript(scriptPath, [excelPath, outputDir]);
    
    // Adicionar caminho de saída ao resultado
    result.outputDir = outputDir;
    
    return result;
  } catch (error) {
    console.error(`Erro ao extrair imagens com Python: ${error.message}`);
    throw error;
  }
}

/**
 * Associa imagens extraídas aos produtos no Excel
 * @param {string} excelPath Caminho para o arquivo Excel
 * @param {object} extractionResult Resultado da extração de imagens
 * @returns {Promise<object>} Resultado da associação
 */
export async function associateImagesWithProducts(excelPath, extractionResult) {
  try {
    // Verificar se temos imagens para associar
    if (!extractionResult.images || extractionResult.images.length === 0) {
      return { associations: [] };
    }
    
    // Criar um arquivo temporário para armazenar o resultado da extração
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    await mkdir(tempDir, { recursive: true });
    
    const tempFile = path.join(tempDir, `extraction_${Date.now()}.json`);
    await writeFile(tempFile, JSON.stringify(extractionResult));
    
    // Caminho para o script Python
    const scriptPath = path.join(process.cwd(), 'server', 'python-scripts', 'advanced_excel_extractor.py');
    
    // Executar script com parâmetros adicionais para modo de associação
    const result = await runPythonScript(scriptPath, [
      excelPath, 
      extractionResult.outputDir || path.join(process.cwd(), 'uploads', 'excel_images'), 
      '--associate', 
      tempFile
    ]);
    
    return result;
  } catch (error) {
    console.error(`Erro ao associar imagens: ${error.message}`);
    return { associations: [], error: error.message };
  }
}

/**
 * Extrai imagens com Python e as associa aos produtos em uma única função
 * @param {string} excelPath Caminho para o arquivo Excel  
 * @param {Array} products Lista de produtos para associar imagens
 * @param {string|number} userId ID do usuário para associar ao upload
 * @param {string|number} catalogId ID do catálogo para associar ao upload
 * @returns {Promise<Array>} Lista de produtos atualizada com imagens
 */
export async function extractImagesWithPythonBridge(excelPath, products, userId, catalogId) {
  try {
    // Primeiro extrair as imagens
    const extractionResult = await extractExcelImagesWithPython(excelPath);
    
    if (!extractionResult || !extractionResult.images || extractionResult.images.length === 0) {
      console.log('Nenhuma imagem encontrada pelo Python');
      return products;
    }
    
    console.log(`Python extraiu ${extractionResult.images.length} imagens do Excel`);
    
    // Associar imagens a produtos
    const associationResult = await associateImagesWithProducts(excelPath, extractionResult);
    
    if (!associationResult || !associationResult.associations || associationResult.associations.length === 0) {
      console.log('Nenhuma imagem associada a produtos pelo Python');
      return products;
    }
    
    console.log(`Python associou ${associationResult.associations.length} imagens a produtos`);
    
    // Criar uma cópia dos produtos para atualizar
    const updatedProducts = [...products];
    
    // Para cada associação, atualizar o produto correspondente
    for (const assoc of associationResult.associations) {
      if (assoc.codigo && assoc.confidence > 0.3) {
        // Buscar o produto pelo código
        const productIndex = updatedProducts.findIndex(p => 
          p.code === assoc.codigo || 
          p.codigo === assoc.codigo
        );
        
        if (productIndex !== -1) {
          // Caminho da imagem
          const imagePath = path.join(extractionResult.outputDir, assoc.image);
          
          // Se pudéssemos fazer upload no Firebase, usaríamos a URL do Firebase
          // Por enquanto, usamos diretamente o caminho da imagem
          updatedProducts[productIndex].imageUrl = `file://${imagePath}`;
          updatedProducts[productIndex].imageSource = 'python';
          updatedProducts[productIndex].imageConfidence = assoc.confidence;
        }
      }
    }
    
    return updatedProducts;
  } catch (error) {
    console.error('Erro na extração de imagens com Python:', error);
    return products;
  }
}

// Função para verificar se um Excel contém imagens usando Python
export async function hasExcelImagesWithPython(excelPath) {
  try {
    const result = await extractExcelImagesWithPython(excelPath);
    return result && result.images && result.images.length > 0;
  } catch (error) {
    console.error('Erro ao verificar imagens com Python:', error);
    return false;
  }
}

export default {
  runPythonScript,
  extractExcelImagesWithPython,
  associateImagesWithProducts,
  extractImagesWithPythonBridge,
  hasExcelImagesWithPython
};