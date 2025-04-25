#!/usr/bin/env python3
"""
Mapeador de Imagens de Excel para Produtos
-------------------------------------------
Este script extrai todas as imagens de um arquivo Excel e cria um mapeamento
entre os produtos e suas respectivas imagens com base na posição.

A lógica implementada considera:
1. Cada imagem na célula D (coluna 4) corresponde ao produto na mesma linha
2. Extraímos cada imagem com um nome que preserva sua posição relativa na planilha
3. Geramos um arquivo JSON de mapeamento que o Node.js pode usar para associar corretamente as imagens
"""

import os
import sys
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
import tempfile
from pathlib import Path
from PIL import Image
from io import BytesIO

# Função principal: processar o arquivo Excel e extrair mapeamento de imagens
def process_excel_file(excel_path, output_dir):
    try:
        # Garantir que o diretório de saída exista
        os.makedirs(output_dir, exist_ok=True)
        
        # Nome base do arquivo para nomes de saída
        base_filename = os.path.basename(excel_path)
        base_name = os.path.splitext(base_filename)[0]
        
        # Dicionário para armazenar o mapeamento
        image_mapping = {
            "excel_file": base_filename,
            "extracted_time": "",
            "images": []
        }
        
        # Extrair o arquivo Excel (que é um arquivo ZIP)
        temp_dir = tempfile.mkdtemp()
        
        try:
            with zipfile.ZipFile(excel_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            
            # Analisar a pasta de mídias
            media_dir = os.path.join(temp_dir, 'xl', 'media')
            if not os.path.exists(media_dir):
                print(f"Nenhuma pasta de mídia encontrada no arquivo Excel")
                return {"error": "Nenhuma imagem encontrada no arquivo Excel"}
            
            # Mapear imagens em relação às células na coluna D
            worksheet_rels_dir = os.path.join(temp_dir, 'xl', 'worksheets', '_rels')
            if os.path.exists(worksheet_rels_dir):
                sheet_rels_files = [f for f in os.listdir(worksheet_rels_dir) if f.endswith('.xml.rels')]
                
                for sheet_rel_file in sheet_rels_files:
                    # Analisar arquivo de relações
                    sheet_rel_path = os.path.join(worksheet_rels_dir, sheet_rel_file)
                    tree = ET.parse(sheet_rel_path)
                    root = tree.getroot()
                    
                    # Namespace para XML
                    ns = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
                    
                    # Coletar todas as relações de imagem
                    for relationship in root.findall('.//r:Relationship', ns):
                        rel_type = relationship.get('Type')
                        if 'image' in rel_type:
                            rel_id = relationship.get('Id')
                            target = relationship.get('Target')
                            
                            # Extrair o nome do arquivo de imagem do caminho Target
                            image_filename = os.path.basename(target)
                            
                            # Verificar se o arquivo existe na pasta media
                            image_path = os.path.join(media_dir, image_filename)
                            if os.path.exists(image_path):
                                # Copiar imagem para o diretório de saída
                                new_image_name = f"img_{rel_id}_{image_filename}"
                                output_path = os.path.join(output_dir, new_image_name)
                                
                                # Copiar a imagem
                                try:
                                    shutil.copy2(image_path, output_path)
                                    print(f"Imagem extraída: {new_image_name}")
                                    
                                    # Adicionar ao mapeamento
                                    image_mapping["images"].append({
                                        "relationship_id": rel_id,
                                        "original_filename": image_filename,
                                        "extracted_filename": new_image_name,
                                        "path": os.path.join(output_dir, new_image_name)
                                    })
                                except Exception as copy_error:
                                    print(f"Erro ao copiar imagem {image_filename}: {copy_error}")
            
            # Encontrar arquivo de desenho para mapear células específicas
            drawings_dir = os.path.join(temp_dir, 'xl', 'drawings')
            if os.path.exists(drawings_dir):
                drawing_files = [f for f in os.listdir(drawings_dir) if f.endswith('.xml')]
                
                for drawing_file in drawing_files:
                    drawing_path = os.path.join(drawings_dir, drawing_file)
                    try:
                        tree = ET.parse(drawing_path)
                        root = tree.getroot()
                        
                        # Procurar todos os namespaces no arquivo XML
                        namespaces = dict([node for _, node in ET.iterparse(drawing_path, events=['start-ns'])])
                        
                        # Adicionar xdr namespace se não estiver presente
                        if 'xdr' not in namespaces:
                            namespaces['xdr'] = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
                        
                        # Mapear imagens para células
                        for anchor in root.findall('.//xdr:oneCellAnchor', namespaces):
                            # Pegar a referência da célula
                            from_cell = anchor.find('.//xdr:from', namespaces)
                            if from_cell is not None:
                                col = from_cell.find('.//xdr:col', namespaces)
                                row = from_cell.find('.//xdr:row', namespaces)
                                
                                if col is not None and row is not None:
                                    col_num = int(col.text)
                                    row_num = int(row.text) + 1  # Rows are 0-indexed in XML
                                    
                                    # Se a imagem estiver na coluna D (índice 3)
                                    if col_num == 3:  # Coluna D é índice 3 (0-indexed)
                                        # Encontrar ID da imagem vinculada
                                        blip = anchor.find('.//a:blip', namespaces)
                                        if blip is not None:
                                            embed = blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                                            
                                            # Atualizar o mapeamento para esta imagem
                                            for img in image_mapping["images"]:
                                                if img["relationship_id"] == embed:
                                                    img["cell"] = f"D{row_num}"
                                                    img["row"] = row_num
                                                    img["column"] = "D"
                                                    img["column_index"] = 4  # Coluna D é a 4ª coluna
                                                    break
                    except Exception as drawing_error:
                        print(f"Erro ao processar desenho {drawing_file}: {drawing_error}")
            
            # Salvar o mapeamento como JSON
            mapping_file = os.path.join(output_dir, f"{base_name}_image_mapping.json")
            with open(mapping_file, 'w', encoding='utf-8') as f:
                json.dump(image_mapping, f, ensure_ascii=False, indent=2)
            
            print(f"Mapeamento de imagens criado em: {mapping_file}")
            return image_mapping
            
        finally:
            # Limpar diretório temporário
            shutil.rmtree(temp_dir)
    
    except Exception as e:
        print(f"Erro ao processar arquivo Excel: {str(e)}")
        return {"error": str(e)}

# Executar se chamado diretamente
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python map_excel_images.py <arquivo_excel> <diretorio_saida>")
        sys.exit(1)
    
    excel_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    process_excel_file(excel_path, output_dir)