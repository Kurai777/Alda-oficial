
import openpyxl, os, sys, json, base64

def extract_images(excel_file_path):
    wb = openpyxl.load_workbook(excel_file_path)
    result = {"images_base64": [], "error": None}
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
                    # Tentar acessar dados da imagem (callable ou atributo)
                    if hasattr(image_obj, '_data') and callable(image_obj._data):
                        data_result = image_obj._data()
                        if isinstance(data_result, bytes): image_data = data_result
                    elif hasattr(image_obj, '_data') and isinstance(image_obj._data, bytes):
                         image_data = image_obj._data
                    if not image_data: 
                         print(f"Img {image_counter}: Dados binários inválidos/ausentes.", file=sys.stderr)
                         continue
                    
                    # Converter para base64
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
