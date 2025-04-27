import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { uploadBufferToS3 } from './s3-service.js';

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
 * Cria o script Python para extrair imagens e códigos.
 * Tenta obter o código da coluna F na linha da imagem.
 */
async function createPythonScript() {
  const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'extract_excel_images_code.py');
  const pythonScript = `
import openpyxl, os, sys, json, base64, re

def extract_images_from_excel(excel_file_path, output_dir):
    wb = openpyxl.load_workbook(excel_file_path)
    result = {"images": [], "error": None}
    try:
        if not os.path.exists(output_dir): os.makedirs(output_dir)
        image_counter = 0
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            if not hasattr(sheet, '_images'): continue
            print(f"Planilha '{sheet_name}' tem {len(sheet._images)} imagens.", file=sys.stderr)
            for image_obj in sheet._images:
                image_counter += 1
                image_data = None
                product_code = None
                try:
                    # Tentar acessar dados da imagem
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes): image_data = data_result
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                        image_data = image_obj._data
                    if not image_data: print(f"Falha Img {image_counter}: Dados binários inválidos.", file=sys.stderr); continue
                except Exception as data_err: print(f"Erro Img {image_counter} data: {data_err}", file=sys.stderr); continue

                temp_image_name = f"temp_img_{image_counter}.png"
                temp_image_path = os.path.join(output_dir, temp_image_name)
                try:
                    with open(temp_image_path, "wb") as f: f.write(image_data)
                except Exception as write_err: print(f"Erro Img {image_counter} save: {write_err}", file=sys.stderr); continue

                # Tentar encontrar código na coluna F (6) da linha da âncora
                try:
                    anchor_row = image_obj.anchor.to.row + 1
                    code_cell_value = sheet.cell(row=anchor_row, column=6).value
                    if code_cell_value:
                        code_str = str(code_cell_value).strip()
                        if len(code_str) > 1 and not code_str.lower() in ['cod.', 'codigo', 'código']:
                            product_code = code_str
                            print(f"Img {image_counter}: Código da Col F linha {anchor_row}: '{product_code}'", file=sys.stderr)
                    if not product_code: # Fallback procurar perto
                         for offset in [-1, 1]:
                             check_row = anchor_row + offset
                             if check_row >= 1:
                                 fallback_cell = sheet.cell(row=check_row, column=6).value
                                 if fallback_cell:
                                     code_str = str(fallback_cell).strip()
                                     if len(code_str) > 1 and not code_str.lower() in ['cod.', 'codigo', 'código']:
                                         product_code = code_str
                                         print(f"Img {image_counter}: Código fallback Col F linha {check_row}: '{product_code}'", file=sys.stderr)
                                         break
                except Exception as anchor_err: print(f"Erro Img {image_counter} anchor: {anchor_err}", file=sys.stderr)

                if not product_code: product_code = f"unknown_product_{image_counter}"

                encoded_image = None
                try:
                    with open(temp_image_path, "rb") as image_file: encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
                except Exception as b64_err: print(f"Erro Img {image_counter} base64: {b64_err}", file=sys.stderr)
                finally:
                    if os.path.exists(temp_image_path): 
                        try: os.remove(temp_image_path)
                        except OSError as e: print(f"Erro ao remover temp {temp_image_path}: {e}", file=sys.stderr)
                if not encoded_image: continue

                # Regex CORRIGIDA (hífen escapado no final)
                safe_product_code = re.sub(r'[^\w.\-]', '_', str(product_code))
                image_filename = f"{safe_product_code}.png"

                result["images"].append({
                    "product_code": product_code,
                    "image_filename": image_filename,
                    "image_base64": encoded_image
                })
    except Exception as e: result["error"] = str(e); print(f"Erro geral Python: {e}", file=sys.stderr)
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3: 
        print(json.dumps({"error": "Argumentos inválidos!"}))
        sys.exit(1)
    extract_images_from_excel(sys.argv[1], sys.argv[2])
`;

  await writeFile(pythonScriptPath, pythonScript, 'utf-8');
  return pythonScriptPath;
}

/**
 * Executa o script Python para extrair imagens e códigos.
 */
async function runPythonImageExtractor(excelFilePath: string): Promise<any> {
   await ensureDirectories();
   const pythonScriptPath = await createPythonScript();
   console.log(`Executando script Python: ${pythonScriptPath} para ${excelFilePath}`);
   return new Promise((resolve) => {
    const pythonProcess = spawn('python3', [pythonScriptPath, excelFilePath, TEMP_IMAGES_DIR], { stdio: ['pipe', 'pipe', 'pipe'] });
    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });
    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
      console.error(`[PYTHON STDERR]: ${data.toString().trim()}`); // Log stderr em tempo real
    });
    pythonProcess.on('error', (spawnError) => {
        console.error("Erro ao iniciar processo Python:", spawnError);
        resolve({ images: [], error: `Falha ao iniciar Python: ${spawnError.message}` });
    });
    pythonProcess.on('close', (code) => {
      console.log(`Script Python finalizado com código ${code}.`);
      if (code !== 0) {
        console.error('Script Python terminou com erro. Saída de erro completa:', errorString);
        resolve({ images: [], error: `Python script exited with code ${code}: ${errorString}` });
        return;
      }
      if (!dataString) {
          console.error('Script Python executado com sucesso, mas não retornou dados (stdout vazio).');
          resolve({ images: [], error: 'Python stdout vazio.' });
          return;
      }
      try {
        const result = JSON.parse(dataString);
        console.log("Saída JSON do Python parseada com sucesso.");
        resolve(result);
      } catch (parseError) {
        console.error("Falha ao analisar saída JSON do script Python:", dataString);
        console.error("Erro de parse:", parseError);
        // @ts-ignore
        resolve({ images: [], error: `Falha ao analisar saída JSON: ${parseError.message}` }); 
      }
    });
  });
}

/**
 * Faz upload de imagem Base64 para S3.
 */
async function uploadImageToS3(
  imageBase64: string,
  baseImageName: string, 
  userId: string | number,
  catalogId: string | number
): Promise<string> {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const mimeType = 'image/png';
    const uniqueFileName = `${Date.now()}-${baseImageName}`; 
    const s3Key = `users/${userId}/products/${catalogId}/${uniqueFileName}`;
    console.log(`Fazendo upload para S3: Key=${s3Key}`);
    const publicUrl = await uploadBufferToS3(imageBuffer, s3Key, mimeType);
    console.log(`Upload para S3 bem-sucedido: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error(`Erro ao fazer upload da imagem ${baseImageName} para S3:`, error);
    throw error;
  }
}

/**
 * Função exportada principal: Extrai imagens e códigos do Excel via Python,
 * faz upload para S3 e retorna um Map [códigoProduto -> urlImagemS3].
 */
export async function extractAndUploadExcelImages(
  excelFilePath: string,
  userId: string | number,
  catalogId: string | number
): Promise<Map<string, string>> {
  const productImagesMap = new Map<string, string>();
  try {
    console.log(`\n=== INICIANDO EXTRAÇÃO PY + UPLOAD S3 ===`);
    console.log(`Arquivo Excel: ${excelFilePath}`);

    const extractionResult = await runPythonImageExtractor(excelFilePath);

    if (!extractionResult || extractionResult.error) {
      console.error('Erro retornado pelo script Python ou resultado inválido:', extractionResult?.error || 'Resultado inválido');
      return productImagesMap;
    }

    const { images } = extractionResult;
    if (!images || !Array.isArray(images)) {
        console.error('Resultado do Python não contém um array "images".', extractionResult);
        return productImagesMap;
    }
    
    console.log(`Python retornou ${images.length} entradas de imagem.`);

    if (images.length === 0) {
      console.log("Nenhuma imagem encontrada ou extraída pelo Python.");
      return productImagesMap;
    }

    let uploadSuccessCount = 0;
    for (const imageData of images) {
      const { product_code, image_base64, image_filename } = imageData;

      if (!product_code || !image_base64 || !image_filename || product_code.startsWith('unknown_product')) {
          console.warn("Código de produto inválido ou ausente detectado pelo Python, pulando upload para:", image_filename);
          continue; 
      }

      try {
        const imageUrl = await uploadImageToS3(
          image_base64,
          image_filename, 
          userId,
          catalogId
        );
        // IMPORTANTE: Normalizar o código do produto para consistência
        const normalizedCode = product_code.toString().trim(); 
        productImagesMap.set(normalizedCode, imageUrl);
        uploadSuccessCount++;
        console.log(`Img para código ${normalizedCode} (${image_filename}) enviada para S3: ${imageUrl}`);
      } catch (uploadError) {
        console.error(`Falha no upload S3 para ${product_code}.`, uploadError);
      }
    }

    console.log(`Upload concluído: ${uploadSuccessCount} de ${images.length} imagens com código válido enviadas.`);
    console.log(`=== FIM EXTRAÇÃO PY + UPLOAD S3 ===`);
    return productImagesMap;

  } catch (error) {
    console.error('Erro CRÍTICO no fluxo de extração/upload de imagens:', error);
    return productImagesMap; 
  }
}

/**
 * Verifica se um arquivo Excel contém imagens usando Python.
 */
export async function hasExcelImages(excelFilePath: string): Promise<boolean> {
   try {
       await ensureDirectories();
       const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'check_excel_images.py');
       const pythonScript = `
import openpyxl, sys, json
def check_excel_images(fp):
    try:
        wb = openpyxl.load_workbook(fp)
        has_img = False; count = 0
        for sheet in wb.worksheets:
            # Verifica se o atributo existe E se a lista não está vazia
            if hasattr(sheet, '_images') and sheet._images:
                has_img = True; count += len(sheet._images)
        print(json.dumps({"has_images": has_img, "total_images": count}))
    except Exception as e: print(json.dumps({"has_images": False, "error": str(e)}))
if __name__ == "__main__":
    if len(sys.argv)!= 2: sys.exit(1)
    check_excel_images(sys.argv[1])
`;
       await writeFile(pythonScriptPath, pythonScript, 'utf-8');
       const result = await new Promise<{has_images: boolean, total_images?: number, error?: string}>((resolve) => {
          const pythonProcess = spawn('python3', [pythonScriptPath, excelFilePath]);
          let dataString = ''; let errorString = '';
          pythonProcess.stdout.on('data', (data) => dataString += data.toString());
          pythonProcess.stderr.on('data', (data) => errorString += data.toString());
          pythonProcess.on('close', (code) => {
            if (code !== 0) { resolve({ has_images: false, error: errorString }); return; }
            try { resolve(JSON.parse(dataString)); } 
            // @ts-ignore
            catch (e) { resolve({ has_images: false, error: 'Falha parse JSON' }); }
          });
       });
       console.log(`Resultado check_excel_images:`, result);
       return result.has_images;
   } catch (error) { 
       console.error("Erro ao verificar imagens com Python:", error);
       return false; 
   }
} 