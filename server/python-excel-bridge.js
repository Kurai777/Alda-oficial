/**
 * Módulo de integração entre JavaScript e Python para processamento avançado de Excel
 * 
 * Este módulo cria uma ponte para usar scripts Python avançados para extrair imagens
 * de arquivos Excel quando o método JavaScript não é suficiente.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { storage } from './firebase-admin.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

// Configuração de diretórios
const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp-excel-images');
const PYTHON_SCRIPTS_DIR = path.join(process.cwd(), 'server', 'python-scripts');

/**
 * Garante que os diretórios necessários existam
 */
async function ensureDirectories() {
  if (!fs.existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(PYTHON_SCRIPTS_DIR)) {
    await mkdir(PYTHON_SCRIPTS_DIR, { recursive: true });
  }
}

/**
 * Faz upload de uma imagem para o Firebase Storage
 * @param {string} imagePath Caminho local da imagem
 * @param {string} fileName Nome do arquivo para salvar no Firebase
 * @param {string} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<string>} URL da imagem
 */
async function uploadImageToFirebase(imagePath, fileName, userId, catalogId) {
  try {
    // Ler a imagem como buffer
    const imageBuffer = await readFile(imagePath);
    
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Buffer de imagem inválido');
    }
    
    // Criar caminho para o arquivo no Storage
    const storagePath = `products/${userId}/${catalogId}/${fileName}`;
    
    console.log(`Enviando imagem para Firebase: ${storagePath}`);
    
    // Obter referência ao bucket
    const bucket = storage.bucket();
    
    // Criar arquivo no bucket
    const file = bucket.file(storagePath);
    
    // Determinar o tipo de conteúdo baseado na extensão
    const extension = path.extname(fileName).toLowerCase().replace('.', '') || 'jpg';
    const contentType = `image/${extension}`;
    
    // Fazer upload do buffer
    await file.save(imageBuffer, {
      metadata: {
        contentType,
        metadata: {
          userId,
          catalogId,
          firebaseStorageDownloadTokens: Date.now()
        }
      },
      resumable: false,
      public: true
    });
    
    // Tornar o arquivo público
    await file.makePublic();
    
    // Gerar URL pública com formato do Firebase Storage
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "ald-a-8b969";
    const bucketName = `${projectId}.appspot.com`;
    const encodedPath = encodeURIComponent(storagePath);
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
    
    console.log(`URL de imagem gerada: ${imageUrl}`);
    
    return imageUrl;
  } catch (error) {
    console.error(`Erro ao fazer upload da imagem para Firebase: ${error.message}`);
    throw error;
  }
}

/**
 * Executa o script Python avançado para extrair imagens do Excel
 * @param {string} excelPath Caminho do arquivo Excel
 * @returns {Promise<Object>} Resultado da extração
 */
async function extractImagesWithPython(excelPath) {
  // Garantir que os diretórios existem
  await ensureDirectories();
  
  // Criar diretório de saída específico para esta extração
  const outputDir = path.join(TEMP_DIR, `extract_${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  
  // Caminho para o script Python
  const scriptPath = path.join(PYTHON_SCRIPTS_DIR, 'advanced_excel_extractor.py');
  
  console.log(`Executando script Python para extrair imagens de ${excelPath}`);
  console.log(`Saída em: ${outputDir}`);
  
  return new Promise((resolve, reject) => {
    // Verificar se o script Python existe
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script Python não encontrado: ${scriptPath}`));
    }
    
    // Executar o script Python
    const pythonProcess = spawn('python3', [
      scriptPath,
      excelPath,
      outputDir
    ]);
    
    let dataString = '';
    let errorString = '';
    
    // Capturar saída padrão
    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      dataString += chunk;
      console.log(`Python: ${chunk}`); // Log em tempo real
    });
    
    // Capturar saída de erro
    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorString += chunk;
      console.error(`Erro Python: ${chunk}`); // Log em tempo real de erros
    });
    
    // Processar quando o script terminar
    pythonProcess.on('close', (code) => {
      console.log(`Script Python finalizado com código: ${code}`);
      
      // Tentar extrair o JSON da saída
      try {
        // Encontrar a parte JSON na saída
        const jsonRegex = /{[\s\S]*}/;
        const match = dataString.match(jsonRegex);
        
        if (match) {
          const jsonResult = JSON.parse(match[0]);
          
          if (jsonResult.status === 'error') {
            console.error(`Erro retornado pelo Python: ${jsonResult.error}`);
            return reject(new Error(jsonResult.error));
          }
          
          // Construir resultado com base na saída do Python
          const result = {
            images: [],
            error: jsonResult.error,
            total_images: jsonResult.total_images,
            output_dir: jsonResult.output_dir
          };
          
          // Ler os arquivos base64 para montar o resultado completo
          const base64Dir = path.join(outputDir, 'base64');
          
          // Verificar se o diretório de base64 existe
          if (fs.existsSync(base64Dir)) {
            // Para cada imagem extraída, ler o arquivo base64 correspondente
            for (let i = 0; i < jsonResult.total_images; i++) {
              try {
                const imgInfo = jsonResult.images[i];
                const base64File = path.join(base64Dir, `image_${i}_base64.txt`);
                
                // Verificar se o arquivo base64 existe
                if (fs.existsSync(base64File)) {
                  // Ler o conteúdo do arquivo base64
                  const base64Content = fs.readFileSync(base64File, 'utf-8');
                  
                  // Adicionar ao resultado
                  result.images.push({
                    image_path: imgInfo.image_path,
                    image_filename: imgInfo.image_filename,
                    original_path: imgInfo.original_path,
                    image_base64: base64Content
                  });
                } else {
                  console.warn(`Arquivo base64 não encontrado: ${base64File}`);
                  
                  // Mesmo sem o base64, incluir a informação da imagem
                  result.images.push({
                    image_path: imgInfo.image_path,
                    image_filename: imgInfo.image_filename,
                    original_path: imgInfo.original_path,
                    image_base64: '' // Sem base64
                  });
                }
              } catch (error) {
                console.error(`Erro ao processar imagem ${i}: ${error.message}`);
              }
            }
          } else {
            console.warn(`Diretório de base64 não encontrado: ${base64Dir}`);
            
            // Se não há arquivos base64, usar as informações básicas das imagens
            result.images = jsonResult.images.map(img => ({
              ...img,
              image_base64: '' // Sem base64
            }));
          }
          
          console.log(`Extração com Python completa: ${result.images.length} imagens`);
          resolve(result);
        } else {
          console.error('Não foi possível encontrar JSON na saída do Python');
          
          // Se não encontrou JSON, mas o código de saída é 0 (sucesso)
          if (code === 0 && errorString.trim() === '') {
            // Tentar procurar diretamente imagens no diretório de saída
            const extractedFiles = fs.readdirSync(outputDir)
              .filter(file => !file.endsWith('.txt') && !fs.statSync(path.join(outputDir, file)).isDirectory());
            
            console.log(`Encontrados ${extractedFiles.length} arquivos extraídos diretamente no diretório`);
            
            const result = {
              images: extractedFiles.map((file, index) => ({
                image_path: path.join(outputDir, file),
                image_filename: file,
                original_path: `extracted_${index}`,
                image_base64: '' // Sem base64
              })),
              error: null,
              total_images: extractedFiles.length,
              output_dir: outputDir
            };
            
            resolve(result);
          } else {
            reject(new Error(`Falha na execução do Python: ${errorString}`));
          }
        }
      } catch (error) {
        console.error('Erro ao analisar saída do Python:', error);
        reject(error);
      }
    });
  });
}

/**
 * Extrai imagens de um arquivo Excel usando Python e as associa aos produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {Array} products Lista de produtos
 * @param {string} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<Array>} Produtos com URLs de imagem
 */
export async function extractImagesWithPythonBridge(excelPath, products, userId, catalogId) {
  console.log(`Extraindo imagens com Python de: ${excelPath}`);
  
  try {
    // Obter imagens com o script Python
    const result = await extractImagesWithPython(excelPath);
    
    if (!result.images || result.images.length === 0) {
      console.log('Nenhuma imagem foi extraída pelo Python');
      return products;
    }
    
    console.log(`Python extraiu ${result.images.length} imagens do Excel`);
    
    // Filtrar produtos com código
    const productsWithCode = products.filter(p => p.code && p.code.toString().trim() !== '');
    
    if (productsWithCode.length === 0) {
      console.log('Nenhum produto com código para associar às imagens');
      return products;
    }
    
    // Mapa para armazenar URLs de imagens por código de produto
    const productImageMap = {};
    
    // Processar cada imagem
    for (let i = 0; i < result.images.length; i++) {
      const imageData = result.images[i];
      // Pode ser usando base64 ou caminho do arquivo
      const hasBase64 = imageData.image_base64 && imageData.image_base64.length > 0;
      
      // Nome do arquivo para exibição
      const imagePath = imageData.image_path;
      const imageFilename = imageData.image_filename;
      
      // Tentar associar a imagem a um produto
      let productCode = null;
      let product = null;
      
      // Estratégia 1: Correspondência pelo nome do arquivo
      const baseFilename = path.basename(imageFilename, path.extname(imageFilename))
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      
      for (const p of productsWithCode) {
        const normalizedCode = p.code.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        if (baseFilename.includes(normalizedCode) || normalizedCode.includes(baseFilename)) {
          product = p;
          productCode = p.code;
          console.log(`Imagem ${imageFilename} associada ao produto com código ${productCode}`);
          break;
        }
      }
      
      // Estratégia 2: Associação por índice
      if (!product && i < productsWithCode.length) {
        product = productsWithCode[i];
        productCode = product.code;
        console.log(`Imagem ${imageFilename} associada ao produto ${productCode} por índice`);
      }
      
      // Se ainda não encontrou, atribuir código temporário
      if (!productCode) {
        productCode = `img_${i + 1}`;
        console.log(`Nenhum produto associado à imagem ${imageFilename}, usando código temporário ${productCode}`);
      }
      
      try {
        // Criar nome de arquivo seguro
        const safeFilename = `${productCode.toString().replace(/[^a-zA-Z0-9]/g, '_')}${path.extname(imageFilename)}`;
        
        let imageUrl;
        
        // Upload para o Firebase
        if (hasBase64) {
          // Criar arquivo temporário com os dados base64
          const tempPath = path.join(TEMP_DIR, `temp_${Date.now()}_${safeFilename}`);
          const imageBuffer = Buffer.from(imageData.image_base64, 'base64');
          await writeFile(tempPath, imageBuffer);
          
          // Upload do arquivo temporário
          imageUrl = await uploadImageToFirebase(tempPath, safeFilename, userId, catalogId);
          
          // Remover arquivo temporário
          fs.unlinkSync(tempPath);
        } else {
          // Upload do arquivo extraído
          imageUrl = await uploadImageToFirebase(imagePath, safeFilename, userId, catalogId);
        }
        
        console.log(`Imagem ${safeFilename} enviada para Firebase: ${imageUrl}`);
        
        // Adicionar ao mapa
        if (!productImageMap[productCode]) {
          productImageMap[productCode] = [];
        }
        productImageMap[productCode].push(imageUrl);
      } catch (uploadError) {
        console.error(`Erro ao fazer upload da imagem ${imageFilename}:`, uploadError);
      }
    }
    
    // Atualizar produtos com URLs de imagem
    const productsWithImages = products.map(product => {
      if (product.code && productImageMap[product.code]) {
        const images = productImageMap[product.code];
        
        // Atribuir imagem principal
        product.imageUrl = images[0];
        
        // Se houver mais imagens, adicionar como imagens adicionais
        if (images.length > 1) {
          product.additionalImages = images.slice(1);
        }
      }
      
      return product;
    });
    
    // Contar quantos produtos foram atualizados
    const updatedCount = productsWithImages.filter(p => p.imageUrl).length;
    console.log(`${updatedCount} de ${products.length} produtos atualizados com URLs de imagem`);
    
    return productsWithImages;
  } catch (error) {
    console.error(`Erro ao extrair imagens com Python: ${error.message}`);
    return products; // Retornar produtos sem alteração em caso de erro
  }
}

/**
 * Verifica se um arquivo Excel contém imagens (usando Python)
 * @param {string} excelPath Caminho do arquivo Excel
 * @returns {Promise<boolean>} True se contém imagens
 */
export async function hasExcelImagesWithPython(excelPath) {
  try {
    const result = await extractImagesWithPython(excelPath);
    return result.images && result.images.length > 0;
  } catch (error) {
    console.error(`Erro ao verificar imagens com Python: ${error.message}`);
    return false;
  }
}

export default {
  extractImagesWithPythonBridge,
  hasExcelImagesWithPython
};