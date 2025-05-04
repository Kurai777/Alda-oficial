import openpyxl, os, sys, json, base64
from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor, OneCellAnchor

def find_image_near_cell(sheet, target_row, target_col):
    """Encontra a primeira imagem cuja âncora está na linha/coluna alvo ou uma linha acima."""
    for img in sheet._images:
        try:
            anchor_row = img.anchor._from.row + 1
            anchor_col = img.anchor._from.col + 1
            
            # Verifica se âncora está na célula exata OU uma linha acima na mesma coluna
            if (anchor_row == target_row and anchor_col == target_col) or \
               (anchor_row == target_row - 1 and anchor_col == target_col):
                if hasattr(img, '_data') and callable(img._data):
                    data = img._data()
                    if isinstance(data, bytes): return data
                elif hasattr(img, '_data') and isinstance(img._data, bytes):
                    return img._data
        except Exception as e:
            print(f"Erro processando âncora de imagem: {e}", file=sys.stderr)
            continue
    return None

def extract_image_for_product(excel_file_path, product_info_json):
    result = {"product_row": None, "image_base64": None, "error": None}
    try:
        product_info = json.loads(product_info_json)
        target_row = product_info.get('excelRowNumber')
        image_cell = product_info.get('imageCell') # Ex: "F3"
        result["product_row"] = target_row

        if not target_row or not image_cell:
            result["error"] = "Informações do produto incompletas (excelRowNumber ou imageCell ausente)"
            print(json.dumps(result))
            return

        wb = openpyxl.load_workbook(excel_file_path)
        
        # Assume a primeira planilha por enquanto (poderia ser passado se necessário)
        # TODO: Considerar múltiplas planilhas se a estrutura do catálogo exigir
        sheet = wb.worksheets[0] 

        # Converte a referência da célula (ex: "F3") para coluna e linha
        try:
            target_col_letter, target_row_from_cell = coordinate_from_string(image_cell)
            target_col_index = column_index_from_string(target_col_letter)
            # Usar a target_row do produto_info como referência principal,
            # a linha da imageCell pode ser apenas uma dica de coluna.
        except ValueError:
             result["error"] = f"Referência de célula inválida fornecida pela IA: {image_cell}"
             print(json.dumps(result))
             return

        print(f"Buscando imagem para Produto Linha {target_row}, Célula Alvo {image_cell} (Col {target_col_index})", file=sys.stderr)

        image_data = find_image_near_cell(sheet, target_row, target_col_index)
        
        # Fallback: Se não achou na coluna exata, tentar coluna adjacente esquerda (E se F falhar)
        if not image_data and target_col_index > 1:
             print(f"Imagem não encontrada na Col {target_col_index}, tentando Col {target_col_index - 1}", file=sys.stderr)
             image_data = find_image_near_cell(sheet, target_row, target_col_index - 1)

        if image_data:
            try:
                result["image_base64"] = base64.b64encode(image_data).decode('utf-8')
                print(f"Imagem encontrada e codificada para produto linha {target_row}", file=sys.stderr)
            except Exception as encode_err:
                result["error"] = f"Erro ao codificar imagem: {encode_err}"
        else:
            result["error"] = f"Nenhuma imagem encontrada perto da linha {target_row} na coluna {target_col_letter} ou adjacente"
            print(f"AVISO: {result['error']}", file=sys.stderr)

    except Exception as e:
        result["error"] = f"Erro geral no Python: {e}"
        print(f"ERRO PYTHON: {e}", file=sys.stderr)
    
    print(json.dumps(result))

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos inválidos! Uso: python script.py arquivo_excel.xlsx 'json_produto'"}))
        sys.exit(1)
    
    excel_file_path = sys.argv[1]
    product_info_json = sys.argv[2]
    
    extract_image_for_product(excel_file_path, product_info_json) 