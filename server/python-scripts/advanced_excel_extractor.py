#!/usr/bin/env python3
"""
Script avançado para extrair imagens de arquivos Excel.

Este script utiliza múltiplas técnicas para extrair imagens de diferentes formatos de Excel:
1. Extração direta do arquivo ZIP (XLSX é um arquivo ZIP)
2. Análise de arquivos de relacionamento para encontrar imagens referenciadas
3. Uso de pandas e openpyxl para estruturas mais complexas
4. Extração de objetos OLE e informações de drawing

Requisitos:
pip install pandas openpyxl pillow olefile
"""

import os
import sys
import json
import re
import base64
import zipfile
import shutil
import tempfile
from pathlib import Path
import traceback

def install_dependencies():
    """Instala as dependências necessárias para o script"""
    import subprocess
    import sys
    
    # Lista de dependências
    dependencies = ["pandas", "openpyxl", "pillow", "olefile"]
    
    # Verificar quais dependências já estão instaladas
    installed_packages = []
    try:
        import pkg_resources
        installed_packages = [pkg.key for pkg in pkg_resources.working_set]
    except ImportError:
        pass
    
    # Instalar pacotes faltantes
    missing = [pkg for pkg in dependencies if pkg.lower() not in installed_packages]
    if missing:
        print(f"Instalando dependências: {', '.join(missing)}")
        # Usar o pip do usuário com --user para evitar problemas de permissão
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user"] + missing)
        print("Dependências instaladas com sucesso")
    
    # Importar novamente os módulos
    import importlib
    import sys
    importlib.reload(sys)

# Tentar importar dependências
try:
    import pandas as pd
    import openpyxl
    from PIL import Image
    import olefile
except ImportError:
    # Instalar dependências faltantes
    print("Algumas dependências estão faltando. Tentando instalá-las...")
    install_dependencies()
    
    # Tentar importar novamente
    try:
        import pandas as pd
        import openpyxl
        from PIL import Image
        import olefile
    except ImportError as e:
        print(f"ERRO: Ainda não foi possível importar as dependências: {str(e)}")
        # Alternativa: usar apenas bibliotecas padrão do Python
        pd = None

def debug_log(message):
    """Função para log de debug"""
    print(f"DEBUG: {message}")

def extract_images(excel_path, output_dir=None):
    """
    Extrai todas as imagens de um arquivo Excel usando múltiplos métodos
    
    Args:
        excel_path: Caminho para o arquivo Excel
        output_dir: Diretório para salvar as imagens extraídas (opcional)
        
    Returns:
        dict: Dicionário com resultados da extração
    """
    if output_dir is None:
        output_dir = tempfile.mkdtemp()
    else:
        os.makedirs(output_dir, exist_ok=True)
    
    result = {
        "images": [],
        "error": None,
        "output_dir": output_dir
    }
    
    # Usar várias técnicas em sequência, tentando cada uma
    try:
        # Técnica 1: Extração direta do arquivo ZIP
        result = extract_with_zipfile(excel_path, output_dir, result)
        
        # Se não encontrou imagens, usar técnica 2: openpyxl
        if len(result["images"]) == 0:
            debug_log("Tentando método 2: openpyxl")
            result = extract_with_openpyxl(excel_path, output_dir, result)
        
        # Técnica 3: objetos OLE para arquivos antigos do Excel (.xls)
        if len(result["images"]) == 0 and excel_path.lower().endswith('.xls'):
            debug_log("Tentando método 3: extração de objetos OLE")
            result = extract_with_olefile(excel_path, output_dir, result)
        
        # Último recurso: método de fallback usando puro Python
        if len(result["images"]) == 0:
            debug_log("Tentando método de fallback com puro Python")
            result = extract_with_pure_python(excel_path, output_dir, result)
        
    except Exception as e:
        error_message = f"Erro durante extração: {str(e)}\n{traceback.format_exc()}"
        debug_log(error_message)
        result["error"] = error_message
    
    # Adicionar contagem total de imagens
    result["total_images"] = len(result["images"])
    debug_log(f"Total de imagens extraídas: {result['total_images']}")
    
    return result
    
def extract_with_pure_python(excel_path, output_dir, result):
    """
    Método de fallback que usa apenas bibliotecas padrão do Python
    
    Esta função é um último recurso quando todas as outras abordagens falham,
    por exemplo, quando as dependências necessárias não podem ser instaladas.
    """
    debug_log("Iniciando extração com método de fallback puro Python")
    
    try:
        # Verificar se o arquivo é um ZIP (como XLSX)
        if excel_path.lower().endswith('.xlsx') or excel_path.lower().endswith('.xlsm'):
            try:
                with zipfile.ZipFile(excel_path, 'r') as zip_ref:
                    # Procurar por padrões conhecidos de arquivos de imagem em arquivos XLSX
                    media_paths = [f for f in zip_ref.namelist() if 
                        ('xl/media/' in f or 'ppt/media/' in f or 'word/media/' in f) and 
                        any(f.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.bmp'])]
                    
                    debug_log(f"Encontradas {len(media_paths)} potenciais imagens em caminhos de mídia")
                    
                    for img_index, media_path in enumerate(media_paths):
                        # Extrair a imagem para o disco
                        img_filename = os.path.basename(media_path)
                        output_path = os.path.join(output_dir, f"fallback_{img_index}_{img_filename}")
                        
                        with zip_ref.open(media_path) as img_file:
                            img_data = img_file.read()
                            
                            if not img_data or len(img_data) < 100:  # Evitar arquivos muito pequenos
                                continue
                                
                            with open(output_path, 'wb') as out_file:
                                out_file.write(img_data)
                            
                            # Converter para base64
                            img_base64 = base64.b64encode(img_data).decode('utf-8')
                            
                            # Adicionar ao resultado
                            result["images"].append({
                                "image_path": output_path,
                                "image_filename": os.path.basename(output_path),
                                "original_path": media_path,
                                "image_base64": img_base64
                            })
                            
                            debug_log(f"Imagem de fallback {img_index+1} extraída: {output_path}")
            except zipfile.BadZipFile:
                debug_log("Arquivo não é um ZIP válido, continuando com outros métodos")
                
        # Para outros tipos de arquivo, simplesmente retornar o resultado atual
        return result
                
    except Exception as e:
        debug_log(f"Erro no método de fallback: {str(e)}")
        
    return result

def extract_with_zipfile(excel_path, output_dir, result):
    """Extração de imagens do Excel como um arquivo ZIP"""
    try:
        debug_log(f"Extraindo imagens de {excel_path} com método zipfile")
        
        # XLSX é um arquivo ZIP, abrindo como tal
        with zipfile.ZipFile(excel_path, 'r') as excel_zip:
            # Procurar por arquivos de imagem em locais comuns
            image_extensions = r'\.(png|jpe?g|gif|bmp|tiff|emf|wmf)$'
            media_locations = [
                'xl/media/', 
                'xl/drawings/', 
                'word/media/',
                'ppt/media/',
                'xl/embeddings/',
            ]
            
            # Obter lista de todos os arquivos no ZIP
            all_files = excel_zip.namelist()
            
            # Encontrar possíveis arquivos de imagem por extensão e localização
            image_files = []
            
            # Verificar em pastas de mídia conhecidas
            for location in media_locations:
                for file_path in all_files:
                    if file_path.startswith(location) and re.search(image_extensions, file_path, re.IGNORECASE):
                        image_files.append(file_path)
            
            # Verificar por quaisquer outras imagens em qualquer localização
            for file_path in all_files:
                if re.search(image_extensions, file_path, re.IGNORECASE) and file_path not in image_files:
                    image_files.append(file_path)
            
            debug_log(f"Encontradas {len(image_files)} imagens potenciais no arquivo ZIP")
            
            # Extrair cada imagem
            for img_index, img_path in enumerate(image_files):
                try:
                    # Extrair o nome do arquivo
                    img_filename = os.path.basename(img_path)
                    # Remover caracteres problemáticos
                    safe_filename = re.sub(r'[^\w\-\.]', '_', img_filename)
                    # Adicionar índice para evitar sobreposição
                    output_path = os.path.join(output_dir, f"img_{img_index}_{safe_filename}")
                    
                    # Extrair a imagem para o disco
                    with excel_zip.open(img_path) as img_file:
                        img_data = img_file.read()
                        
                        if not img_data or len(img_data) == 0:
                            debug_log(f"Arquivo vazio: {img_path}")
                            continue
                        
                        with open(output_path, 'wb') as out_file:
                            out_file.write(img_data)
                        
                        # Tentar abrir com PIL para verificar se é uma imagem válida
                        try:
                            Image.open(output_path).verify()
                        except Exception as e:
                            debug_log(f"Arquivo não é uma imagem válida: {output_path} - {str(e)}")
                            os.remove(output_path)
                            continue
                        
                        # Converter para base64 para retorno
                        with open(output_path, 'rb') as img_file:
                            img_data = img_file.read()
                            img_base64 = base64.b64encode(img_data).decode('utf-8')
                        
                        # Adicionar ao resultado
                        result["images"].append({
                            "image_path": output_path,
                            "image_filename": os.path.basename(output_path),
                            "original_path": img_path,
                            "image_base64": img_base64
                        })
                        
                        debug_log(f"Imagem {img_index+1} extraída: {output_path}")
                except Exception as e:
                    debug_log(f"Erro ao extrair imagem {img_path}: {str(e)}")
            
            # Se não encontramos imagens, procurar em arquivos de relações
            if len(result["images"]) == 0:
                debug_log("Tentando extrair imagens de arquivos de relações...")
                
                # Encontrar arquivos .rels que podem conter referências a imagens
                rels_files = [f for f in all_files if f.endswith('.rels')]
                debug_log(f"Encontrados {len(rels_files)} arquivos de relações para verificar")
                
                for rel_file in rels_files:
                    try:
                        with excel_zip.open(rel_file) as f:
                            content = f.read().decode('utf-8', errors='ignore')
                            
                            # Procurar referências a imagens
                            image_refs = re.findall(r'Target="([^"]+\.(png|jpe?g|gif|bmp|tiff))"', content, re.IGNORECASE)
                            debug_log(f"Encontradas {len(image_refs)} referências em {rel_file}")
                            
                            for img_ref in image_refs:
                                try:
                                    # Extrair o caminho da imagem
                                    img_path = img_ref[0]
                                    
                                    # Ajustar caminhos relativos
                                    rel_dir = os.path.dirname(rel_file)
                                    if img_path.startswith('../'):
                                        img_path = os.path.normpath(os.path.join(rel_dir, '..', img_path[3:]))
                                    
                                    # Tentar diferentes variações do caminho
                                    possible_paths = [
                                        img_path,
                                        f"xl/{img_path}",
                                        img_path.lstrip('/'),
                                        f"xl/media/{os.path.basename(img_path)}"
                                    ]
                                    
                                    # Tentar cada caminho possível
                                    for attempt_path in possible_paths:
                                        try:
                                            if attempt_path in all_files:
                                                img_path = attempt_path
                                                break
                                        except:
                                            continue
                                    
                                    if img_path not in all_files:
                                        debug_log(f"Imagem referenciada não encontrada: {img_path}")
                                        continue
                                    
                                    # Extrair a imagem
                                    img_index = len(result["images"])
                                    img_filename = os.path.basename(img_path)
                                    safe_filename = re.sub(r'[^\w\-\.]', '_', img_filename)
                                    output_path = os.path.join(output_dir, f"rel_{img_index}_{safe_filename}")
                                    
                                    with excel_zip.open(img_path) as img_file:
                                        img_data = img_file.read()
                                        
                                        if not img_data or len(img_data) == 0:
                                            debug_log(f"Arquivo de imagem vazio: {img_path}")
                                            continue
                                        
                                        with open(output_path, 'wb') as out_file:
                                            out_file.write(img_data)
                                        
                                        # Converter para base64
                                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                                        
                                        result["images"].append({
                                            "image_path": output_path,
                                            "image_filename": os.path.basename(output_path),
                                            "original_path": img_path,
                                            "image_base64": img_base64
                                        })
                                        
                                        debug_log(f"Imagem de relação {img_index+1} extraída: {output_path}")
                                except Exception as e:
                                    debug_log(f"Erro ao processar referência {img_ref}: {str(e)}")
                    except Exception as e:
                        debug_log(f"Erro ao processar arquivo de relações {rel_file}: {str(e)}")
        
        debug_log(f"Método zipfile: {len(result['images'])} imagens extraídas com sucesso")
        
    except Exception as e:
        debug_log(f"Erro no método zipfile: {str(e)}\n{traceback.format_exc()}")
    
    return result

def extract_with_openpyxl(excel_path, output_dir, result):
    """Extração de imagens usando openpyxl (para estruturas mais complexas)"""
    # Verificar se temos o módulo openpyxl disponível
    if 'openpyxl' not in sys.modules:
        debug_log("openpyxl não está disponível, pulando este método de extração")
        return result
    
    try:
        debug_log(f"Extraindo imagens de {excel_path} com método openpyxl")
        
        # Carregar o arquivo Excel com openpyxl
        workbook = openpyxl.load_workbook(excel_path, data_only=True)
        
        # Contador para imagens
        img_index = len(result["images"])
        
        # Processar cada planilha
        for sheet_name in workbook.sheetnames:
            try:
                sheet = workbook[sheet_name]
                
                # Acessar imagens da planilha - com tratamento para atributos que podem não existir
                if hasattr(sheet, '_images') and sheet._images:
                    debug_log(f"Encontradas {len(sheet._images)} imagens na planilha {sheet_name}")
                    
                    for img in sheet._images:
                        try:
                            # Verificar se o objeto tem o atributo _data
                            if not hasattr(img, '_data'):
                                debug_log("Imagem sem dados (_data), pulando")
                                continue
                                
                            # Obter o tipo da imagem
                            img_data = img._data
                            img_ext = 'png'  # Extensão padrão
                            
                            # Criar nome de arquivo único
                            output_path = os.path.join(output_dir, f"openpyxl_{img_index}_{sheet_name}.{img_ext}")
                            
                            # Salvar a imagem
                            with open(output_path, 'wb') as f:
                                f.write(img_data)
                            
                            # Converter para base64
                            img_base64 = base64.b64encode(img_data).decode('utf-8')
                            
                            result["images"].append({
                                "image_path": output_path,
                                "image_filename": os.path.basename(output_path),
                                "original_path": f"{sheet_name}/image{img_index}",
                                "image_base64": img_base64
                            })
                            
                            img_index += 1
                            debug_log(f"Imagem openpyxl {img_index} extraída: {output_path}")
                        except Exception as e:
                            debug_log(f"Erro ao extrair imagem com openpyxl: {str(e)}")
                
                # Processar objetos de desenho (drawing) - com tratamento mais robusto
                if hasattr(sheet, '_drawings') and sheet._drawings:
                    debug_log(f"Encontrados {len(sheet._drawings)} objetos de desenho na planilha {sheet_name}")
                    
                    for drawing in sheet._drawings:
                        try:
                            # Verificar se tem atributo 'images'
                            if hasattr(drawing, 'images'):
                                for img in drawing.images:
                                    try:
                                        # Verificar se tem método _data()
                                        if not hasattr(img, '_data') or not callable(getattr(img, '_data')):
                                            debug_log("Imagem sem método _data(), pulando")
                                            continue
                                            
                                        # Obter os dados da imagem
                                        img_data = img._data()
                                        
                                        if not img_data or len(img_data) == 0:
                                            debug_log("Dados de imagem vazios")
                                            continue
                                        
                                        # Criar nome de arquivo único
                                        output_path = os.path.join(output_dir, f"drawing_{img_index}_{sheet_name}.png")
                                        
                                        # Salvar a imagem
                                        with open(output_path, 'wb') as f:
                                            f.write(img_data)
                                        
                                        # Converter para base64
                                        img_base64 = base64.b64encode(img_data).decode('utf-8')
                                        
                                        result["images"].append({
                                            "image_path": output_path,
                                            "image_filename": os.path.basename(output_path),
                                            "original_path": f"{sheet_name}/drawing{img_index}",
                                            "image_base64": img_base64
                                        })
                                        
                                        img_index += 1
                                        debug_log(f"Imagem de desenho {img_index} extraída: {output_path}")
                                    except Exception as e:
                                        debug_log(f"Erro ao extrair imagem de desenho: {str(e)}")
                        except Exception as e:
                            debug_log(f"Erro ao processar objetos de desenho: {str(e)}")
            except Exception as e:
                debug_log(f"Erro ao processar planilha {sheet_name}: {str(e)}")
        
        debug_log(f"Método openpyxl: {img_index - len(result['images'])} imagens extraídas")
        
    except Exception as e:
        debug_log(f"Erro no método openpyxl: {str(e)}\n{traceback.format_exc()}")
    
    return result

def extract_with_olefile(excel_path, output_dir, result):
    """Extração de imagens usando olefile (para arquivos .xls antigos)"""
    # Verificar se temos o módulo olefile disponível
    if 'olefile' not in sys.modules:
        debug_log("olefile não está disponível, pulando este método de extração")
        return result
        
    try:
        debug_log(f"Extraindo imagens de {excel_path} com método olefile")
        
        # Verificar se o arquivo é um arquivo OLE válido
        if not olefile.isOleFile(excel_path):
            debug_log("Não é um arquivo OLE válido")
            return result
        
        # Abrir o arquivo OLE
        ole = olefile.OleFile(excel_path)
        
        # Contador para imagens
        img_index = len(result["images"])
        
        # Procurar por fluxos de armazenamento que contenham imagens
        for stream_name in ole.listdir():
            try:
                # Procurar por nomes que indicam imagens ou objetos embutidos
                stream_path = '/'.join(stream_name)
                if any(term in stream_path.lower() for term in ['image', 'picture', 'embed', 'ole']):
                    debug_log(f"Processando stream potencial de imagem: {stream_path}")
                    
                    # Ler o conteúdo do stream
                    stream_data = ole.openstream(stream_path).read()
                    
                    # Verificar se os dados começam com uma assinatura de imagem conhecida
                    signatures = {
                        b'\x89PNG': '.png',
                        b'\xff\xd8\xff': '.jpg',
                        b'GIF8': '.gif',
                        b'BM': '.bmp',
                        b'\x49\x49\x2a\x00': '.tiff',  # TIFF (little endian)
                        b'\x4d\x4d\x00\x2a': '.tiff',  # TIFF (big endian)
                    }
                    
                    found_format = False
                    for sig, ext in signatures.items():
                        if stream_data.startswith(sig):
                            found_format = True
                            output_path = os.path.join(output_dir, f"ole_{img_index}{ext}")
                            
                            # Salvar imagem
                            with open(output_path, 'wb') as f:
                                f.write(stream_data)
                                
                            # Verificar se é uma imagem válida
                            try:
                                Image.open(output_path).verify()
                            except:
                                debug_log(f"Arquivo não é uma imagem válida: {output_path}")
                                os.remove(output_path)
                                continue
                            
                            # Converter para base64
                            img_base64 = base64.b64encode(stream_data).decode('utf-8')
                            
                            result["images"].append({
                                "image_path": output_path,
                                "image_filename": os.path.basename(output_path),
                                "original_path": stream_path,
                                "image_base64": img_base64
                            })
                            
                            img_index += 1
                            debug_log(f"Imagem OLE {img_index} extraída: {output_path}")
                            break
                    
                    # Se não foi identificado um formato conhecido, procurar por assinaturas de imagem dentro do stream
                    if not found_format and len(stream_data) > 1024:  # Verificar apenas streams maiores
                        for sig, ext in signatures.items():
                            sig_index = stream_data.find(sig)
                            if sig_index >= 0:
                                debug_log(f"Encontrada assinatura {sig} em {stream_path} na posição {sig_index}")
                                try:
                                    # Extrair a parte do stream que contém a imagem
                                    img_data = stream_data[sig_index:]
                                    output_path = os.path.join(output_dir, f"embedded_{img_index}{ext}")
                                    
                                    # Salvar imagem
                                    with open(output_path, 'wb') as f:
                                        f.write(img_data)
                                    
                                    # Verificar se é uma imagem válida
                                    try:
                                        Image.open(output_path).verify()
                                    except:
                                        debug_log(f"Arquivo não é uma imagem válida: {output_path}")
                                        os.remove(output_path)
                                        continue
                                    
                                    # Converter para base64
                                    img_base64 = base64.b64encode(img_data).decode('utf-8')
                                    
                                    result["images"].append({
                                        "image_path": output_path,
                                        "image_filename": os.path.basename(output_path),
                                        "original_path": f"{stream_path}@{sig_index}",
                                        "image_base64": img_base64
                                    })
                                    
                                    img_index += 1
                                    debug_log(f"Imagem embutida {img_index} extraída: {output_path}")
                                except Exception as e:
                                    debug_log(f"Erro ao extrair imagem embutida: {str(e)}")
            except Exception as e:
                debug_log(f"Erro ao processar stream OLE {stream_name}: {str(e)}")
        
        # Fechar o arquivo OLE
        ole.close()
        
        debug_log(f"Método olefile: {img_index - len(result['images'])} imagens extraídas")
        
    except Exception as e:
        debug_log(f"Erro no método olefile: {str(e)}\n{traceback.format_exc()}")
    
    return result

def main():
    """Função principal para execução do script pela linha de comando"""
    if len(sys.argv) < 2:
        print("Uso: python advanced_excel_extractor.py arquivo_excel.xlsx [diretorio_saida]")
        sys.exit(1)
    
    excel_path = sys.argv[1]
    
    output_dir = None
    if len(sys.argv) >= 3:
        output_dir = sys.argv[2]
    
    try:
        # Extrair imagens
        result = extract_images(excel_path, output_dir)
        
        # Imprimir resultado como JSON
        print(json.dumps({
            "status": "success",
            "total_images": len(result["images"]),
            "output_dir": result["output_dir"],
            "error": result["error"],
            # Incluir apenas caminhos e filenames (não base64 que é muito grande)
            "images": [
                {
                    "image_path": img["image_path"],
                    "image_filename": img["image_filename"],
                    "original_path": img["original_path"]
                } for img in result["images"]
            ]
        }))
        
        # Base64 das imagens em arquivos separados
        if result["images"]:
            base64_dir = os.path.join(result["output_dir"], "base64")
            os.makedirs(base64_dir, exist_ok=True)
            
            for i, img in enumerate(result["images"]):
                base64_path = os.path.join(base64_dir, f"image_{i}_base64.txt")
                with open(base64_path, 'w') as f:
                    f.write(img["image_base64"])
        
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()