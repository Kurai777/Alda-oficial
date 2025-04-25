
import openpyxl
import os
import sys
import json
import base64
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
                safe_product_code = product_code.replace('/', '_').replace('\\', '_').replace(' ', '_')
                
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
