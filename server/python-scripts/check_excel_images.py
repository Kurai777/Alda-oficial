
import openpyxl
import sys
import json

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
