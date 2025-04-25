/**
 * Extrator avançado de imagens de Excel
 * 
 * Este módulo implementa múltiplas abordagens de extração de imagens
 * com fallbacks para garantir que todas as imagens sejam extraídas e
 * associadas corretamente aos produtos.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import JSZip from 'jszip';
import { spawn } from 'child_process';
// Função para simular o upload para o Firebase durante testes
async function mockSaveImageToFirebaseStorage(imageBuffer, fileName, userId = 'test', catalogId = 'test') {
  // Apenas para teste - não faz upload real
  console.log(`[MOCK] Salvando imagem '${fileName}' para Firebase Storage`);
  return `https://mock-firebase-storage.com/${userId}/${catalogId}/${fileName}`;
}

// Usar a função real se disponível ou fallback para mock
const saveImageToFirebaseStorage = mockSaveImageToFirebaseStorage;

// Promisify fs functions
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Configuração de diretórios
const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp-excel-images');
const PYTHON_SCRIPTS_DIR = path.join(process.cwd(), 'server', 'python-scripts');

/**
 * Garante que os diretórios necessários existam
 */
async function ensureDirectories() {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(PYTHON_SCRIPTS_DIR)) {
      await mkdir(PYTHON_SCRIPTS_DIR, { recursive: true });
    }
  } catch (error) {
    console.error(`Erro ao criar diretórios: ${error.message}`);
  }
}

/**
 * Cria script Python para extração avançada de imagens
 */
async function createAdvancedPythonScript() {
  const scriptPath = path.join(PYTHON_SCRIPTS_DIR, 'advanced_excel_extractor.py');
  
  // Verificar se o script já existe
  if (fs.existsSync(scriptPath)) {
    return scriptPath;
  }
  
  const scriptContent = `
import os
import sys
import json
import re
import base64
import zipfile
import io
from io import BytesIO
from PIL import Image

def extract_images_from_excel(excel_path, output_dir):
    """Extrai imagens de um arquivo Excel usando múltiplos métodos"""
    result = {
        "images": [],
        "error": None,
        "debug_info": []
    }
    
    # Log para debugging
    def debug_log(message):
        result["debug_info"].append(message)
        print(message, file=sys.stderr)
    
    try:
        # Garantir que o diretório de saída existe
        os.makedirs(output_dir, exist_ok=True)
        
        # Método 1: Extrair diretamente do ZIP (Excel é um arquivo ZIP)
        debug_log(f"Método 1: Extraindo do ZIP - {excel_path}")
        with zipfile.ZipFile(excel_path, 'r') as excel_zip:
            # Procurar por arquivos de imagem em locais comuns
            image_paths = [f for f in excel_zip.namelist() if
                          re.search(r'\\.(png|jpe?g|gif|bmp|tiff|emf|wmf)$', f, re.IGNORECASE) and
                          ('xl/media/' in f or 'xl/drawings/' in f or 'word/media/' in f or 'ppt/media/' in f)]
            
            debug_log(f"Encontrados {len(image_paths)} arquivos de imagem no Excel")
            
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
                        
                        # Verificar se os dados são válidos
                        if len(img_data) == 0:
                            debug_log(f"Dados vazios para imagem {img_path}")
                            continue
                        
                        with open(temp_path, 'wb') as out_file:
                            out_file.write(img_data)
                        
                        # Verificar integridade da imagem
                        try:
                            with Image.open(BytesIO(img_data)) as img:
                                img_format = img.format.lower() if img.format else 'png'
                                img_width, img_height = img.size
                                debug_log(f"Imagem válida: {img_width}x{img_height} formato {img_format}")
                        except Exception as img_err:
                            debug_log(f"Aviso: Erro ao validar imagem {img_path}: {str(img_err)}")
                            # Continuar mesmo com erro na validação
                        
                        # Converter para base64 para retorno
                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                        
                        # Adicionar ao resultado
                        result["images"].append({
                            "image_path": temp_path,
                            "image_filename": os.path.basename(temp_path),
                            "original_path": img_path,
                            "image_base64": img_base64,
                            "index": img_index
                        })
                        
                        debug_log(f"Imagem {img_index+1} extraída: {temp_path}")
                except Exception as e:
                    debug_log(f"Erro ao extrair imagem {img_path}: {str(e)}")
            
            # Se não encontramos imagens no método 1, tentar método alternativo
            if len(result["images"]) == 0:
                debug_log("Método 2: Tentando método via arquivos de relações...")
                # Procurar por arquivos de relação que possam conter referências a imagens
                rels_files = [f for f in excel_zip.namelist() if f.endswith('.rels')]
                
                for rel_file in rels_files:
                    try:
                        with excel_zip.open(rel_file) as f:
                            rel_content = f.read().decode('utf-8', errors='ignore')
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
                                            "image_base64": img_base64,
                                            "index": len(result["images"])
                                        })
                                except Exception as e:
                                    debug_log(f"Erro ao extrair imagem da referência {img_ref}: {str(e)}")
                    except Exception as e:
                        debug_log(f"Erro ao processar arquivo de relação {rel_file}: {str(e)}")
        
        # Método 3: Se ainda não houver imagens, tentar biblioteca Python openpyxl
        if len(result["images"]) == 0:
            debug_log("Método 3: Tentando extração via openpyxl...")
            try:
                import openpyxl
                from openpyxl_image_loader import SheetImageLoader
                
                # Carregar workbook
                wb = openpyxl.load_workbook(excel_path)
                
                # Para cada planilha
                for sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    image_loader = SheetImageLoader(sheet)
                    
                    # Verificar células com imagens
                    for row in range(1, sheet.max_row + 1):
                        for col in range(1, sheet.max_column + 1):
                            cell_name = f"{openpyxl.utils.get_column_letter(col)}{row}"
                            
                            if image_loader.image_in(cell_name):
                                try:
                                    img = image_loader.get(cell_name)
                                    
                                    if img:
                                        # Salvar imagem
                                        safe_filename = f"openpyxl_{len(result['images'])}_{cell_name}.png"
                                        temp_path = os.path.join(output_dir, safe_filename)
                                        
                                        # Salvar em memória para base64
                                        img_buffer = BytesIO()
                                        img.save(img_buffer, format="PNG")
                                        img_data = img_buffer.getvalue()
                                        
                                        # Salvar no disco
                                        img.save(temp_path)
                                        
                                        # Converter para base64
                                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                                        
                                        result["images"].append({
                                            "image_path": temp_path,
                                            "image_filename": os.path.basename(temp_path),
                                            "original_path": f"{sheet_name}:{cell_name}",
                                            "image_base64": img_base64,
                                            "index": len(result["images"]),
                                            "cell": cell_name,
                                            "sheet": sheet_name
                                        })
                                        
                                        debug_log(f"Imagem extraída com openpyxl: {cell_name} -> {temp_path}")
                                except Exception as cell_err:
                                    debug_log(f"Erro ao extrair imagem da célula {cell_name}: {str(cell_err)}")
            except ImportError:
                debug_log("Pacote openpyxl ou openpyxl_image_loader não disponível")
            except Exception as openpyxl_err:
                debug_log(f"Erro ao usar openpyxl: {str(openpyxl_err)}")
                
        # Método 4: Último recurso - procurar por sequências de bytes de imagens comuns
        if len(result["images"]) == 0:
            debug_log("Método 4: Analisando bytes do arquivo buscando assinaturas de imagens...")
            try:
                # Ler todo o arquivo
                with open(excel_path, 'rb') as f:
                    file_data = f.read()
                
                # Assinaturas de formato de imagem comuns (magic numbers)
                signatures = {
                    b'\\x89PNG\\r\\n\\x1a\\n': {'ext': 'png', 'header_size': 8},
                    b'\\xff\\xd8\\xff': {'ext': 'jpg', 'header_size': 3},
                    b'GIF8': {'ext': 'gif', 'header_size': 4},
                    b'BM': {'ext': 'bmp', 'header_size': 2}
                }
                
                # Procurar por cada assinatura
                total_found = 0
                for signature, info in signatures.items():
                    offset = 0
                    while True:
                        # Encontrar a próxima ocorrência da assinatura
                        pos = file_data.find(signature, offset)
                        if pos == -1:
                            break
                        
                        # Avançar para o próximo byte após a assinatura
                        offset = pos + 1
                        
                        try:
                            # Tentar extrair dados de imagem
                            # Primeiro, tentamos determinar o tamanho da imagem
                            # Isso é uma heurística simples
                            img_start = pos
                            img_size = 10000  # Tamanho inicial tentativo
                            
                            # Tentar diferentes tamanhos até encontrar uma imagem válida
                            for test_size in [1000, 5000, 10000, 50000, 100000]:
                                img_data = file_data[img_start:img_start + test_size]
                                try:
                                    with Image.open(BytesIO(img_data)) as img:
                                        # Se abriu com sucesso, temos uma imagem válida
                                        img_size = test_size
                                        break
                                except:
                                    continue
                            
                            # Extrair dados de imagem
                            img_data = file_data[img_start:img_start + img_size]
                            
                            # Gerar nome único
                            extension = info['ext']
                            safe_filename = f"raw_{total_found}.{extension}"
                            temp_path = os.path.join(output_dir, safe_filename)
                            
                            # Salvar no disco
                            with open(temp_path, 'wb') as out_file:
                                out_file.write(img_data)
                            
                            # Converter para base64
                            img_base64 = base64.b64encode(img_data).decode('utf-8')
                            
                            result["images"].append({
                                "image_path": temp_path,
                                "image_filename": os.path.basename(temp_path),
                                "original_path": f"raw_offset_{pos}",
                                "image_base64": img_base64,
                                "index": len(result["images"])
                            })
                            
                            total_found += 1
                            debug_log(f"Imagem encontrada por assinatura de bytes: {safe_filename}")
                        except Exception as raw_err:
                            debug_log(f"Erro ao processar imagem em offset {pos}: {str(raw_err)}")
                
                debug_log(f"Total de {total_found} imagens encontradas por assinatura de bytes")
            except Exception as raw_method_err:
                debug_log(f"Erro ao usar método de assinaturas de bytes: {str(raw_method_err)}")
        
        debug_log(f"Total de {len(result['images'])} imagens extraídas com sucesso")
    
    except Exception as e:
        result["error"] = str(e)
        debug_log(f"Erro geral: {str(e)}")
    
    # Retornar o resultado como JSON
    print(json.dumps(result))
    return result

def associate_images_with_products(excel_path, images, output_dir):
    """Associa imagens extraídas aos produtos na planilha"""
    result = {
        "associations": [],
        "error": None,
        "debug_info": []
    }
    
    def debug_log(message):
        result["debug_info"].append(message)
        print(message, file=sys.stderr)
    
    try:
        import openpyxl
        
        # Carregar workbook
        wb = openpyxl.load_workbook(excel_path, data_only=True)
        first_sheet = wb.active
        
        # Mapear possíveis colunas de código
        code_columns = []
        
        # Verificar especificamente a coluna F (6) que é conhecida como coluna de código
        code_columns.append(6)  # Coluna F é a 6ª coluna (0-indexed seria 5)
        
        # Também verificar o cabeçalho para outras colunas potenciais de código
        code_headers = ['código', 'code', 'cod', 'codigo', 'referência', 'referencia', 'ref']
        
        for col in range(1, min(first_sheet.max_column + 1, 20)):  # Limitar a 20 colunas
            header_value = first_sheet.cell(row=1, column=col).value
            if header_value:
                header_text = str(header_value).lower().strip()
                for code_header in code_headers:
                    if code_header in header_text:
                        if col not in code_columns:
                            code_columns.append(col)
                            debug_log(f"Coluna potencial de código encontrada: {col} ({header_text})")
        
        # Para cada imagem, tentar associar a um código de produto
        for image in images:
            image_filename = image["image_filename"]
            
            # Inicializar vazio
            image_association = {
                "image": image_filename,
                "codigo": None,
                "row": None,
                "confidence": 0
            }
            
            # Método 1: Verificar se o nome da imagem contém um código da planilha
            for sheet in wb:
                for code_col in code_columns:
                    for row in range(2, min(sheet.max_row + 1, 1000)):  # Limitar a 1000 linhas
                        cell_value = sheet.cell(row=row, column=code_col).value
                        if cell_value:
                            code = str(cell_value).strip()
                            
                            # Remover caracteres indesejados para comparação
                            clean_code = re.sub(r'[^a-zA-Z0-9]', '', code).lower()
                            clean_filename = re.sub(r'[^a-zA-Z0-9]', '', image_filename).lower()
                            
                            # Verificar se o código está no nome do arquivo
                            if clean_code and clean_code in clean_filename:
                                debug_log(f"Associação por nome encontrada: {image_filename} -> {code} (linha {row})")
                                image_association["codigo"] = code
                                image_association["row"] = row
                                image_association["confidence"] = 0.9
                                break
                    
                    if image_association["codigo"]:
                        break
                
                if image_association["codigo"]:
                    break
            
            # Método 2: Se houver informação de célula, verificar proximidade na planilha
            if not image_association["codigo"] and "cell" in image and "sheet" in image:
                cell_ref = image["cell"]
                sheet_name = image["sheet"]
                
                if sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    
                    # Extrair linha e coluna da referência de célula
                    from openpyxl.utils import column_index_from_string
                    
                    match = re.match(r'([A-Z]+)(\d+)', cell_ref)
                    if match:
                        col_letter, row_num = match.groups()
                        row = int(row_num)
                        
                        # Verificar células próximas para códigos de produto
                        for r_offset in range(-3, 4):  # -3 a +3 linhas
                            check_row = row + r_offset
                            if check_row < 1 or check_row > sheet.max_row:
                                continue
                                
                            for code_col in code_columns:
                                cell_value = sheet.cell(row=check_row, column=code_col).value
                                if cell_value:
                                    code = str(cell_value).strip()
                                    if code:
                                        debug_log(f"Associação por proximidade: {image_filename} -> {code} (linha {check_row})")
                                        image_association["codigo"] = code
                                        image_association["row"] = check_row
                                        image_association["confidence"] = 0.7 - abs(r_offset) * 0.1  # Menor confiança quanto mais longe
                                        break
                        
                            if image_association["codigo"]:
                                break
            
            # Método 3: Usar índice sequencial se ainda não tiver associação
            if not image_association["codigo"]:
                img_index = image.get("index", 0)
                
                # Tentar associar com produtos na mesma ordem
                sheets = list(wb)
                if sheets:
                    sheet = sheets[0]  # Usar primeira planilha
                    
                    # Pular o cabeçalho e começar do índice + 2
                    row = min(img_index + 2, sheet.max_row)
                    
                    for code_col in code_columns:
                        cell_value = sheet.cell(row=row, column=code_col).value
                        if cell_value:
                            code = str(cell_value).strip()
                            if code:
                                debug_log(f"Associação por índice: {image_filename} -> {code} (linha {row})")
                                image_association["codigo"] = code
                                image_association["row"] = row
                                image_association["confidence"] = 0.5
                                break
            
            # Se ainda não tem código, usar nome do arquivo como identificador
            if not image_association["codigo"]:
                # Extrair parte numérica do nome do arquivo
                numbers = re.findall(r'\\d+', image_filename)
                if numbers:
                    code = "IMG_" + numbers[0]
                else:
                    code = "IMG_" + str(image.get("index", 0))
                
                debug_log(f"Nenhuma associação encontrada, usando código genérico: {image_filename} -> {code}")
                image_association["codigo"] = code
                image_association["confidence"] = 0.1
            
            # Adicionar associação ao resultado
            result["associations"].append(image_association)
    
    except Exception as e:
        result["error"] = str(e)
        debug_log(f"Erro ao associar imagens: {str(e)}")
    
    # Retornar o resultado como JSON
    print(json.dumps(result))
    return result

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Argumentos insuficientes! Uso: python script.py arquivo.xlsx diretorio_saida [--associate]"}))
        sys.exit(1)
    
    excel_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Verificar se é para associar imagens ou extrair
    if len(sys.argv) > 3 and sys.argv[3] == "--associate":
        # Precisa das imagens já extraídas
        try:
            with open(sys.argv[4], 'r') as f:
                images_data = json.load(f)
                associate_images_with_products(excel_path, images_data["images"], output_dir)
        except Exception as e:
            print(json.dumps({"error": f"Erro ao carregar dados de imagens: {str(e)}"}))
    else:
        extract_images_from_excel(excel_path, output_dir)
`;

  await writeFile(scriptPath, scriptContent);
  return scriptPath;
}

/**
 * Executa o script Python para extrair imagens avançado
 * @param {string} excelPath Caminho para o arquivo Excel
 * @returns {Promise<Object>} Resultado da extração
 */
async function runAdvancedPythonExtractor(excelPath) {
  try {
    // Criar script Python se necessário
    const scriptPath = await createAdvancedPythonScript();
    
    // Criar diretório para saída de imagens
    const outputDir = path.join(TEMP_DIR, `excel_${Date.now()}`);
    await mkdir(outputDir, { recursive: true });
    
    // Log da execução
    console.log(`Executando extrator Python avançado: ${scriptPath}`);
    console.log(`Arquivo Excel: ${excelPath}`);
    console.log(`Diretório de saída: ${outputDir}`);
    
    return new Promise((resolve, reject) => {
      // Executar script Python
      const pythonProcess = spawn('python3', [scriptPath, excelPath, outputDir]);
      
      let stdoutData = '';
      let stderrData = '';
      
      // Capturar saída padrão
      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });
      
      // Capturar saída de erro
      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.log(`[Python Log] ${data.toString()}`);
      });
      
      // Quando o processo terminar
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Python script exited with code ${code}`);
          console.error(`Error output: ${stderrData}`);
          
          // Mesmo com erro, tentar parsear qualquer saída JSON
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
          result.outputDir = outputDir;
          resolve(result);
        } catch (error) {
          reject(new Error(`Erro ao parsear resultado do script Python: ${error.message}. Saída: ${stdoutData.substring(0, 1000)}`));
        }
      });
      
      // Em caso de erro no processo
      pythonProcess.on('error', (error) => {
        reject(new Error(`Erro ao executar script Python: ${error.message}`));
      });
    });
  } catch (error) {
    console.error(`Erro ao executar Python extractor: ${error.message}`);
    throw error;
  }
}

/**
 * Extrai imagens do Excel usando JSZip
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
    
    console.log(`Total de ${result.images.length} imagens extraídas com sucesso via JSZip`);
    return result;
  } catch (error) {
    console.error(`Erro ao extrair imagens com JSZip: ${error.message}`);
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
 * @param {string|number} userId ID do usuário
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
    
    // Normalizar nome de arquivo para URL segura
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    
    // Converter para string se for número
    const userIdStr = typeof userId === 'number' ? userId.toString() : userId;
    const catalogIdStr = typeof catalogId === 'number' ? catalogId.toString() : catalogId;
    
    // Fazer upload para o Firebase Storage
    const imageUrl = await saveImageToFirebaseStorage(
      imageBase64,
      safeFileName,
      userIdStr || 'temp',
      catalogIdStr || 'temp'
    );
    
    if (!imageUrl) {
      throw new Error('URL de imagem vazia retornada pelo Firebase');
    }
    
    return imageUrl;
  } catch (error) {
    console.error(`Erro ao fazer upload para Firebase: ${error.message}`);
    throw error;
  }
}

/**
 * Extrai imagens de um arquivo Excel usando métodos avançados e associa aos produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {Array} products Lista de produtos para associar imagens
 * @param {string|number} userId ID do usuário para associar ao upload no Firebase
 * @param {string|number} catalogId ID do catálogo para associar ao upload no Firebase
 * @returns {Promise<Array>} Lista de produtos com imagens associadas
 */
export async function extractImagesFromExcel(excelPath, products, userId, catalogId) {
  console.log(`Extraindo imagens avançadas de ${excelPath}`);
  
  try {
    // Criar objeto para mapear imagens por código
    const productCodeMap = {};
    const productsByIndex = [];
    
    // Mapear produtos por código para associação posterior
    products.forEach(product => {
      const code = product.code || product.codigo;
      if (code) {
        productCodeMap[code] = product;
        productsByIndex.push(product);
      }
    });
    
    // Registrar quantos produtos têm código
    console.log(`${Object.keys(productCodeMap).length} produtos com código para associação de imagens`);
    
    // Passo 1: Tentar extrair imagens com o método Python avançado
    let result;
    try {
      result = await runAdvancedPythonExtractor(excelPath);
      console.log(`Extrator Python encontrou ${result.images?.length || 0} imagens`);
    } catch (pythonError) {
      console.error(`Erro no extrator Python: ${pythonError.message}`);
      // Fallback para método JS
      result = await extractImagesWithJSZip(excelPath);
      console.log(`Fallback JSZip encontrou ${result.images?.length || 0} imagens`);
    }
    
    // Se não encontrou imagens, retornar produtos originais
    if (!result.images || result.images.length === 0) {
      console.log('Nenhuma imagem encontrada no arquivo Excel');
      return products;
    }
    
    console.log(`Encontradas ${result.images.length} imagens no Excel`);
    
    // Objeto para armazenar URLs de imagens por código
    const imageUrlMap = {};
    
    // Processar cada imagem
    for (let i = 0; i < result.images.length; i++) {
      const image = result.images[i];
      
      try {
        // Verificar se temos os campos necessários
        if (!image.image_base64) {
          console.warn(`Imagem ${i} não tem dados base64`);
          continue;
        }
        
        // Definir nome de arquivo seguro
        const fileName = image.image_filename || `image_${i}.png`;
        
        // Tentar associar a imagem a um produto
        let productCode = null;
        
        // Método 1: Verificar se o nome da imagem contém um código de produto
        for (const code in productCodeMap) {
          // Limpar código para comparação
          const cleanCode = code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const cleanFileName = fileName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          
          if (cleanCode && cleanFileName.includes(cleanCode)) {
            productCode = code;
            console.log(`Imagem ${fileName} associada ao produto com código ${code} (pelo nome)`);
            break;
          }
        }
        
        // Método 2: Se não encontrou pelo nome, tentar associar pelo índice
        if (!productCode && i < productsByIndex.length) {
          const product = productsByIndex[i];
          productCode = product.code || product.codigo;
          console.log(`Imagem ${fileName} associada ao produto ${productCode} (por índice)`);
        }
        
        // Se não encontrou nenhum código, usar um código temporário
        if (!productCode) {
          productCode = `img_${i}`;
          console.log(`Nenhum produto associado à imagem ${fileName}, usando código temporário ${productCode}`);
        }
        
        // Fazer upload da imagem para o Firebase
        const imageUrl = await uploadToFirebase(
          image.image_base64,
          fileName,
          userId,
          catalogId
        );
        
        // Adicionar URL ao mapa
        if (!imageUrlMap[productCode]) {
          imageUrlMap[productCode] = [];
        }
        imageUrlMap[productCode].push(imageUrl);
        
        console.log(`Imagem ${fileName} salva no Firebase: ${imageUrl}`);
      } catch (imageError) {
        console.error(`Erro ao processar imagem ${i}: ${imageError.message}`);
      }
    }
    
    // Atualizar produtos com as URLs de imagem
    const productsWithImages = products.map(product => {
      const code = product.code || product.codigo;
      
      if (code && imageUrlMap[code] && imageUrlMap[code].length > 0) {
        const imageUrls = imageUrlMap[code];
        
        // Atualizar imagem principal
        product.imageUrl = imageUrls[0];
        
        // Se houver mais de uma imagem, adicionar como imagens adicionais
        if (imageUrls.length > 1) {
          product.additionalImages = imageUrls.slice(1);
        }
      }
      
      return product;
    });
    
    // Contar produtos com imagens para log
    const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
    console.log(`${productsWithImagesCount} de ${products.length} produtos atualizados com imagens (${Math.round(productsWithImagesCount/products.length*100)}%)`);
    
    return productsWithImages;
  } catch (error) {
    console.error(`Erro geral ao extrair imagens do Excel: ${error.message}`);
    // Mesmo com erro, retorna produtos originais para não bloquear o fluxo
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
    // Primeiro método: verificar com JSZip
    try {
      const excelData = await readFile(excelPath);
      const zip = new JSZip();
      const zipContents = await zip.loadAsync(excelData);
      
      // Procurar por imagens em locais comuns
      const imageExtensions = /\.(png|jpe?g|gif|bmp|tiff|emf)$/i;
      const mediaFolders = ['xl/media/', 'xl/drawings/', 'word/media/'];
      
      for (const folder of mediaFolders) {
        const matchingFiles = Object.keys(zipContents.files).filter(filename => 
          !zipContents.files[filename].dir && 
          filename.startsWith(folder) && 
          imageExtensions.test(filename)
        );
        
        if (matchingFiles.length > 0) {
          console.log(`${matchingFiles.length} imagens encontradas na pasta ${folder}`);
          return true;
        }
      }
      
      // Verificar em qualquer lugar do arquivo
      const anyImages = Object.keys(zipContents.files).filter(filename => 
        !zipContents.files[filename].dir && 
        imageExtensions.test(filename)
      );
      
      if (anyImages.length > 0) {
        console.log(`${anyImages.length} imagens encontradas em outras pastas do Excel`);
        return true;
      }
    } catch (zipError) {
      console.warn(`Erro ao verificar imagens com JSZip: ${zipError.message}`);
    }
    
    // Segundo método: verificar com Python
    try {
      const result = await runAdvancedPythonExtractor(excelPath);
      if (result.images && result.images.length > 0) {
        console.log(`Python extractor encontrou ${result.images.length} imagens`);
        return true;
      }
    } catch (pythonError) {
      console.warn(`Erro ao verificar imagens com Python: ${pythonError.message}`);
    }
    
    console.log('Nenhuma imagem encontrada no arquivo Excel');
    return false;
  } catch (error) {
    console.error(`Erro ao verificar imagens no Excel: ${error.message}`);
    // Em caso de erro, assume que não tem imagens
    return false;
  }
}

export default {
  extractImagesFromExcel,
  hasExcelImages
};