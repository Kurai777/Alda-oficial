/**
 * Utilitário para extrair imagens de arquivos Excel
 * 
 * Este módulo utiliza uma abordagem baseada em arquivo binário para extrair
 * imagens de arquivos Excel (.xlsx). Ele localiza e extrai as imagens contidas
 * nos arquivos e as associa aos códigos de produtos correspondentes.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { storage } from './firebase-admin.js';
import JSZip from 'jszip';

const execAsync = promisify(exec);

// Definir variáveis de controle para tratamento de imagens
const ENABLE_IMAGE_EXTRACTION = true;
const SAVE_TO_FIREBASE = true;
const SAVE_LOCALLY = true;
const LOCAL_IMAGE_PATH = './uploads/extracted_images';

/**
 * Extrai imagens de um arquivo Excel (.xlsx)
 * @param {string} filePath - Caminho para o arquivo Excel
 * @param {Array} products - Lista de produtos extraída do Excel para associar as imagens
 * @param {string} userId - ID do usuário para armazenamento Firebase
 * @returns {Object} - Mapa de código de produto para URL da imagem
 */
export async function extractImagesFromExcel(filePath, products, userId) {
  console.log(`Iniciando extração de imagens de: ${filePath}`);
  
  // Criar diretório local para armazenar imagens se não existir
  if (SAVE_LOCALLY && !fs.existsSync(LOCAL_IMAGE_PATH)) {
    fs.mkdirSync(LOCAL_IMAGE_PATH, { recursive: true });
  }
  
  // Mapa para armazenar associações de código de produto para URL da imagem
  const productImageMap = {};
  
  try {
    if (!ENABLE_IMAGE_EXTRACTION) {
      console.log('Extração de imagens desativada nas configurações');
      return productImageMap;
    }
    
    // Ler o arquivo Excel como um arquivo zip (o formato .xlsx é um arquivo zip)
    const excelData = fs.readFileSync(filePath);
    const zip = new JSZip();
    const zipContents = await zip.loadAsync(excelData);
    
    // Procurar por arquivos de imagem dentro da pasta 'xl/media'
    const mediaFolder = zipContents.folder('xl/media');
    
    if (!mediaFolder) {
      console.log('Nenhuma pasta de mídia encontrada no arquivo Excel');
      return productImageMap;
    }
    
    // Obter todos os arquivos de imagem da pasta media
    const imageFiles = Object.keys(mediaFolder.files)
      .filter(filename => !mediaFolder.files[filename].dir && 
        /\.(png|jpe?g|gif|tiff|bmp)$/i.test(filename));
    
    console.log(`Encontradas ${imageFiles.length} imagens no arquivo Excel`);
    
    // Criar mapa de índice para código de produto
    // Assumindo que a ordem das imagens corresponde à ordem dos produtos
    const productsByIndex = {};
    
    products.forEach((product, index) => {
      if (product.code) {
        productsByIndex[index] = product.code;
      }
    });
    
    // Extrair cada imagem e associá-la a um produto
    for (let i = 0; i < imageFiles.length; i++) {
      const imageFileName = imageFiles[i];
      const imageData = await mediaFolder.file(imageFileName).async('nodebuffer');
      
      // Tentar associar a imagem ao produto
      let productCode = productsByIndex[i];
      
      // Se não conseguirmos associar pelo índice, tentaremos usar o nome do arquivo
      if (!productCode) {
        // Procurar o código no nome do arquivo (alguns Excel salvam com nome relacionado)
        const baseFileName = path.basename(imageFileName, path.extname(imageFileName));
        
        // Procurar produto com código ou nome similar
        const matchedProduct = products.find(p => 
          p.code && (baseFileName.includes(p.code) || 
          (p.name && baseFileName.toLowerCase().includes(p.name.toLowerCase()))));
        
        if (matchedProduct) {
          productCode = matchedProduct.code;
        } else {
          // Se ainda não encontrou, use o índice da imagem como identificador temporário
          productCode = `image_${i + 1}`;
        }
      }
      
      // Gerar nome de arquivo baseado no código do produto
      const safeProductCode = productCode.replace(/[^a-zA-Z0-9]/g, '_');
      const imageFileNameExt = path.extname(imageFileName) || '.jpg';
      const outputImageName = `${safeProductCode}${imageFileNameExt}`;
      
      // Salvar localmente se configurado
      let localImagePath = null;
      if (SAVE_LOCALLY) {
        localImagePath = path.join(LOCAL_IMAGE_PATH, outputImageName);
        fs.writeFileSync(localImagePath, imageData);
        console.log(`Imagem salva localmente: ${localImagePath}`);
      }
      
      // Salvar no Firebase Storage se configurado
      if (SAVE_TO_FIREBASE) {
        try {
          const storageRef = storage.bucket();
          const imageRef = storageRef.file(`product_images/${userId}/${outputImageName}`);
          
          // Fazer upload da imagem para o Firebase Storage
          await imageRef.save(imageData, {
            metadata: {
              contentType: `image/${imageFileNameExt.replace('.', '')}`,
              metadata: {
                productCode,
                userId
              }
            }
          });
          
          // Obter URL pública da imagem
          const [url] = await imageRef.getSignedUrl({
            action: 'read',
            expires: '03-01-2500' // Data bem no futuro
          });
          
          console.log(`Imagem enviada para Firebase Storage: ${url}`);
          
          // Adicionar ao mapa de produtos
          productImageMap[productCode] = url;
          
        } catch (error) {
          console.error(`Erro ao salvar imagem no Firebase: ${error.message}`);
          
          // Se falhou salvar no Firebase, use o caminho local
          if (localImagePath) {
            // Converter para URL relativa do servidor
            const relativeUrl = localImagePath.replace('./', '/');
            productImageMap[productCode] = relativeUrl;
          }
        }
      } else if (localImagePath) {
        // Se não salvou no Firebase, use o caminho local
        const relativeUrl = localImagePath.replace('./', '/');
        productImageMap[productCode] = relativeUrl;
      }
    }
    
    console.log(`Processamento de imagens concluído. ${Object.keys(productImageMap).length} imagens extraídas e associadas.`);
    
    // Atualizar os produtos com as URLs das imagens
    for (const product of products) {
      if (product.code && productImageMap[product.code]) {
        product.imageUrl = productImageMap[product.code];
        console.log(`Produto ${product.code} atualizado com imagem: ${product.imageUrl}`);
      }
    }
    
  } catch (error) {
    console.error(`Erro ao extrair imagens: ${error.message}`);
  }
  
  return productImageMap;
}

/**
 * Verifica se o arquivo Excel contém imagens
 * @param {string} filePath - Caminho para o arquivo Excel
 * @returns {Promise<boolean>} - True se o arquivo contém imagens
 */
export async function hasExcelImages(filePath) {
  try {
    // Ler o arquivo Excel como um arquivo zip
    const excelData = fs.readFileSync(filePath);
    const zip = new JSZip();
    const zipContents = await zip.loadAsync(excelData);
    
    // Verificar se existe a pasta 'xl/media'
    const mediaFolder = zipContents.folder('xl/media');
    
    if (!mediaFolder) {
      return false;
    }
    
    // Verificar se existem arquivos de imagem
    const imageFiles = Object.keys(mediaFolder.files)
      .filter(filename => !mediaFolder.files[filename].dir && 
        /\.(png|jpe?g|gif|tiff|bmp)$/i.test(filename));
    
    return imageFiles.length > 0;
  } catch (error) {
    console.error(`Erro ao verificar imagens: ${error.message}`);
    return false;
  }
}

/**
 * Gera URL de imagem em base64 a partir dos dados da imagem
 * @param {Buffer} imageData - Buffer contendo os dados da imagem
 * @param {string} extension - Extensão da imagem (jpg, png, etc.)
 * @returns {string} - URL base64 da imagem
 */
export function generateBase64ImageUrl(imageData, extension = 'jpg') {
  const mimeType = `image/${extension.replace('.', '')}`;
  const base64Data = imageData.toString('base64');
  return `data:${mimeType};base64,${base64Data}`;
}