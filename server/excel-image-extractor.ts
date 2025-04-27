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
 * Script Python SIMPLIFICADO: Apenas extrai base64 das imagens.
 */
async function createSimplifiedPythonScript() {
  const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'extract_excel_images_base64.py');
  const pythonScript = `
import openpyxl, os, sys, json, base64

def extract_images(excel_file_path):
    wb = openpyxl.load_workbook(excel_file_path)
    result = {"images_base64": [], "error": None} # Retorna lista de strings base64
    try:
        image_counter = 0
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            if not hasattr(sheet, '_images'): continue
            print(f"Planilha '{sheet_name}' tem {len(sheet._images)} imagens.", file=sys.stderr)
            for image_obj in sheet._images:
                image_counter += 1
                image_data = None
                try:
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes): image_data = data_result
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                         image_data = image_obj._data
                    if not image_data: continue
                    
                    encoded_image = base64.b64encode(image_data).decode('utf-8')
                    result["images_base64"].append(encoded_image)
                    print(f"Img {image_counter}: Extraído base64 ({len(encoded_image)} chars)", file=sys.stderr)
                    
                except Exception as img_err:
                    print(f"Erro processando imagem {image_counter}: {img_err}", file=sys.stderr)
                    
    except Exception as e:
        result["error"] = str(e)
        print(f"Erro geral Python: {e}", file=sys.stderr)
    
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 2: # Só espera o caminho do arquivo
        print(json.dumps({"error": "Argumento inválido!"}))
        sys.exit(1)
    extract_images(sys.argv[1])
`;

  await writeFile(pythonScriptPath, pythonScript, 'utf-8');
  return pythonScriptPath;
}

/**
 * Executa o script Python SIMPLIFICADO.
 */
async function runSimplifiedPythonExtractor(excelFilePath: string): Promise<any> {
   await ensureDirectories();
   const pythonScriptPath = await createSimplifiedPythonScript(); 
   console.log(`Executando script Python SIMPLIFICADO: ${pythonScriptPath} para ${excelFilePath}`);
   return new Promise((resolve) => {
    // Não precisamos mais passar TEMP_IMAGES_DIR
    const pythonProcess = spawn('python3', [pythonScriptPath, excelFilePath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let dataString = '';
    let errorString = '';
    pythonProcess.stdout.on('data', (data) => dataString += data.toString());
    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
      console.error(`[PYTHON SIMPLIFICADO STDERR]: ${data.toString().trim()}`); 
    });
    pythonProcess.on('error', (spawnError) => {
        console.error("Erro ao iniciar processo Python (simplificado):", spawnError);
        resolve({ images_base64: [], error: `Falha ao iniciar Python: ${spawnError.message}` });
    });
    pythonProcess.on('close', (code) => {
      console.log(`Script Python (simplificado) finalizado com código ${code}.`);
      if (code !== 0) {
        console.error('Script Python (simplificado) terminou com erro:', errorString);
        resolve({ images_base64: [], error: `Python script exited with code ${code}: ${errorString}` });
        return;
      }
      if (!dataString) {
          console.error('Script Python (simplificado) retornou stdout vazio.');
          resolve({ images_base64: [], error: 'Python stdout vazio.' });
          return;
      }
      try {
        const result = JSON.parse(dataString);
        console.log("Saída JSON do Python (simplificado) parseada com sucesso.");
        resolve(result);
      } catch (parseError) {
        console.error("Falha ao analisar saída JSON do script Python (simplificado):", dataString);
        console.error("Erro de parse:", parseError);
        // @ts-ignore
        resolve({ images_base64: [], error: `Falha ao analisar saída JSON: ${parseError.message}` }); 
      }
    });
  });
}

/**
 * Função exportada principal: Extrai imagens como base64 e faz upload sequencial para S3.
 * Retorna o número de imagens que foram enviadas com sucesso.
 */
export async function extractAndUploadImagesSequentially(
  excelFilePath: string,
  userId: string | number,
  catalogId: string | number
): Promise<number> { 
  let uploadSuccessCount = 0;
  try {
    console.log(`\n=== INICIANDO EXTRAÇÃO BASE64 + UPLOAD SEQUENCIAL S3 ===`);
    console.log(`Arquivo Excel: ${excelFilePath}`);

    const extractionResult = await runSimplifiedPythonExtractor(excelFilePath);

    if (!extractionResult || extractionResult.error) {
      console.error('Erro retornado pelo script Python (simplificado):', extractionResult?.error || 'Resultado inválido');
      return 0;
    }

    const { images_base64 } = extractionResult;
    if (!images_base64 || !Array.isArray(images_base64)) {
        console.error('Resultado do Python não contém um array "images_base64".', extractionResult);
        return 0;
    }
    
    console.log(`Python retornou ${images_base64.length} imagens (base64).`);

    if (images_base64.length === 0) {
      console.log("Nenhuma imagem base64 extraída pelo Python.");
      return 0;
    }

    for (let i = 0; i < images_base64.length; i++) {
      const base64Data = images_base64[i];
      const imageIndex = i + 1;
      const genericFilename = `catalog-${catalogId}-img-${imageIndex}.png`;

      try {
        await uploadImageToS3(
          base64Data,
          genericFilename, 
          userId,
          catalogId
        );
        uploadSuccessCount++;
        if (uploadSuccessCount % 50 === 0 || uploadSuccessCount === images_base64.length) {
             console.log(`Upload S3: ${uploadSuccessCount}/${images_base64.length} imagens enviadas...`);
        }
      } catch (uploadError) {
        console.error(`Falha no upload S3 para imagem índice ${imageIndex}.`, uploadError);
      }
    }

    console.log(`Upload concluído: ${uploadSuccessCount} de ${images_base64.length} imagens enviadas para S3.`);
    console.log(`=== FIM EXTRAÇÃO BASE64 + UPLOAD S3 ===`);
    return uploadSuccessCount;

  } catch (error) {
    console.error('Erro CRÍTICO no fluxo de extração/upload sequencial de imagens:', error);
    return uploadSuccessCount; 
  }
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