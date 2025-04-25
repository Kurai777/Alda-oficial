/**
 * Utilitário para extrair imagens de arquivos Excel
 * 
 * Este módulo utiliza uma abordagem baseada em arquivo binário para extrair
 * imagens de arquivos Excel (.xlsx). Ele localiza e extrai as imagens contidas
 * nos arquivos e as associa aos códigos de produtos correspondentes.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { storage } from './firebase-admin.js';
import JSZip from 'jszip';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

// Definir variáveis de controle para tratamento de imagens
const ENABLE_IMAGE_EXTRACTION = true;
const SAVE_TO_FIREBASE = true;
const SAVE_LOCALLY = true;
const LOCAL_IMAGE_PATH = path.join(process.cwd(), 'uploads', 'extracted_images');

/**
 * Extrai imagens de um arquivo Excel (.xlsx)
 * @param {string} filePath - Caminho para o arquivo Excel
 * @param {Array} products - Lista de produtos extraída do Excel para associar as imagens
 * @param {string} userId - ID do usuário para armazenamento Firebase
 * @returns {Object} - Mapa de código de produto para URL da imagem
 */
export async function extractImagesFromExcel(filePath, products, userId, catalogId = 'temp') {
  console.log(`Iniciando extração de imagens de: ${filePath}`);
  
  // Criar diretório local para armazenar imagens se não existir
  if (SAVE_LOCALLY && !fs.existsSync(LOCAL_IMAGE_PATH)) {
    await mkdir(LOCAL_IMAGE_PATH, { recursive: true });
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
    
    console.log('Arquivo Excel carregado com sucesso');
    
    // Verificar diferentes pastas de mídia em arquivos Excel
    const possibleMediaFolders = [
      'xl/media', 
      'xl/drawings', 
      'xl/embeddings',
      'xl/drawings/drawing1.xml',
      'xl/worksheets/drawings'
    ];
    
    let mediaFiles = [];
    
    // Procurar imagens em diferentes locais
    for (const folderPath of possibleMediaFolders) {
      const folder = zipContents.folder(folderPath);
      
      if (folder) {
        console.log(`Encontrada pasta potencial de imagens: ${folderPath}`);
        
        const files = Object.keys(folder.files)
          .filter(filename => !folder.files[filename].dir && 
            /\.(png|jpe?g|gif|tiff|bmp|wmf|emf)$/i.test(filename));
        
        console.log(`Encontrados ${files.length} arquivos em ${folderPath}`);
        
        for (const file of files) {
          mediaFiles.push({
            path: file,
            folder
          });
        }
      }
    }
    
    // Procurar também por arquivos na raiz que sejam imagens
    const rootImageFiles = Object.keys(zipContents.files)
      .filter(filename => !zipContents.files[filename].dir && 
        /\.(png|jpe?g|gif|tiff|bmp|wmf|emf)$/i.test(filename));
    
    for (const file of rootImageFiles) {
      mediaFiles.push({
        path: file,
        folder: zipContents
      });
    }
    
    console.log(`No total, encontradas ${mediaFiles.length} imagens potenciais no arquivo Excel`);
    
    // Tentar obter imagens de objetos embutidos
    // Alguns arquivos Excel armazenam imagens como objetos OLE
    const drawingRelFiles = Object.keys(zipContents.files)
      .filter(filename => !zipContents.files[filename].dir && 
        /\.xml.rels$/i.test(filename) && filename.includes('drawings'));
    
    console.log(`Encontrados ${drawingRelFiles.length} arquivos de relacionamento de desenho`);
    
    // Extrair as relações manualmente
    for (const relFile of drawingRelFiles) {
      try {
        const relData = await zipContents.file(relFile).async('string');
        
        // Encontrar referências a imagens
        const imageMatches = relData.match(/Target="\.\.\/media\/[^"]+"/g);
        
        if (imageMatches && imageMatches.length > 0) {
          console.log(`Encontradas ${imageMatches.length} referências a imagens em ${relFile}`);
          
          for (const match of imageMatches) {
            const imagePath = match.replace(/Target="\.\.\//, '').replace(/"$/, '');
            console.log(`Referência de imagem encontrada: ${imagePath}`);
            
            if (zipContents.file(imagePath)) {
              mediaFiles.push({
                path: imagePath,
                folder: zipContents
              });
            }
          }
        }
      } catch (error) {
        console.error(`Erro ao analisar relações de imagem em ${relFile}:`, error);
      }
    }
    
    console.log(`Total final: ${mediaFiles.length} imagens potenciais no Excel`);
    
    if (mediaFiles.length === 0) {
      console.log('Nenhuma imagem encontrada no arquivo Excel');
      return productImageMap;
    }
    
    // Criar mapa de índice para código de produto
    // Assumindo que a ordem das imagens corresponde à ordem dos produtos que possuem código
    const productsWithCode = products.filter(p => p.code && p.code.trim() !== '');
    
    console.log(`Temos ${productsWithCode.length} produtos com código para associar com ${mediaFiles.length} imagens`);
    
    // Extrair cada imagem e associá-la a um produto
    for (let i = 0; i < mediaFiles.length; i++) {
      const mediaFile = mediaFiles[i];
      
      try {
        console.log(`Processando arquivo de mídia: ${mediaFile.path}`);
        
        // Extrai os dados da imagem
        const imageFile = mediaFile.folder.file(mediaFile.path.replace(`${mediaFile.folder.root}/`, ''));
        
        if (!imageFile) {
          console.log(`Arquivo de imagem não encontrado: ${mediaFile.path}`);
          continue;
        }
        
        const imageData = await imageFile.async('nodebuffer');
        
        if (!imageData || imageData.length === 0) {
          console.log(`Dados de imagem vazios para: ${mediaFile.path}`);
          continue;
        }
        
        console.log(`Dados de imagem extraídos com sucesso: ${imageData.length} bytes`);
        
        // Tentar associar a imagem ao produto correspondente
        let productCode = null;
        let associatedProduct = null;
        
        // Primeiro, verificar se o nome do arquivo contém algum código de produto
        const fileName = path.basename(mediaFile.path);
        const fileNameWithoutExt = path.basename(fileName, path.extname(fileName));
        
        // Procurar produto por correspondência no nome do arquivo
        associatedProduct = productsWithCode.find(p => {
          const code = p.code.toString().trim();
          return fileName.includes(code) || fileNameWithoutExt.includes(code);
        });
        
        // Se não encontrou por nome de arquivo, usar o índice (assumindo correspondência de ordem)
        if (!associatedProduct && i < productsWithCode.length) {
          associatedProduct = productsWithCode[i];
        }
        
        if (associatedProduct) {
          productCode = associatedProduct.code;
          console.log(`Associado produto com código ${productCode} à imagem ${fileName}`);
        } else {
          // Se ainda não encontrou, use um código temporário
          productCode = `img_${i + 1}`;
          console.log(`Nenhum produto associado, usando código temporário: ${productCode}`);
        }
        
        // Gerar nome de arquivo seguro baseado no código do produto
        const safeProductCode = productCode.toString().replace(/[^a-zA-Z0-9]/g, '_');
        const imageFileNameExt = path.extname(fileName) || '.jpg';
        const outputImageName = `${safeProductCode}${imageFileNameExt}`;
        
        // Salvar localmente
        let localImagePath = null;
        if (SAVE_LOCALLY) {
          localImagePath = path.join(LOCAL_IMAGE_PATH, outputImageName);
          await writeFile(localImagePath, imageData);
          console.log(`Imagem salva localmente: ${localImagePath}`);
        }
        
        // Salvar no Firebase Storage
        if (SAVE_TO_FIREBASE) {
          try {
            const storageRef = storage.bucket();
            const imagePath = `users/${userId}/catalogs/${catalogId}/products/${outputImageName}`;
            const imageRef = storageRef.file(imagePath);
            
            // Fazer upload da imagem para o Firebase Storage
            await imageRef.save(imageData, {
              metadata: {
                contentType: `image/${imageFileNameExt.replace('.', '').toLowerCase() || 'jpeg'}`,
                metadata: {
                  productCode,
                  userId,
                  catalogId
                }
              }
            });
            
            // Tornar o arquivo público
            await imageRef.makePublic();
            
            // Obter URL pública
            const publicUrl = imageRef.publicUrl();
            
            console.log(`Imagem enviada para Firebase Storage: ${publicUrl}`);
            
            // Adicionar ao mapa de produtos
            productImageMap[productCode] = publicUrl;
            
          } catch (error) {
            console.error(`Erro ao salvar imagem no Firebase: ${error.message}`);
            
            // Se falhou salvar no Firebase, usar caminho local
            if (localImagePath) {
              // Converter para URL relativa
              const relativeUrl = `/uploads/extracted_images/${path.basename(localImagePath)}`;
              productImageMap[productCode] = relativeUrl;
              console.log(`Usando URL local alternativa: ${relativeUrl}`);
            }
          }
        } else if (localImagePath) {
          // Se não salvou no Firebase, usar URL local
          const relativeUrl = `/uploads/extracted_images/${path.basename(localImagePath)}`;
          productImageMap[productCode] = relativeUrl;
          console.log(`Usando URL local: ${relativeUrl}`);
        }
      } catch (fileError) {
        console.error(`Erro ao processar arquivo de mídia ${mediaFile.path}:`, fileError);
      }
    }
    
    console.log(`Processamento de imagens concluído. ${Object.keys(productImageMap).length} imagens extraídas e associadas.`);
    
    // Atualizar os produtos com as URLs das imagens
    let updatedProducts = 0;
    
    for (const product of products) {
      if (product.code && productImageMap[product.code]) {
        product.imageUrl = productImageMap[product.code];
        updatedProducts++;
      }
    }
    
    console.log(`${updatedProducts} produtos atualizados com URLs de imagem`);
    
  } catch (error) {
    console.error(`Erro ao extrair imagens do Excel: ${error.message}`);
    console.error(error.stack);
  }
  
  return products; // Retornar produtos atualizados com URLs de imagem
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
    
    // Lista de pastas onde podemos encontrar imagens em arquivos Excel
    const possibleMediaFolders = [
      'xl/media', 
      'xl/drawings', 
      'xl/embeddings',
      'xl/drawings/drawing1.xml',
      'xl/worksheets/drawings'
    ];
    
    // Verificar todas as pastas possíveis
    for (const folderPath of possibleMediaFolders) {
      const folder = zipContents.folder(folderPath);
      
      if (folder) {
        // Verificar se existem arquivos de imagem nessa pasta
        const imageFiles = Object.keys(folder.files)
          .filter(filename => !folder.files[filename].dir && 
            /\.(png|jpe?g|gif|tiff|bmp|wmf|emf)$/i.test(filename));
        
        if (imageFiles.length > 0) {
          console.log(`Encontradas ${imageFiles.length} imagens em ${folderPath}`);
          return true;
        }
      }
    }
    
    // Verificar também arquivos de relacionamento que apontam para imagens
    const drawingRelFiles = Object.keys(zipContents.files)
      .filter(filename => !zipContents.files[filename].dir && 
        /\.xml.rels$/i.test(filename) && filename.includes('drawings'));
    
    for (const relFile of drawingRelFiles) {
      try {
        const relData = await zipContents.file(relFile).async('string');
        if (relData.includes('Target="../media/') || relData.includes('relationships/image')) {
          console.log(`Encontradas referências a imagens em ${relFile}`);
          return true;
        }
      } catch (e) {
        // Ignorar erros ao ler arquivos de relacionamento
      }
    }
    
    // Verificar arquivos na raiz
    const rootImageFiles = Object.keys(zipContents.files)
      .filter(filename => !zipContents.files[filename].dir && 
        /\.(png|jpe?g|gif|tiff|bmp|wmf|emf)$/i.test(filename));
    
    if (rootImageFiles.length > 0) {
      console.log(`Encontradas ${rootImageFiles.length} imagens na raiz do arquivo`);
      return true;
    }
    
    // Se chegou até aqui, não encontrou nenhuma imagem
    return false;
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