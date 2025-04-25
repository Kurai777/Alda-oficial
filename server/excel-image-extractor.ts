import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { storage as adminStorage } from './firebase-admin';
import util from 'util';

const writeFile = util.promisify(fs.writeFile);
const mkdirPromise = util.promisify(fs.mkdir);

// Configuração das pastas
const PYTHON_SCRIPTS_DIR = path.join(process.cwd(), 'server', 'python-scripts');
const TEMP_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'temp-images');

/**
 * Cria as pastas necessárias se não existirem
 */
async function ensureDirectories() {
  // Verificar se a pasta de scripts Python existe, se não, criar
  if (!fs.existsSync(PYTHON_SCRIPTS_DIR)) {
    await mkdirPromise(PYTHON_SCRIPTS_DIR, { recursive: true });
  }
  
  // Verificar se a pasta temporária de imagens existe, se não, criar
  if (!fs.existsSync(TEMP_IMAGES_DIR)) {
    await mkdirPromise(TEMP_IMAGES_DIR, { recursive: true });
  }
}

/**
 * Cria um script Python para extrair imagens do Excel
 */
async function createPythonScript() {
  const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'extract_excel_images.py');
  
  const pythonScript = `
import openpyxl
import os
import sys
import json
import base64
import re
from openpyxl.drawing.image import Image
from PIL import Image as PILImage
import io

def extract_images_from_excel(excel_file_path, output_dir):
    # Abrir o arquivo Excel
    wb = openpyxl.load_workbook(excel_file_path)
    
    # Dados para retornar ao processo Node.js
    result = {
        "images": [],
        "error": None
    }
    
    try:
        # Para cada planilha no arquivo
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            
            # Obter todas as imagens da planilha
            for image_tuple in sheet._images:
                # Acessar dados binários da imagem
                image_data = image_tuple._data
                
                # Gerar nome temporário para a imagem
                temp_image_name = f"temp_image_{len(result['images'])}.png"
                temp_image_path = os.path.join(output_dir, temp_image_name)
                
                # Salvar imagem em disco temporariamente
                with open(temp_image_path, "wb") as f:
                    f.write(image_data)
                
                # Encontrar dados de produto próximos à imagem
                # Assumindo que o código do produto está na mesma linha ou próximo
                product_code = None
                
                # Procurar nas células próximas por um código de produto
                # Isto é uma simplificação - pode precisar de ajustes baseados na estrutura exata da planilha
                row = image_tuple.anchor.to.row
                col = image_tuple.anchor.to.col
                
                # Verificar células próximas (acima, abaixo, esquerda, direita)
                for r_offset in range(-3, 4):
                    for c_offset in range(-3, 4):
                        cell_row = max(1, row + r_offset)
                        cell_col = max(1, col + c_offset)
                        
                        cell_value = sheet.cell(row=cell_row, column=cell_col).value
                        if cell_value and isinstance(cell_value, str):
                            # Verificar se parece um código de produto (alfanumérico sem espaços)
                            if cell_value.replace('.', '').isalnum() and len(cell_value) >= 5:
                                product_code = cell_value
                                break
                    
                    if product_code:
                        break
                
                # Converter a imagem para base64
                with open(temp_image_path, "rb") as image_file:
                    encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
                
                # Se não encontrou código, usar nome temporário
                if not product_code:
                    product_code = f"unknown_product_{len(result['images'])}"
                
                # Remover caracteres não permitidos para nomes de arquivo
                safe_product_code = re.sub(r'[^\w\-\.]', '_', str(product_code))
                
                image_filename = f"{safe_product_code}.png"
                image_path = os.path.join(output_dir, image_filename)
                
                # Renomear arquivo para o nome final
                if os.path.exists(temp_image_path):
                    # Se o arquivo já existe com esse nome, adicionar um sufixo
                    suffix = 1
                    while os.path.exists(image_path):
                        image_filename = f"{safe_product_code}_{suffix}.png"
                        image_path = os.path.join(output_dir, image_filename)
                        suffix += 1
                    
                    os.rename(temp_image_path, image_path)
                
                # Adicionar informações ao resultado
                result["images"].append({
                    "product_code": product_code,
                    "image_path": image_path,
                    "image_filename": image_filename,
                    "image_base64": encoded_image
                })
        
    except Exception as e:
        result["error"] = str(e)
    
    # Retornar resultado como JSON
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx diretório_saída"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    extract_images_from_excel(excel_file_path, output_dir)
`;

  await writeFile(pythonScriptPath, pythonScript);
  return pythonScriptPath;
}

/**
 * Executa o script Python para extrair imagens
 * @param excelFilePath Caminho para o arquivo Excel
 * @returns Dados das imagens extraídas
 */
async function runPythonImageExtractor(excelFilePath: string): Promise<any> {
  // Garantir que as pastas existam
  await ensureDirectories();
  
  // Criar ou atualizar o script Python
  const pythonScriptPath = await createPythonScript();
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      excelFilePath,
      TEMP_IMAGES_DIR
    ]);
    
    let dataString = '';
    let errorString = '';
    
    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('Erro no script Python:', errorString);
        reject(new Error(`Python script exited with code ${code}: ${errorString}`));
        return;
      }
      
      try {
        const result = JSON.parse(dataString);
        resolve(result);
      } catch (error) {
        reject(new Error(`Falha ao analisar saída do script Python: ${error}`));
      }
    });
  });
}

/**
 * Faz upload de imagem para o Firebase Storage
 * @param imageBase64 Imagem em formato base64
 * @param imageName Nome do arquivo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns URL da imagem
 */
async function uploadImageToFirebase(
  imageBase64: string,
  imageName: string,
  userId: string,
  catalogId: string | number
): Promise<string> {
  try {
    // Converter base64 para buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    
    // Criar caminho para o arquivo no Storage
    const imagePath = `users/${userId}/catalogs/${catalogId}/products/${imageName}`;
    
    // Obter referência ao bucket
    const bucket = adminStorage.bucket();
    
    // Criar arquivo no bucket
    const file = bucket.file(imagePath);
    
    // Fazer upload do buffer
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/png'
      }
    });
    
    // Tornar o arquivo público
    await file.makePublic();
    
    // Obter URL pública
    const publicUrl = file.publicUrl();
    
    return publicUrl;
  } catch (error) {
    console.error('Erro ao fazer upload para o Firebase:', error);
    throw error;
  }
}

/**
 * Extrai imagens de um arquivo Excel e as associa aos produtos
 * @param excelFilePath Caminho do arquivo Excel
 * @param products Lista de produtos extraídos do Excel
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Produtos com imagens associadas
 */
export async function extractImagesFromExcel(
  excelFilePath: string,
  products: any[],
  userId: string,
  catalogId: string | number
): Promise<any[]> {
  try {
    console.log(`Extraindo imagens do Excel: ${excelFilePath}`);
    
    // Executar script Python para extrair imagens
    const extractionResult = await runPythonImageExtractor(excelFilePath);
    
    if (extractionResult.error) {
      console.error('Erro na extração de imagens:', extractionResult.error);
      return products; // Retornar produtos sem imagens em caso de erro
    }
    
    const { images } = extractionResult;
    console.log(`Extraídas ${images.length} imagens do Excel`);
    
    // Mapa para associar códigos de produtos a imagens
    const productImagesMap = new Map();
    
    // Processar imagens extraídas
    for (const imageData of images) {
      const { product_code, image_base64, image_filename } = imageData;
      
      try {
        // Fazer upload da imagem para o Firebase Storage
        const imageUrl = await uploadImageToFirebase(
          image_base64,
          image_filename,
          userId,
          catalogId
        );
        
        // Adicionar ao mapa
        if (!productImagesMap.has(product_code)) {
          productImagesMap.set(product_code, []);
        }
        productImagesMap.get(product_code).push(imageUrl);
      } catch (uploadError) {
        console.error(`Erro ao processar imagem para o produto ${product_code}:`, uploadError);
      }
    }
    
    // Associar imagens aos produtos correspondentes
    const productsWithImages = products.map(product => {
      // Verificar se há imagens para este produto
      const productCode = product.code;
      const productImages = productImagesMap.get(productCode);
      
      if (productImages && productImages.length > 0) {
        // Usar a primeira imagem como principal
        product.imageUrl = productImages[0];
        
        // Se houver múltiplas imagens, adicionar array de imagens adicionais
        if (productImages.length > 1) {
          product.additionalImages = productImages.slice(1);
        }
      }
      
      return product;
    });
    
    return productsWithImages;
  } catch (error) {
    console.error('Erro ao extrair imagens do Excel:', error);
    return products; // Retornar produtos sem alterações em caso de erro
  }
}

/**
 * Verifica se um arquivo Excel contém imagens
 * @param excelFilePath Caminho do arquivo Excel
 * @returns Promise<boolean> True se contém imagens, false caso contrário
 */
export async function hasExcelImages(excelFilePath: string): Promise<boolean> {
  try {
    // Garantir que as pastas existam
    await ensureDirectories();
    
    // Criar script temporário para verificar imagens
    const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'check_excel_images.py');
    
    const pythonScript = `
import openpyxl
import sys
import json
import re

def check_excel_images(excel_file_path):
    # Abrir o arquivo Excel
    try:
        wb = openpyxl.load_workbook(excel_file_path)
        
        # Verificar cada planilha por imagens
        has_images = False
        total_images = 0
        
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            # Verificar se a planilha contém imagens
            if hasattr(sheet, '_images') and len(sheet._images) > 0:
                has_images = True
                total_images += len(sheet._images)
        
        # Retornar resultado como JSON
        print(json.dumps({
            "has_images": has_images,
            "total_images": total_images
        }))
    except Exception as e:
        print(json.dumps({
            "has_images": False,
            "error": str(e)
        }))

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    check_excel_images(excel_file_path)
`;

    await writeFile(pythonScriptPath, pythonScript);
    
    // Executar o script Python para verificar imagens
    const result = await new Promise<{has_images: boolean, total_images?: number, error?: string}>((resolve, reject) => {
      const pythonProcess = spawn('python3', [
        pythonScriptPath,
        excelFilePath
      ]);
      
      let dataString = '';
      let errorString = '';
      
      pythonProcess.stdout.on('data', (data) => {
        dataString += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('Erro ao verificar imagens no Excel:', errorString);
          resolve({ has_images: false, error: errorString });
          return;
        }
        
        try {
          const result = JSON.parse(dataString);
          resolve(result);
        } catch (error) {
          resolve({ has_images: false, error: 'Falha ao analisar saída do script Python' });
        }
      });
    });
    
    if (result.has_images) {
      console.log(`Arquivo Excel contém ${result.total_images} imagens`);
    } else if (result.error) {
      console.warn(`Erro ao verificar imagens no Excel: ${result.error}`);
    }
    
    return result.has_images;
  } catch (error) {
    console.error('Erro ao verificar imagens no Excel:', error);
    return false;
  }
} 