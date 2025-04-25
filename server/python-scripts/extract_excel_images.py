#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import openpyxl
import os
import sys
import json
import base64
import re
from PIL import Image as PILImage
import io
import zipfile
import tempfile

def extract_images_from_excel(excel_file_path, output_dir):
    """
    Extrai imagens de arquivo Excel usando múltiplos métodos para garantir compatibilidade
    
    Args:
        excel_file_path: Caminho para o arquivo Excel (.xlsx)
        output_dir: Diretório onde as imagens extraídas serão salvas
    
    Returns:
        Dados JSON com informações das imagens extraídas
    """
    # Criar diretório de saída se não existir
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    # Dados para retornar ao processo Node.js
    result = {
        "images": [],
        "error": None
    }
    
    try:
        # Método 1: Tentar usar a API do openpyxl
        extract_with_openpyxl(excel_file_path, output_dir, result)
        
        # Método 2: Se não encontrou imagens, tentar extrair diretamente do ZIP
        if len(result["images"]) == 0:
            extract_with_zipfile(excel_file_path, output_dir, result)
            
        print(f"Extraídas {len(result['images'])} imagens do Excel", file=sys.stderr)
        
    except Exception as e:
        result["error"] = str(e)
        print(f"Erro ao extrair imagens: {str(e)}", file=sys.stderr)
    
    # Retornar resultado como JSON
    print(json.dumps(result))
    return result

def extract_with_openpyxl(excel_file_path, output_dir, result):
    """
    Extrai imagens usando a API do openpyxl
    """
    try:
        # Abrir o arquivo Excel
        wb = openpyxl.load_workbook(excel_file_path)
        
        # Para cada planilha no arquivo
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            
            # Tentar diferentes atributos para acessar imagens
            images = []
            if hasattr(sheet, '_images'):
                images = sheet._images
            elif hasattr(sheet, 'images'):
                images = sheet.images
            elif hasattr(sheet, '_drawing'):
                if hasattr(sheet._drawing, 'images'):
                    images = sheet._drawing.images
            
            if not images:
                print(f"Nenhuma imagem encontrada na planilha {sheet_name} com openpyxl", file=sys.stderr)
                continue
                
            # Processar cada imagem
            for image_idx, image_tuple in enumerate(images):
                try:
                    # Tentar diferentes formas de acessar os dados da imagem
                    image_data = None
                    if hasattr(image_tuple, '_data') and isinstance(image_tuple._data, bytes):
                        image_data = image_tuple._data
                    elif hasattr(image_tuple, 'data') and isinstance(image_tuple.data, bytes):
                        image_data = image_tuple.data
                    elif hasattr(image_tuple, 'ref') and hasattr(image_tuple, 'blob') and isinstance(image_tuple.blob, bytes):
                        image_data = image_tuple.blob
                    
                    if not image_data or not isinstance(image_data, bytes):
                        print(f"Dados da imagem {image_idx} inválidos", file=sys.stderr)
                        continue
                    
                    # Gerar nome temporário para a imagem
                    temp_image_name = f"temp_image_{image_idx}.png"
                    temp_image_path = os.path.join(output_dir, temp_image_name)
                    
                    # Salvar imagem em disco temporariamente
                    with open(temp_image_path, "wb") as f:
                        f.write(image_data)
                    
                    # Tentar obter o código de produto da coluna F (6)
                    row = None
                    
                    # Tentar diferentes métodos para obter a posição da imagem
                    try:
                        if hasattr(image_tuple, 'anchor'):
                            if hasattr(image_tuple.anchor, 'to') and hasattr(image_tuple.anchor.to, 'row'):
                                row = image_tuple.anchor.to.row
                            elif hasattr(image_tuple.anchor, 'row'):
                                row = image_tuple.anchor.row
                    except:
                        pass
                    
                    # Buscar código do produto próximo à posição da imagem
                    product_code = find_product_code(sheet, row)
                    
                    # Processar a imagem extraída
                    process_extracted_image(temp_image_path, product_code, image_idx, output_dir, result)
                    
                except Exception as e:
                    print(f"Erro ao processar imagem {image_idx} com openpyxl: {str(e)}", file=sys.stderr)
                    
    except Exception as e:
        print(f"Erro no método openpyxl: {str(e)}", file=sys.stderr)

def extract_with_zipfile(excel_file_path, output_dir, result):
    """
    Extrai imagens tratando o arquivo Excel como um arquivo ZIP
    """
    try:
        # Criar diretório temporário
        temp_dir = tempfile.mkdtemp()
        
        # XLSX é um arquivo ZIP, extrair diretamente
        with zipfile.ZipFile(excel_file_path, 'r') as zip_ref:
            # Listar todos os arquivos que são imagens
            image_files = [f for f in zip_ref.namelist() if f.startswith('xl/media/')]
            
            if not image_files:
                print("Nenhuma imagem encontrada no arquivo ZIP", file=sys.stderr)
                return
                
            print(f"Encontradas {len(image_files)} imagens no arquivo ZIP", file=sys.stderr)
            
            # Para cada imagem encontrada
            for idx, image_file in enumerate(image_files):
                try:
                    # Extrair imagem para arquivo temporário
                    temp_image_path = os.path.join(temp_dir, f"temp_img_{idx}.png")
                    
                    with open(temp_image_path, 'wb') as f:
                        f.write(zip_ref.read(image_file))
                    
                    # Como não sabemos a posição, usar um código genérico
                    product_code = f"excel_image_{idx}"
                    
                    # Processar a imagem extraída
                    process_extracted_image(temp_image_path, product_code, idx, output_dir, result)
                    
                except Exception as e:
                    print(f"Erro ao processar imagem {idx} do ZIP: {str(e)}", file=sys.stderr)
        
        # Limpar diretório temporário
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
        
    except Exception as e:
        print(f"Erro no método zipfile: {str(e)}", file=sys.stderr)

def find_product_code(sheet, row):
    """
    Tenta encontrar o código do produto próximo à imagem
    """
    product_code = None
    
    # Se temos a linha, procurar o código próximo à imagem
    if row is not None:
        # Tentar usar a mesma linha
        code_cell = sheet.cell(row=row, column=6).value
        if code_cell:
            product_code = str(code_cell)
        else:
            # Tentar células adjacentes
            for r in range(max(1, row-3), min(sheet.max_row, row+3)):
                code_cell = sheet.cell(row=r, column=6).value
                if code_cell:
                    product_code = str(code_cell)
                    break
    
    # Se não achou, tentar procurar na coluna D (4) qualquer valor e pegar o código na mesma linha
    if not product_code:
        for r in range(2, sheet.max_row + 1):  # Começar da linha 2
            # Se há algum valor na coluna D (4) desta linha
            if sheet.cell(row=r, column=4).value:
                # Verificar o código na mesma linha
                code_cell = sheet.cell(row=r, column=6).value
                if code_cell:
                    product_code = str(code_cell)
                    break
    
    # Se ainda não achou, usar nome genérico
    if not product_code:
        product_code = f"unknown_product"
    
    return product_code

def process_extracted_image(temp_image_path, product_code, image_idx, output_dir, result):
    """
    Processa uma imagem extraída: renomeia, converte para base64, etc.
    """
    if not os.path.exists(temp_image_path):
        print(f"Arquivo temporário {temp_image_path} não existe", file=sys.stderr)
        return
    
    # Remover caracteres inválidos para nomes de arquivo
    safe_product_code = re.sub(r'[^\w\-\.]', '_', product_code)
    
    # Nome final da imagem
    image_filename = f"{safe_product_code}.png"
    image_path = os.path.join(output_dir, image_filename)
    
    # Se o arquivo já existe com esse nome, adicionar um sufixo
    suffix = 1
    while os.path.exists(image_path):
        image_filename = f"{safe_product_code}_{suffix}.png"
        image_path = os.path.join(output_dir, image_filename)
        suffix += 1
    
    # Renomear arquivo para o nome final
    import shutil
    shutil.copy2(temp_image_path, image_path)
    
    # Converter imagem para base64
    with open(image_path, "rb") as image_file:
        encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
    
    # Adicionar informações ao resultado
    result["images"].append({
        "product_code": product_code,
        "image_path": image_path,
        "image_filename": image_filename,
        "image_base64": encoded_image
    })
    
    print(f"Imagem extraída: {image_filename}", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx diretório_saída"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    extract_images_from_excel(excel_file_path, output_dir)