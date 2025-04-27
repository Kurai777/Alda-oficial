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

def extract_images_from_excel(excel_file_path, output_dir):
    wb = openpyxl.load_workbook(excel_file_path)
    result = {"images": [], "error": None}
    
    try:
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        image_counter = 0
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            if not hasattr(sheet, '_images'): continue
            print(f"Planilha '{sheet_name}' tem {len(sheet._images)} imagens.", file=sys.stderr)
            
            for image_obj in sheet._images:
                image_counter += 1
                image_data = None
                product_code = None

                # --- Tentativa de Acesso aos Dados da Imagem ---
                try:
                    # Em versões mais recentes, a imagem pode ser acessada diretamente
                    # O objeto openpyxl.drawing.image.Image tem um método _data() ou bytes diretamente?
                    # A documentação não é clara sobre o acesso direto aos bytes.
                    # O erro anterior sugere que _data pode ser um método.
                    
                    # Tentativa 1: Chamar _data() se for callable
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes):
                            image_data = data_result
                        else:
                             print(f"Aviso Img {image_counter}: image_obj._data() não retornou bytes.", file=sys.stderr)
                    
                    # Tentativa 2: Acessar _data diretamente se não for callable (e Tentativa 1 falhou)
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                        image_data = image_obj._data

                    # Tentativa 3: Usar o método ref (pode ser caminho interno)
                    # Esta abordagem é mais complexa e menos garantida
                    # if not image_data and hasattr(image_obj, 'ref'):
                    #    print(f"Aviso Img {image_counter}: Tentando com image_obj.ref: {image_obj.ref}", file=sys.stderr)
                         # Precisaria abrir o arquivo zip do Excel e ler a referência interna

                    if not image_data:
                         print(f"Falha Img {image_counter}: Não foi possível obter dados binários válidos.", file=sys.stderr)
                         continue # Pula para a próxima imagem

                except Exception as data_err:
                    print(f"Erro Img {image_counter}: Erro ao acessar dados da imagem: {data_err}", file=sys.stderr)
                    continue # Pula para a próxima imagem
                # --- Fim da Tentativa de Acesso ---

                # Salvar temporariamente para converter (ainda necessário para base64)
                temp_image_name = f"temp_img_{image_counter}.png"
                temp_image_path = os.path.join(output_dir, temp_image_name)
                try:
                    with open(temp_image_path, "wb") as f:
                        # AQUI é onde o erro acontecia. image_data DEVE ser bytes.
                        if isinstance(image_data, bytes):
                            f.write(image_data)
                        else:
                             raise TypeError(f"image_data não é bytes, é {type(image_data)}")
                except Exception as write_err:
                     print(f"Erro Img {image_counter}: Erro ao salvar temp {temp_image_name}: {write_err}", file=sys.stderr)
                     continue 

                # --- LÓGICA REFINADA PARA ENCONTRAR CÓDIGO --- 
                try:
                    # Obter a linha onde a imagem termina (âncora inferior direita)
                    # Adicionar +1 porque as linhas do openpyxl são 1-based
                    anchor_row = image_obj.anchor.to.row + 1 
                    print(f"Img {image_counter}: Âncora na linha {anchor_row}", file=sys.stderr)
                    
                    # TENTAR LER O CÓDIGO DIRETAMENTE DA COLUNA F NA LINHA DA ÂNCORA
                    # Coluna F é a 6ª coluna (índice 6 no openpyxl 1-based)
                    code_cell_value = sheet.cell(row=anchor_row, column=6).value
                    
                    if code_cell_value:
                        code_str = str(code_cell_value).strip()
                        # Validar se parece um código (não vazio, não apenas texto genérico)
                        if len(code_str) > 1 and not code_str.lower() in ['cod.', 'codigo', 'código']:
                            product_code = code_str
                            print(f"Img {image_counter}: Código encontrado na Coluna F, Linha {anchor_row}: '{product_code}'", file=sys.stderr)
                        else:
                            print(f"Img {image_counter}: Valor inválido ('{code_str}') na Coluna F, Linha {anchor_row}.", file=sys.stderr)
                    else:
                         print(f"Img {image_counter}: Célula F{anchor_row} (Código) vazia.", file=sys.stderr)

                    # FALLBACK: Se não encontrou na linha exata, procurar em ±1 linha na Coluna F
                    if not product_code:
                        print(f"Img {image_counter}: Procurando código em F{anchor_row-1} e F{anchor_row+1}", file=sys.stderr)
                        for offset in [-1, 1]:
                            check_row = anchor_row + offset
                            if check_row >= 1: # Garantir linha válida
                                fallback_cell_value = sheet.cell(row=check_row, column=6).value
                                if fallback_cell_value:
                                    code_str = str(fallback_cell_value).strip()
                                    if len(code_str) > 1 and not code_str.lower() in ['cod.', 'codigo', 'código']:
                                        product_code = code_str
                                        print(f"Img {image_counter}: Código encontrado (fallback) na Coluna F, Linha {check_row}: '{product_code}'", file=sys.stderr)
                                        break # Encontrou, parar de procurar
                    
                except Exception as anchor_err:
                    print(f"Erro Img {image_counter}: Erro ao obter âncora/código: {anchor_err}", file=sys.stderr)
                # --- FIM DA LÓGICA DE CÓDIGO ---
                
                # Se ainda não tem código, usar fallback
                if not product_code: 
                    product_code = f"unknown_product_{image_counter}"
                    print(f"Img {image_counter}: Código final: '{product_code}' (fallback)", file=sys.stderr)
                else:
                     print(f"Img {image_counter}: Código final: '{product_code}'", file=sys.stderr)

                # Converter para base64
                encoded_image = None
                try:
                    with open(temp_image_path, "rb") as image_file:
                         encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
                except Exception as b64_err:
                    print(f"Erro Img {image_counter}: Erro ao converter para base64: {b64_err}", file=sys.stderr)
                finally:
                    # Garantir limpeza do arquivo temporário
                    if os.path.exists(temp_image_path):
                        try: os.remove(temp_image_path)
                        except: pass
                
                if not encoded_image:
                    continue # Pular se não conseguiu converter

                # Gerar nome final seguro
                safe_product_code = re.sub(r'[^\w.-]', '_', str(product_code))
                image_filename = f"{safe_product_code}.png"
                
                # Adicionar ao resultado
                result["images"].append({
                    "product_code": product_code,
                    "image_filename": image_filename, 
                    "image_base64": encoded_image
                })
        
    except Exception as e:
        result["error"] = str(e)
        print(f"Erro geral na extração Python: {e}", file=sys.stderr)
    
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx diretório_saída"}))
        sys.exit(1)
    excel_file_path = sys.argv[1]
    output_dir = sys.argv[2]
    extract_images_from_excel(excel_file_path, output_dir)
`;

  await writeFile(pythonScriptPath, pythonScript, 'utf-8');
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
 * Faz upload de imagem para o S3
 * @param imageBase64 Imagem em formato base64
 * @param originalImageName Nome original/base da imagem (ex: ABC123.png)
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns URL pública da imagem no S3
 */
async function uploadImageToS3(
  imageBase64: string,
  originalImageName: string,
  userId: string | number,
  catalogId: string | number
): Promise<string> {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const mimeType = 'image/png'; // O script python salva como png
    
    // Definir o caminho/chave no S3
    // Usar um padrão consistente: users/:userId/products/:catalogId/:imageName
    // Garantir que o nome seja único para evitar sobrescritas acidentais
    const uniqueFileName = `${Date.now()}-${originalImageName}`;
    const s3Key = `users/${userId}/products/${catalogId}/${uniqueFileName}`;
    
    console.log(`Fazendo upload para S3: Key=${s3Key}`);
    
    // Chamar a função de upload do s3-service
    const uploadResult = await uploadBufferToS3(imageBuffer, s3Key, mimeType);
    
    // uploadBufferToS3 deve retornar a URL pública ou a chave S3
    // Vamos assumir que retorna a URL pública diretamente (verificar s3-service.js se necessário)
    const publicUrl = uploadResult; // Ajustar se uploadResult for diferente
    
    console.log(`Upload para S3 bem-sucedido: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error(`Erro ao fazer upload da imagem ${originalImageName} para S3:`, error);
    throw error; // Propagar o erro para ser tratado no loop principal
  }
}

/**
 * Extrai imagens de um arquivo Excel, faz upload para S3 e retorna lista com URL e posição.
 * @param excelFilePath Caminho do arquivo Excel
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns {Promise<Array<{imageUrl: string, anchorRow: number}>>} Lista de objetos com URL da imagem S3 e linha de âncora.
 */
export async function extractAndUploadImagesWithPosition(
  excelFilePath: string,
  userId: string | number,
  catalogId: string | number
): Promise<{imageUrl: string, anchorRow: number}[]> {
  
  const imageDataList: {imageUrl: string, anchorRow: number}[] = [];
  try {
    console.log(`\n=== INICIANDO EXTRAÇÃO/UPLOAD DE IMAGENS COM POSIÇÃO ===`);
    console.log(`Arquivo: ${excelFilePath}`);

    // 1. Executar script Python para extrair imagens (base64, filename, e AGORA anchor_row)
    // Precisamos ajustar o script Python para também retornar a anchor_row!
    const pythonScriptPath = await createPythonScriptWithRowInfo(); // << NOVA FUNÇÃO para criar script python
    const extractionResult = await runPythonImageExtractorWithRowInfo(pythonScriptPath, excelFilePath); // << NOVA FUNÇÃO para rodar
    
    if (extractionResult.error) {
      console.error('Erro na extração de imagens via Python:', extractionResult.error);
      return imageDataList; 
    }
    
    const { images } = extractionResult;
    console.log(`Python extraiu ${images.length} imagens com info de linha.`);
    
    if (!images || images.length === 0) {
        console.log("Nenhuma imagem encontrada pelo script Python.");
        return imageDataList;
    }

    // 2. Processar e fazer upload de cada imagem para S3
    let uploadSuccessCount = 0;
    for (const imageData of images) {
      // AGORA esperamos anchor_row aqui!
      const { image_base64, image_filename, anchor_row } = imageData; 
      
      if (!image_base64 || !image_filename || typeof anchor_row !== 'number') { // Validar anchor_row
          console.warn("Dados incompletos ou anchor_row ausente para imagem, pulando:", imageData);
          continue;
      }

      try {
        // Usa o product_code (se encontrado) ou um nome genérico para o S3
        const productCode = imageData.product_code || `img_row_${anchor_row}`;
        const safeFileName = image_filename; // O nome já deve estar seguro

        const imageUrl = await uploadImageToS3(
          image_base64,
          safeFileName, // Usar o nome seguro gerado pelo Python
          userId,
          catalogId
        );
        
        // Adicionar à lista
        imageDataList.push({ imageUrl, anchorRow: anchor_row }); 
        uploadSuccessCount++;
        console.log(`Imagem da linha ${anchor_row} enviada para S3: ${imageUrl}`);

      } catch (uploadError) {
        console.error(`Falha no upload da imagem da linha ${anchor_row}.`, uploadError);
      }
    }
    
    console.log(`Upload de imagens concluído: ${uploadSuccessCount} de ${images.length} imagens enviadas.`);
    console.log(`=== FIM EXTRAÇÃO/UPLOAD DE IMAGENS COM POSIÇÃO ===`);
    return imageDataList; 

  } catch (error) {
    console.error('Erro CRÍTICO ao extrair/fazer upload de imagens com posição:', error);
    return imageDataList; 
  }
}

// *** NOVA FUNÇÃO para criar script Python que retorna anchor_row ***
async function createPythonScriptWithRowInfo() {
  const pythonScriptPath = path.join(PYTHON_SCRIPTS_DIR, 'extract_excel_images_row.py'); // Novo nome
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
                image_data = None; product_code = None; anchor_row = -1
                try:
                    anchor_row = image_obj.anchor.to.row + 1 # <<< OBTER A LINHA
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes): image_data = data_result
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                        image_data = image_obj._data
                    if not image_data: print(f"Falha Img {image_counter}: Dados binários inválidos.", file=sys.stderr); continue
                except Exception as data_err: print(f"Erro Img {image_counter}: {data_err}", file=sys.stderr); continue
                
                temp_image_name = f"temp_img_{image_counter}.png"
                temp_image_path = os.path.join(output_dir, temp_image_name)
                try:
                    with open(temp_image_path, "wb") as f: f.write(image_data)
                except Exception as write_err: print(f"Erro Img {image_counter}: Salvar temp: {write_err}", file=sys.stderr); continue 
                
                # Encontrar código (opcional, menos crítico agora)
                # ... (pode manter a lógica de busca de código aqui se quiser, mas não é essencial para o mapeamento)
                
                encoded_image = None
                try:
                    with open(temp_image_path, "rb") as image_file: encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
                except Exception as b64_err: print(f"Erro Img {image_counter}: Base64: {b64_err}", file=sys.stderr)
                finally:
                    if os.path.exists(temp_image_path): os.remove(temp_image_path)
                if not encoded_image: continue
                
                # Gerar nome final seguro
                # TERCEIRA TENTATIVA de Regex: Hífen escapado no final
                safe_product_code = re.sub(r'[^\w.\-]', '_', str(product_code)) 
                image_filename = f"{safe_product_code}.png"
                
                result["images"].append({
                    "image_filename": image_filename, 
                    "image_base64": encoded_image,
                    "anchor_row": anchor_row 
                })
    except Exception as e: result["error"] = str(e); print(f"Erro geral Python: {e}", file=sys.stderr)
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3: sys.exit(1)
    extract_images_from_excel(sys.argv[1], sys.argv[2])
`;
  await writeFile(pythonScriptPath, pythonScript, 'utf-8');
  return pythonScriptPath;
}

// *** NOVA FUNÇÃO para rodar o script Python que retorna anchor_row ***
async function runPythonImageExtractorWithRowInfo(pythonScriptPath: string, excelFilePath: string): Promise<any> {
  // A lógica é a mesma de runPythonImageExtractor, apenas chama o script correto
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [pythonScriptPath, excelFilePath, TEMP_IMAGES_DIR]);
    let dataString = ''; let errorString = '';
    pythonProcess.stdout.on('data', (data) => dataString += data.toString());
    pythonProcess.stderr.on('data', (data) => errorString += data.toString());
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('Erro no script Python (com row info):', errorString);
        // Retornar um objeto de erro em vez de rejeitar a promise inteira?
        resolve({ images: [], error: `Python script exited with code ${code}: ${errorString}` }); 
        return;
      }
      try {
        const result = JSON.parse(dataString);
        resolve(result);
      } catch (error) {
        console.error("Falha ao analisar saída do script Python (com row info):", dataString, error);
        resolve({ images: [], error: `Falha ao analisar saída JSON: ${error.message}` });
      }
    });
  });
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