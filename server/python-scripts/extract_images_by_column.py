import openpyxl, os, sys, json, base64, re
from openpyxl.utils.cell import column_index_from_string

def extract_images_by_column(excel_file_path, image_column_letter):
    wb = openpyxl.load_workbook(excel_file_path)
    result = {"images": [], "error": None}
    try:
        image_col_index = column_index_from_string(image_column_letter)
        print(f"Buscando imagens na coluna: {image_column_letter} (Índice: {image_col_index})", file=sys.stderr)
        
        image_counter = 0
        images_found_in_column = 0
        
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            if not hasattr(sheet, '_images'): continue
            print(f"Verificando {len(sheet._images)} imagens na planilha '{sheet_name}'", file=sys.stderr)
            
            for image_obj in sheet._images:
                image_counter += 1
                image_data = None
                anchor_row = -1
                anchor_col = -1
                
                try:
                    # Obter a célula âncora superior esquerda
                    anchor_row = image_obj.anchor.to.row + 1 # +1 para ser 1-based
                    anchor_col = image_obj.anchor.to.col + 1 # +1 para ser 1-based
                    
                    # Verificar se a imagem está ancorada na coluna correta
                    if anchor_col != image_col_index:
                        #print(f"Img {image_counter}: Pulando - ancorada na coluna {anchor_col}, não na {image_col_index}", file=sys.stderr)
                        continue
                    
                    # Obter dados binários da imagem
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes): image_data = data_result
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                        image_data = image_obj._data
                    
                    if not image_data:
                        print(f"Falha Img {image_counter} na linha {anchor_row}: Dados binários inválidos.", file=sys.stderr)
                        continue
                        
                except Exception as data_err:
                    print(f"Erro ao processar metadados da Img {image_counter}: {data_err}", file=sys.stderr)
                    continue
                
                # Se chegou aqui, a imagem está na coluna correta e tem dados
                images_found_in_column += 1
                encoded_image = None
                try:
                    # Converter para base64
                    encoded_image = base64.b64encode(image_data).decode('utf-8')
                    result["images"].append({
                        "row_number": anchor_row,
                        "image_base64": encoded_image
                    })
                    print(f"Img {image_counter}: Extraído base64 da linha {anchor_row}", file=sys.stderr)
                except Exception as encode_err:
                     print(f"Erro ao codificar Img {image_counter} da linha {anchor_row}: {encode_err}", file=sys.stderr)

        print(f"Extração concluída. Total de imagens encontradas na coluna {image_column_letter}: {images_found_in_column}", file=sys.stderr)

    except Exception as e:
        result["error"] = str(e)
        print(f"Erro geral Python: {e}", file=sys.stderr)
    
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx LETRA_COLUNA"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    image_column_letter = sys.argv[2].upper() # Garante letra maiúscula
    
    extract_images_by_column(excel_file_path, image_column_letter) 