#!/usr/bin/env python3
# -*- coding: utf-8 -*-

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
                          re.search(r'\.(png|jpe?g|gif|bmp|tiff|emf|wmf)$', f, re.IGNORECASE) and
                          ('xl/media/' in f or 'xl/drawings/' in f or 'word/media/' in f or 'ppt/media/' in f)]
            
            debug_log(f"Encontrados {len(image_paths)} arquivos de imagem no Excel")
            
            # Extrair cada imagem
            for img_index, img_path in enumerate(image_paths):
                try:
                    # Extrair o nome do arquivo
                    img_filename = os.path.basename(img_path)
                    # Remover caracteres problemáticos
                    safe_filename = re.sub(r'[^\w\-\.]', '_', img_filename)
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
                            img_refs = re.findall(r'Target="([^"]+\.(?:png|jpe?g|gif|bmp|tiff))"', rel_content)
                            
                            for img_ref in img_refs:
                                # Tentar construir o caminho completo
                                rel_dir = os.path.dirname(rel_file)
                                img_path = os.path.normpath(os.path.join(rel_dir, img_ref))
                                
                                try:
                                    with excel_zip.open(img_path) as img_file:
                                        img_data = img_file.read()
                                        img_filename = os.path.basename(img_path)
                                        safe_filename = re.sub(r'[^\w\-\.]', '_', img_filename)
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
                
                # Carregar workbook
                wb = openpyxl.load_workbook(excel_path)
                
                # Para cada planilha, extrair imagens
                for sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    
                    # Tentar acessar imagens usando _images (atributo interno)
                    if hasattr(sheet, '_images'):
                        debug_log(f"Usando sheet._images para {sheet_name}")
                        sheet_images = sheet._images
                        
                        for img_idx, img in enumerate(sheet_images):
                            try:
                                if hasattr(img, '_data') and isinstance(img._data, bytes):
                                    img_data = img._data
                                elif hasattr(img, 'data') and isinstance(img.data, bytes):
                                    img_data = img.data
                                else:
                                    debug_log(f"Imagem {img_idx} não tem dados acessíveis")
                                    continue
                                
                                if len(img_data) == 0:
                                    debug_log(f"Dados vazios para imagem {img_idx}")
                                    continue
                                
                                # Criar nome de arquivo
                                safe_filename = f"openpyxl_{sheet_name}_{img_idx}.png"
                                temp_path = os.path.join(output_dir, safe_filename)
                                
                                # Salvar no disco
                                with open(temp_path, 'wb') as out_file:
                                    out_file.write(img_data)
                                
                                # Converter para base64
                                img_base64 = base64.b64encode(img_data).decode('utf-8')
                                
                                # Adicionar ao resultado
                                result["images"].append({
                                    "image_path": temp_path,
                                    "image_filename": os.path.basename(temp_path),
                                    "original_path": f"{sheet_name}:image{img_idx}",
                                    "image_base64": img_base64,
                                    "index": len(result["images"]),
                                    "sheet": sheet_name
                                })
                                
                                debug_log(f"Imagem {img_idx} extraída com openpyxl de {sheet_name}")
                            except Exception as e:
                                debug_log(f"Erro ao extrair imagem {img_idx} com openpyxl: {str(e)}")
            except ImportError:
                debug_log("Pacote openpyxl não disponível")
            except Exception as e:
                debug_log(f"Erro ao usar openpyxl: {str(e)}")
        
        # Método 4: Último recurso - procurar por sequências de bytes de imagens comuns
        if len(result["images"]) == 0:
            debug_log("Método 4: Analisando bytes do arquivo buscando assinaturas de imagens...")
            try:
                # Ler todo o arquivo
                with open(excel_path, 'rb') as f:
                    file_data = f.read()
                
                # Assinaturas de formato de imagem comuns (magic numbers)
                signatures = {
                    b'\x89PNG\r\n\x1a\n': {'ext': 'png', 'header_size': 8},
                    b'\xff\xd8\xff': {'ext': 'jpg', 'header_size': 3},
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
                numbers = re.findall(r'\d+', image_filename)
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