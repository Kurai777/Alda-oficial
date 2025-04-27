
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
                safe_product_code = re.sub(r'[^w.-]', '_', str(product_code)) 
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
