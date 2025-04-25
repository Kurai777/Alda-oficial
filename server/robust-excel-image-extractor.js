/**
 * Módulo robusto para extrair imagens de arquivos Excel
 * 
 * Este módulo implementa múltiplas abordagens para garantir que as imagens
 * sejam extraídas com sucesso independente do formato do Excel
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import JSZip from 'jszip';
import { spawn } from 'child_process';
import { storage } from './firebase-admin.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

// Configuração de diretórios
const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp-images');
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
 * Cria script Python para extrair imagens
 */
async function createPythonScript() {
  const scriptPath = path.join(PYTHON_SCRIPTS_DIR, 'robust_excel_images.py');
  
  const scriptContent = `
import os
import sys
import json
import re
import base64
import zipfile
from io import BytesIO
from PIL import Image

def extract_images_from_excel(excel_path, output_dir):
    """Extrai imagens de um arquivo Excel usando múltiplos métodos"""
    result = {
        "images": [],
        "error": None
    }
    
    try:
        # Garantir que o diretório de saída existe
        os.makedirs(output_dir, exist_ok=True)
        
        # Método 1: Extrair diretamente do ZIP (Excel é um arquivo ZIP)
        with zipfile.ZipFile(excel_path, 'r') as excel_zip:
            # Procurar por arquivos de imagem em locais comuns
            image_paths = [f for f in excel_zip.namelist() if
                          re.search(r'\\.(png|jpe?g|gif|bmp|tiff|emf)$', f, re.IGNORECASE) and
                          ('xl/media/' in f or 'xl/drawings/' in f or 'word/media/' in f)]
            
            print(f"Encontrados {len(image_paths)} arquivos de imagem no Excel")
            
            # Extrair cada imagem
            for img_index, img_path in enumerate(image_paths):
                try:
                    # Extrair o nome do arquivo
                    img_filename = os.path.basename(img_path)
                    # Remover caracteres problemáticos
                    safe_filename = re.sub(r'[^\\w\\-\\.]', '_', img_filename)
                    # Adicionar índice para evitar sobreposição
                    temp_path = os.path.join(output_dir, f"img_{img_index}_{safe_filename}")
                    
                    # Extrair a imagem para o disco
                    with excel_zip.open(img_path) as img_file:
                        img_data = img_file.read()
                        
                        with open(temp_path, 'wb') as out_file:
                            out_file.write(img_data)
                        
                        # Converter para base64 para retorno
                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                        
                        # Adicionar ao resultado
                        result["images"].append({
                            "image_path": temp_path,
                            "image_filename": os.path.basename(temp_path),
                            "original_path": img_path,
                            "image_base64": img_base64
                        })
                        
                        print(f"Imagem {img_index+1} extraída: {temp_path}")
                except Exception as e:
                    print(f"Erro ao extrair imagem {img_path}: {str(e)}")
            
            # Se não encontramos imagens no método 1, tentar método alternativo
            if len(result["images"]) == 0:
                print("Tentando método alternativo de extração...")
                # Procurar por arquivos de relação que possam conter referências a imagens
                rels_files = [f for f in excel_zip.namelist() if f.endswith('.rels')]
                
                for rel_file in rels_files:
                    try:
                        with excel_zip.open(rel_file) as f:
                            rel_content = f.read().decode('utf-8')
                            # Procurar por referências a imagens
                            img_refs = re.findall(r'Target="([^"]+\\.(?:png|jpe?g|gif|bmp|tiff))"', rel_content)
                            
                            for img_ref in img_refs:
                                # Tentar construir o caminho completo
                                rel_dir = os.path.dirname(rel_file)
                                img_path = os.path.normpath(os.path.join(rel_dir, img_ref))
                                
                                try:
                                    with excel_zip.open(img_path) as img_file:
                                        img_data = img_file.read()
                                        img_filename = os.path.basename(img_path)
                                        safe_filename = re.sub(r'[^\\w\\-\\.]', '_', img_filename)
                                        temp_path = os.path.join(output_dir, f"rel_{len(result['images'])}_{safe_filename}")
                                        
                                        with open(temp_path, 'wb') as out_file:
                                            out_file.write(img_data)
                                        
                                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                                        
                                        result["images"].append({
                                            "image_path": temp_path,
                                            "image_filename": os.path.basename(temp_path),
                                            "original_path": img_path,
                                            "image_base64": img_base64
                                        })
                                except Exception as e:
                                    print(f"Erro ao extrair imagem da referência {img_ref}: {str(e)}")
                    except Exception as e:
                        print(f"Erro ao processar arquivo de relação {rel_file}: {str(e)}")
        
        print(f"Total de {len(result['images'])} imagens extraídas com sucesso")
    
    except Exception as e:
        result["error"] = str(e)
        print(f"Erro geral: {str(e)}")
    
    # Retornar o resultado como JSON
    print(json.dumps(result))
    return result

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos incorretos! Uso: python script.py arquivo.xlsx diretorio_saida"}))
        sys.exit(1)
    
    excel_path = sys.argv[1]
    output_dir = sys.argv[2]
    extract_images_from_excel(excel_path, output_dir)
`;

  await writeFile(scriptPath, scriptContent);
  return scriptPath;
}

/**
 * Extrai imagens diretamente do Excel usando JSZip
 * @param {string} excelPath Caminho do arquivo Excel
 * @returns {Promise<Object>} Resultado da extração
 */
async function extractImagesWithJSZip(excelPath) {
  // Garantir que os diretórios existem
  await ensureDirectories();
  
  try {
    // Ler arquivo Excel como um buffer
    const excelData = await readFile(excelPath);
    
    // Carregar como arquivo ZIP (o xlsx é um arquivo ZIP)
    const zip = new JSZip();
    const zipContents = await zip.loadAsync(excelData);
    
    // Resultado a ser retornado
    const result = {
      images: [],
      error: null
    };
    
    // Locais onde imagens podem estar armazenadas em arquivos Excel
    const possibleImageLocations = [
      'xl/media/',
      'xl/drawings/',
      'word/media/',
      'xl/embeddings/',
      'ppt/media/'
    ];
    
    // Extensões de arquivo de imagem comuns
    const imageExtensionRegex = /\.(png|jpe?g|gif|bmp|tiff|emf)$/i;
    
    // Encontrar todos os arquivos no ZIP que parecem ser imagens
    const imageFiles = [];
    
    // Procurar em cada local
    for (const location of possibleImageLocations) {
      const filesInLocation = Object.keys(zipContents.files)
        .filter(filename => 
          !zipContents.files[filename].dir && 
          filename.startsWith(location) && 
          imageExtensionRegex.test(filename)
        );
      
      if (filesInLocation.length > 0) {
        console.log(`Encontradas ${filesInLocation.length} imagens em ${location}`);
        imageFiles.push(...filesInLocation);
      }
    }
    
    // Também procurar por quaisquer outros arquivos de imagem em qualquer lugar
    const otherImageFiles = Object.keys(zipContents.files)
      .filter(filename => 
        !zipContents.files[filename].dir && 
        imageExtensionRegex.test(filename) &&
        !imageFiles.includes(filename)
      );
    
    if (otherImageFiles.length > 0) {
      console.log(`Encontradas ${otherImageFiles.length} imagens adicionais fora das pastas padrão`);
      imageFiles.push(...otherImageFiles);
    }
    
    // Processar cada arquivo de imagem encontrado
    for (let i = 0; i < imageFiles.length; i++) {
      const imagePath = imageFiles[i];
      
      try {
        // Extrair os dados da imagem como um buffer
        const imageData = await zipContents.file(imagePath).async('nodebuffer');
        
        // Verificar se temos dados válidos
        if (!imageData || imageData.length === 0) {
          console.log(`Dados vazios para imagem ${imagePath}`);
          continue;
        }
        
        // Criar nome de arquivo seguro
        const fileName = path.basename(imagePath);
        const safeFileName = `img_${i}_${fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const outputPath = path.join(TEMP_DIR, safeFileName);
        
        // Salvar no disco
        await writeFile(outputPath, imageData);
        
        // Converter para base64
        const base64Data = imageData.toString('base64');
        
        // Adicionar ao resultado
        result.images.push({
          image_path: outputPath,
          image_filename: safeFileName,
          original_path: imagePath,
          image_base64: base64Data
        });
        
        console.log(`Imagem ${i+1} extraída: ${outputPath} (${imageData.length} bytes)`);
      } catch (error) {
        console.error(`Erro ao extrair imagem ${imagePath}: ${error.message}`);
      }
    }
    
    // Se não encontramos imagens pelo método direto, tentar extrair de arquivos de relações
    if (result.images.length === 0) {
      console.log('Tentando método alternativo via arquivos de relações...');
      
      // Procurar arquivos .rels que possam conter referências a imagens
      const relsFiles = Object.keys(zipContents.files)
        .filter(filename => 
          !zipContents.files[filename].dir && 
          filename.endsWith('.rels')
        );
      
      console.log(`Encontrados ${relsFiles.length} arquivos de relações para verificar`);
      
      for (const relsFile of relsFiles) {
        try {
          // Ler conteúdo do arquivo de relações
          const relsContent = await zipContents.file(relsFile).async('string');
          
          // Procurar referências a imagens usando regex
          const imageMatches = relsContent.match(/Target="([^"]+\.(png|jpe?g|gif|bmp|tiff))"/gi);
          
          if (imageMatches && imageMatches.length > 0) {
            console.log(`Encontradas ${imageMatches.length} referências a imagens em ${relsFile}`);
            
            for (const match of imageMatches) {
              try {
                // Extrair o caminho da imagem
                const targetMatch = match.match(/Target="([^"]+)"/i);
                if (!targetMatch || !targetMatch[1]) continue;
                
                let imagePath = targetMatch[1];
                
                // Ajustar caminho conforme necessário
                if (imagePath.startsWith('../')) {
                  // Caminho relativo a partir do diretório do arquivo .rels
                  const relDir = path.dirname(relsFile);
                  imagePath = path.normalize(path.join(relDir, '..', imagePath.substring(3)));
                }
                
                // Verificar se o arquivo existe no ZIP
                if (!zipContents.files[imagePath] && !zipContents.files[imagePath.substring(1)]) {
                  // Tentar outros caminhos possíveis
                  const possiblePaths = [
                    `xl/${imagePath}`,
                    imagePath.replace(/^\//, ''),
                    imagePath.replace(/^\.\.\//, '')
                  ];
                  
                  let found = false;
                  for (const possiblePath of possiblePaths) {
                    if (zipContents.files[possiblePath]) {
                      imagePath = possiblePath;
                      found = true;
                      break;
                    }
                  }
                  
                  if (!found) {
                    console.log(`Imagem referenciada não encontrada: ${imagePath}`);
                    continue;
                  }
                }
                
                // Extrair os dados da imagem
                const zipFile = zipContents.files[imagePath] || zipContents.files[imagePath.substring(1)];
                const imageData = await zipFile.async('nodebuffer');
                
                if (!imageData || imageData.length === 0) {
                  console.log(`Dados vazios para imagem referenciada: ${imagePath}`);
                  continue;
                }
                
                // Criar nome de arquivo seguro
                const fileName = path.basename(imagePath);
                const safeFileName = `rel_${result.images.length}_${fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`;
                const outputPath = path.join(TEMP_DIR, safeFileName);
                
                // Salvar no disco
                await writeFile(outputPath, imageData);
                
                // Converter para base64
                const base64Data = imageData.toString('base64');
                
                // Adicionar ao resultado
                result.images.push({
                  image_path: outputPath,
                  image_filename: safeFileName,
                  original_path: imagePath,
                  image_base64: base64Data
                });
                
                console.log(`Imagem referenciada extraída: ${outputPath} (${imageData.length} bytes)`);
              } catch (matchError) {
                console.error(`Erro ao processar referência: ${match}`, matchError);
              }
            }
          }
        } catch (relsError) {
          console.error(`Erro ao processar arquivo de relações ${relsFile}: ${relsError.message}`);
        }
      }
    }
    
    console.log(`Total de ${result.images.length} imagens extraídas com sucesso`);
    return result;
  } catch (error) {
    console.error(`Erro ao extrair imagens: ${error.message}`);
    return {
      images: [],
      error: error.message
    };
  }
}

/**
 * Faz upload de uma imagem para o Firebase Storage
 * @param {string} imageBase64 Imagem em formato base64
 * @param {string} fileName Nome do arquivo
 * @param {string} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<string>} URL da imagem
 */
async function uploadToFirebase(imageBase64, fileName, userId, catalogId) {
  try {
    // Converter base64 para buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    
    // Verificar se o buffer é válido
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Buffer de imagem inválido');
    }
    
    // Criar caminho para o arquivo no Storage (usando estrutura correta)
    const imagePath = `products/${userId}/${catalogId}/${fileName}`;
    
    // Obter referência ao bucket
    const bucket = storage.bucket();

    console.log(`Tentando salvar imagem em: ${imagePath}`);
    
    // Criar arquivo no bucket
    const file = bucket.file(imagePath);
    
    // Determinar o tipo de conteúdo baseado na extensão
    const extension = path.extname(fileName).toLowerCase().replace('.', '') || 'jpg';
    const contentType = `image/${extension}`;
    
    // Fazer upload do buffer com configurações expandidas
    await file.save(imageBuffer, {
      metadata: {
        contentType,
        metadata: {
          userId,
          catalogId,
          firebaseStorageDownloadTokens: Date.now()
        }
      },
      resumable: false, // Desabilitar upload resumable para arquivos pequenos
      public: true
    });
    
    // Tornar o arquivo público
    await file.makePublic();
    
    // Obter URL pública (formato especial do Firebase Storage)
    // Obter configuração do Firebase app
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "ald-a-8b969";
    const bucketName = `${projectId}.appspot.com`;
    
    // URL no formato do Firebase Storage
    const encodedPath = encodeURIComponent(imagePath);
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
    
    console.log(`URL de imagem gerada: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error(`Erro ao fazer upload para o Firebase: ${error.message}`);
    throw error;
  }
}

/**
 * Extrai imagens de um arquivo Excel e as associa a produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {Array} products Lista de produtos
 * @param {string} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<Array>} Produtos com URLs de imagem
 */
export async function extractImagesFromExcel(excelPath, products, userId, catalogId) {
  console.log(`Extraindo imagens de ${excelPath} com método robusto`);
  
  try {
    // Extrair imagens com JSZip (puro JavaScript)
    const result = await extractImagesWithJSZip(excelPath);
    
    if (result.error) {
      console.warn(`Aviso na extração de imagens: ${result.error}`);
    }
    
    if (!result.images || result.images.length === 0) {
      console.log('Nenhuma imagem encontrada no arquivo Excel');
      return products;
    }
    
    console.log(`Encontradas ${result.images.length} imagens no Excel`);
    
    // Filtrar produtos com código
    const productsWithCode = products.filter(p => p.code && p.code.toString().trim() !== '');
    
    if (productsWithCode.length === 0) {
      console.log('Nenhum produto com código encontrado para associar às imagens');
      return products;
    }
    
    // Mapa para armazenar URLs de imagens por código de produto
    const productImageMap = {};
    
    // Processar cada imagem
    for (let i = 0; i < result.images.length; i++) {
      const imageData = result.images[i];
      const { image_base64, image_filename } = imageData;
      
      // Tentar associar a imagem a um produto
      let productCode = null;
      let product = null;
      
      // Estratégia 1: Correspondência pelo nome do arquivo
      // Remover extensão e caracteres especiais
      const baseFilename = path.basename(image_filename, path.extname(image_filename))
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      
      // Procurar código de produto no nome do arquivo
      for (const p of productsWithCode) {
        const normalizedCode = p.code.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        if (baseFilename.includes(normalizedCode) || normalizedCode.includes(baseFilename)) {
          product = p;
          productCode = p.code;
          console.log(`Imagem ${image_filename} associada ao produto com código ${productCode}`);
          break;
        }
      }
      
      // Estratégia 2: Associação por índice
      if (!product && i < productsWithCode.length) {
        product = productsWithCode[i];
        productCode = product.code;
        console.log(`Imagem ${image_filename} associada ao produto ${productCode} por índice`);
      }
      
      // Se ainda não encontrou, atribuir código temporário
      if (!productCode) {
        productCode = `img_${i + 1}`;
        console.log(`Nenhum produto associado à imagem ${image_filename}, usando código temporário ${productCode}`);
      }
      
      try {
        // Criar nome de arquivo seguro
        const safeFilename = `${productCode.toString().replace(/[^a-zA-Z0-9]/g, '_')}${path.extname(image_filename)}`;
        
        // Fazer upload para o Firebase
        const imageUrl = await uploadToFirebase(
          image_base64,
          safeFilename,
          userId,
          catalogId
        );
        
        console.log(`Imagem ${safeFilename} enviada para Firebase: ${imageUrl}`);
        
        // Adicionar ao mapa
        if (!productImageMap[productCode]) {
          productImageMap[productCode] = [];
        }
        productImageMap[productCode].push(imageUrl);
      } catch (uploadError) {
        console.error(`Erro ao fazer upload da imagem ${image_filename}:`, uploadError);
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
    console.error(`Erro ao extrair imagens do Excel: ${error.message}`);
    return products;
  }
}

/**
 * Verifica se um arquivo Excel contém imagens
 * @param {string} excelPath Caminho do arquivo Excel
 * @returns {Promise<boolean>} True se contém imagens
 */
export async function hasExcelImages(excelPath) {
  try {
    // Ler o arquivo Excel como ZIP
    const excelData = await readFile(excelPath);
    const zip = new JSZip();
    const zipContents = await zip.loadAsync(excelData);
    
    // Procurar por arquivos de imagem em locais comuns
    const imageExtensions = /\.(png|jpe?g|gif|bmp|tiff|emf)$/i;
    const mediaFolders = ['xl/media/', 'xl/drawings/', 'word/media/'];
    
    for (const filename of Object.keys(zipContents.files)) {
      if (!zipContents.files[filename].dir) {
        // Verificar por extensão de imagem
        if (imageExtensions.test(filename)) {
          console.log(`Encontrada imagem no Excel: ${filename}`);
          return true;
        }
        
        // Verificar se está em uma pasta de mídia conhecida
        if (mediaFolders.some(folder => filename.includes(folder))) {
          console.log(`Encontrado arquivo potencialmente de imagem: ${filename}`);
          return true;
        }
      }
    }
    
    // Verificar arquivos de relação que podem conter referências a imagens
    const relsFiles = Object.keys(zipContents.files).filter(filename => 
      !zipContents.files[filename].dir && filename.endsWith('.rels')
    );
    
    for (const relFile of relsFiles) {
      const content = await zipContents.file(relFile).async('string');
      if (content.includes('image') || 
          content.includes('.jpg') || 
          content.includes('.png') ||
          content.includes('.jpeg') ||
          content.includes('.gif')) {
        console.log(`Encontrada referência a imagem em ${relFile}`);
        return true;
      }
    }
    
    console.log('Nenhuma imagem encontrada no arquivo Excel');
    return false;
  } catch (error) {
    console.error(`Erro ao verificar imagens no Excel: ${error.message}`);
    return false;
  }
}