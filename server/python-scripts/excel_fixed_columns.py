#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import openpyxl
import os
import sys
import json
import base64
from PIL import Image
import io
import re

def extract_products_fixed_columns(excel_file_path, output_dir):
    """
    Extrai produtos do Excel usando um mapeamento fixo de colunas:
    A: nome
    B: local
    C: fornecedor
    E: quantidade
    F: código
    G: descrição
    L: preço (valor total)
    
    Também extrai imagens associadas e retorna a estrutura de dados completa.
    """
    # Abrir o arquivo Excel
    wb = openpyxl.load_workbook(excel_file_path, data_only=True)
    
    # Resultado para JSON
    result = {
        "products": [],
        "images": [],
        "errors": []
    }
    
    # Criar diretório de saída se não existir
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    try:
        # Para cada planilha no arquivo
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            
            # Extrair produtos da planilha
            try:
                row_products = extract_products_from_sheet(sheet)
                result["products"].extend(row_products)
                
                # Extrair imagens da planilha
                sheet_images = extract_images_from_sheet(sheet, output_dir)
                result["images"].extend(sheet_images)
                
                # Associar imagens com produtos por código
                associate_images_with_products(result["products"], result["images"])
                
            except Exception as e:
                result["errors"].append(f"Erro ao processar planilha {sheet_name}: {str(e)}")
    
    except Exception as e:
        result["errors"].append(f"Erro geral ao processar arquivo Excel: {str(e)}")
    
    # Retornar resultado como JSON
    print(json.dumps(result))
    return result

def extract_products_from_sheet(sheet):
    """
    Extrai produtos da planilha com mapeamento fixo de colunas.
    """
    products = []
    
    # Começar da linha 2 (pular cabeçalho)
    for row_idx in range(2, sheet.max_row + 1):
        # Ler valores das colunas específicas
        nome = sheet.cell(row=row_idx, column=1).value  # Coluna A
        local = sheet.cell(row=row_idx, column=2).value  # Coluna B
        fornecedor = sheet.cell(row=row_idx, column=3).value  # Coluna C
        quantidade = sheet.cell(row=row_idx, column=5).value  # Coluna E
        codigo = sheet.cell(row=row_idx, column=6).value  # Coluna F
        descricao = sheet.cell(row=row_idx, column=7).value  # Coluna G
        preco = sheet.cell(row=row_idx, column=12).value  # Coluna L
        
        # Pular linhas vazias ou com nome/código vazios
        if not nome or not codigo or nome == "_EMPTY_" or codigo == "_EMPTY_":
            continue
        
        # Formatar preço como "R$ XX.XXX,XX"
        preco_formatado = format_price(preco)
        
        # Criar produto
        produto = {
            "nome": nome,
            "local": local or "",
            "fornecedor": fornecedor or "",
            "codigo": str(codigo).strip(),
            "descricao": descricao or "",
            "quantidade": quantidade or 0,
            "preco": preco_formatado,
            "imagem": ""  # Será preenchido depois ao associar imagens
        }
        
        products.append(produto)
    
    return products

def format_price(price_value):
    """
    Formata o valor do preço como "R$ XX.XXX,XX"
    """
    if not price_value:
        return "R$ 0,00"
    
    try:
        # Converter para float se for string
        if isinstance(price_value, str):
            # Remover R$ e outros caracteres não numéricos exceto ponto e vírgula
            cleaned_value = price_value.replace("R$", "").replace(" ", "")
            # Substituir vírgula por ponto para conversão correta
            if "," in cleaned_value and "." in cleaned_value:
                # Formato brasileiro: 1.234,56
                cleaned_value = cleaned_value.replace(".", "").replace(",", ".")
            elif "," in cleaned_value:
                # Formato com vírgula como decimal: 1234,56
                cleaned_value = cleaned_value.replace(",", ".")
            
            price_float = float(cleaned_value)
        else:
            price_float = float(price_value)
        
        # Formatar como R$ XX.XXX,XX
        return f"R$ {price_float:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    
    except (ValueError, TypeError) as e:
        # Em caso de erro, retornar o valor original com prefixo R$
        return f"R$ {price_value}"

def extract_images_from_sheet(sheet, output_dir):
    """
    Extrai imagens da planilha.
    """
    images = []
    
    for image_idx, image_tuple in enumerate(sheet._images):
        try:
            # Acessar dados binários da imagem
            image_data = image_tuple._data
            
            # Gerar nome temporário para a imagem
            temp_image_name = f"temp_image_{image_idx}.png"
            temp_image_path = os.path.join(output_dir, temp_image_name)
            
            # Salvar imagem em disco temporariamente
            with open(temp_image_path, "wb") as f:
                f.write(image_data)
            
            # Encontrar células próximas à imagem
            row = image_tuple.anchor.to.row if hasattr(image_tuple.anchor, 'to') else 0
            col = image_tuple.anchor.to.col if hasattr(image_tuple.anchor, 'to') else 0
            
            # Buscar código na coluna F (coluna 6)
            codigo = None
            if row > 0:
                for r in range(max(1, row-3), min(sheet.max_row, row+3)):
                    codigo_cell = sheet.cell(row=r, column=6).value
                    if codigo_cell and str(codigo_cell).strip():
                        codigo = str(codigo_cell).strip()
                        break
            
            # Se não encontrou código, gerar nome único
            if not codigo:
                codigo = f"img_{image_idx}"
            
            # Remover caracteres inválidos do código para uso como nome de arquivo
            safe_codigo = re.sub(r'[^\w\-\.]', '_', codigo)
            
            # Definir nome e caminho final da imagem
            image_filename = f"{safe_codigo}.png"
            image_path = os.path.join(output_dir, image_filename)
            
            # Renomear ou copiar a imagem para o caminho final
            if os.path.exists(temp_image_path):
                # Se já existe arquivo com esse nome, adicionar sufixo
                suffix = 1
                base_path = image_path
                while os.path.exists(image_path):
                    image_filename = f"{safe_codigo}_{suffix}.png"
                    image_path = os.path.join(output_dir, image_filename)
                    suffix += 1
                
                # Copiar para o caminho final
                import shutil
                shutil.copy2(temp_image_path, image_path)
                
                # Remover arquivo temporário
                os.remove(temp_image_path)
            
            # Converter imagem para base64
            with open(image_path, "rb") as image_file:
                encoded_image = base64.b64encode(image_file.read()).decode('utf-8')
            
            # Adicionar à lista de imagens
            images.append({
                "codigo": codigo,
                "filename": image_filename,
                "path": image_path,
                "base64": encoded_image
            })
            
        except Exception as e:
            print(f"Erro ao processar imagem {image_idx}: {str(e)}", file=sys.stderr)
    
    return images

def associate_images_with_products(products, images):
    """
    Associa imagens aos produtos com base no código.
    """
    # Criar dicionário de imagens por código
    images_by_code = {}
    for img in images:
        images_by_code[img["codigo"]] = img
    
    # Associar imagens aos produtos
    for product in products:
        codigo = product["codigo"]
        if codigo in images_by_code:
            product["imagem"] = f"data:image/png;base64,{images_by_code[codigo]['base64']}"

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx diretório_saída"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    extract_products_fixed_columns(excel_file_path, output_dir)