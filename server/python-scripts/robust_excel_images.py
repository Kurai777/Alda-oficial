import os
import sys
import json
import re
import base64
import zipfile
from io import BytesIO
from PIL import Image

def extract_images_from_excel(excel_path, output_dir):
    """Extrai imagens de um arquivo Excel usando múltiplos métodos"""
    result = {
        "images": [],
        "error": None
    }
    
    try:
        # Garantir que o diretório de saída existe
        os.makedirs(output_dir, exist_ok=True)
        
        # Método 1: Extrair diretamente do ZIP (Excel é um arquivo ZIP)
        with zipfile.ZipFile(excel_path, 'r') as excel_zip:
            # Procurar por arquivos de imagem em locais comuns
            image_paths = [f for f in excel_zip.namelist() if
                          re.search(r'\.(png|jpe?g|gif|bmp|tiff|emf)$', f, re.IGNORECASE) and
                          ('xl/media/' in f or 'xl/drawings/' in f or 'word/media/' in f)]
            
            print(f"Encontrados {len(image_paths)} arquivos de imagem no Excel")
            
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
                        
                        with open(temp_path, 'wb') as out_file:
                            out_file.write(img_data)
                        
                        # Converter para base64 para retorno
                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                        
                        # Adicionar ao resultado
                        result["images"].append({
                            "image_path": temp_path,
                            "image_filename": os.path.basename(temp_path),
                            "original_path": img_path,
                            "image_base64": img_base64
                        })
                        
                        print(f"Imagem {img_index+1} extraída: {temp_path}")
                except Exception as e:
                    print(f"Erro ao extrair imagem {img_path}: {str(e)}")
            
            # Se não encontramos imagens no método 1, tentar método alternativo
            if len(result["images"]) == 0:
                print("Tentando método alternativo de extração...")
                # Procurar por arquivos de relação que possam conter referências a imagens
                rels_files = [f for f in excel_zip.namelist() if f.endswith('.rels')]
                
                for rel_file in rels_files:
                    try:
                        with excel_zip.open(rel_file) as f:
                            rel_content = f.read().decode('utf-8')
                            # Procurar por referências a imagens
                            img_refs = re.findall(r'Target="([^"]+\.(png|jpe?g|gif|bmp|tiff))"', rel_content)
                            
                            for img_ref in img_refs:
                                # Tentar construir o caminho completo
                                rel_dir = os.path.dirname(rel_file)
                                img_path = os.path.normpath(os.path.join(rel_dir, img_ref[0]))
                                
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
                                            "image_base64": img_base64
                                        })
                                except Exception as e:
                                    print(f"Erro ao extrair imagem da referência {img_ref}: {str(e)}")
                    except Exception as e:
                        print(f"Erro ao processar arquivo de relação {rel_file}: {str(e)}")
        
        print(f"Total de {len(result['images'])} imagens extraídas com sucesso")
    
    except Exception as e:
        result["error"] = str(e)
        print(f"Erro geral: {str(e)}")
    
    # Retornar o resultado como JSON
    print(json.dumps(result))
    return result

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Argumentos incorretos! Uso: python script.py arquivo.xlsx diretorio_saida"}))
        sys.exit(1)
    
    excel_path = sys.argv[1]
    output_dir = sys.argv[2]
    extract_images_from_excel(excel_path, output_dir)