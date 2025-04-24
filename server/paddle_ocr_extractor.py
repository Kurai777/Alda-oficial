# -*- coding: utf-8 -*-
"""
PaddleOCR Extractor for Product Catalogs
----------------------------------------

Este script converte PDFs em imagens, extrai textos e posições usando PaddleOCR,
agrupa os blocos de texto por proximidade para formar produtos completos,
e retorna um JSON estruturado com as informações dos produtos.

Uso:
    python paddle_ocr_extractor.py <caminho_do_pdf> [caminho_do_json_saida]
"""

import os
import sys
import json
import base64
import subprocess
import tempfile
import re
import logging
from typing import List, Dict, Any, Tuple, Optional
from pathlib import Path
import argparse
from collections import defaultdict
import math

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Constantes
PRICE_PATTERN = r'R\$\s*[\d.,]+|[\d.,]+\s*reais|\d+[.,]\d+|\d+\s*,\s*\d+'
CODE_PATTERN = r'\d+[\.\-]\d+[\.\-]\d+[\.\-]\d+|\b[A-Z]+\d+\b|\b\d{4,}\b'
COLOR_LIST = [
    "preto", "branco", "azul", "vermelho", "verde", "amarelo", "laranja",
    "roxo", "rosa", "marrom", "cinza", "bege", "dourado", "prateado", "cromado",
    "transparente", "natural", "cerejeira", "tabaco", "nogueira", "mogno",
    "carvalho", "imbuia", "pinus", "jequitibá", "jatobá", "cedro",
    "café", "grafite", "chumbo", "fumê", "caramelo", "nude"
]
MATERIAL_LIST = [
    "madeira", "mdf", "mdp", "melamínico", "melamina", "metalizado", "metal", 
    "alumínio", "aluminio", "aço", "aco", "ferro", "vidro", "cristal", "espelho",
    "couro", "corino", "tecido", "linho", "veludo", "suede", "camurça", "camurca",
    "laca", "polipropileno", "pp", "abs", "plástico", "plastico", "pvc", "poliéster",
    "poliester", "polietileno", "mármore", "marmore", "granito", "quartzo", 
    "cerâmica", "ceramica", "porcelanato", "laminado", "ráfia", "rafia", "palhinha",
    "junco", "vime", "bambu", "rattan", "inox", "cromado", "laqueado"
]
CATEGORY_INDICATORS = {
    "cadeira": "Cadeira",
    "poltrona": "Poltrona",
    "sofá": "Sofá", 
    "sofa": "Sofá",
    "mesa": "Mesa",
    "banqueta": "Banqueta",
    "banco": "Banqueta",
    "rack": "Rack",
    "painel": "Painel",
    "estante": "Estante",
    "guarda-roupa": "Guarda-roupa", 
    "armário": "Armário",
    "armario": "Armário",
    "buffet": "Buffet",
    "aparador": "Aparador",
    "cômoda": "Cômoda",
    "comoda": "Cômoda",
    "escrivaninha": "Escrivaninha",
    "criado-mudo": "Criado-mudo",
    "cabeceira": "Cabeceira",
    "cama": "Cama",
}


def install_dependencies():
    """Instalar as dependências Python necessárias"""
    dependencies = [
        "pdf2image",
        "paddlepaddle", 
        "paddleocr",
        "pillow",
    ]
    
    try:
        import importlib.util
        missing_deps = []
        
        for dep in dependencies:
            try:
                spec = importlib.util.find_spec(dep.replace('-', '_').split('==')[0])
                if not spec:
                    missing_deps.append(dep)
            except ImportError:
                missing_deps.append(dep)
        
        if missing_deps:
            logger.info(f"Instalando dependências: {', '.join(missing_deps)}")
            subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing_deps)
            logger.info("Todas as dependências instaladas com sucesso")
        else:
            logger.info("Todas as dependências já estão instaladas")
            
        return True
    except Exception as e:
        logger.error(f"Erro ao instalar dependências: {e}")
        return False


def check_poppler():
    """Verificar se o poppler está instalado no sistema"""
    try:
        result = subprocess.run(
            ["pdftoppm", "-v"], 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            check=False
        )
        return result.returncode == 0
    except Exception:
        return False


def convert_pdf_to_images(pdf_path: str, output_dir: Optional[str] = None) -> List[str]:
    """
    Converter PDF para imagens usando pdf2image
    
    Args:
        pdf_path: Caminho para o arquivo PDF
        output_dir: Diretório para salvar as imagens (opcional)
        
    Returns:
        Lista de caminhos para as imagens geradas
    """
    try:
        # Importar aqui para garantir que foi instalado
        from pdf2image import convert_from_path
        
        # Criar diretório temporário se não foi fornecido
        if output_dir is None:
            output_dir = tempfile.mkdtemp()
        
        # Criar diretório se não existe
        os.makedirs(output_dir, exist_ok=True)
        
        logger.info(f"Convertendo PDF para imagens no diretório: {output_dir}")
        
        # Obter o nome base do PDF
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        
        # Verificar se poppler está instalado
        if not check_poppler():
            logger.warning("Poppler não encontrado, os resultados podem ser limitados")
        
        # Converter PDF para imagens
        images = convert_from_path(
            pdf_path,
            dpi=300,
            output_folder=output_dir,
            fmt="jpeg",
            output_file=base_name,
            paths_only=True,
            use_pdftocairo=True
        )
        
        logger.info(f"Convertidas {len(images)} páginas do PDF para imagens")
        return images
    except Exception as e:
        logger.error(f"Erro ao converter PDF para imagens: {e}")
        
        # Tentar método alternativo com pdftoppm diretamente
        try:
            logger.info("Tentando método alternativo com pdftoppm...")
            
            output_pattern = os.path.join(output_dir, f"{base_name}-%d.jpg")
            subprocess.check_call([
                'pdftoppm', '-jpeg', '-r', '300',
                pdf_path, os.path.join(output_dir, base_name)
            ])
            
            # Obter lista de imagens geradas
            image_paths = sorted([
                os.path.join(output_dir, f) 
                for f in os.listdir(output_dir) 
                if f.startswith(base_name) and f.endswith('.jpg')
            ])
            
            logger.info(f"Método alternativo converteu {len(image_paths)} páginas")
            return image_paths
        except Exception as alt_err:
            logger.error(f"Também falhou o método alternativo: {alt_err}")
            return []


def run_paddle_ocr(image_path: str, lang: str = "pt") -> List[Dict[str, Any]]:
    """
    Executar PaddleOCR em uma imagem para extrair texto e posições
    
    Args:
        image_path: Caminho para a imagem
        lang: Código do idioma (pt para português)
        
    Returns:
        Lista de resultados OCR com texto e caixas delimitadoras
    """
    try:
        # Importar aqui para garantir que foi instalado
        from paddleocr import PaddleOCR
        
        logger.info(f"Executando OCR na imagem: {image_path}")
        
        # Inicializar PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        
        # Executar OCR
        result = ocr.ocr(image_path, cls=True)
        
        # Processar resultados
        ocr_results = []
        
        if result and result[0]:
            for idx, line in enumerate(result[0]):
                box = line[0]  # Coordenadas: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                text = line[1][0]  # Conteúdo do texto
                confidence = line[1][1]  # Pontuação de confiança
                
                # Calcular o ponto central da caixa delimitadora
                center_x = sum(point[0] for point in box) / 4
                center_y = sum(point[1] for point in box) / 4
                
                # Calcular dimensões da caixa
                width = max(point[0] for point in box) - min(point[0] for point in box)
                height = max(point[1] for point in box) - min(point[1] for point in box)
                
                ocr_results.append({
                    'id': idx,
                    'text': text,
                    'confidence': confidence,
                    'box': box,
                    'center': [center_x, center_y],
                    'width': width,
                    'height': height,
                    'area': width * height
                })
        
        logger.info(f"OCR extraiu {len(ocr_results)} blocos de texto")
        return ocr_results
    except Exception as e:
        logger.error(f"Erro ao executar OCR na imagem: {e}")
        return []


def is_price(text: str) -> Tuple[bool, Optional[float]]:
    """
    Verificar se o texto contém um preço e extraí-lo
    
    Returns:
        Tupla com (é_preço, valor_em_centavos)
    """
    # Remover espaços extras e converter vírgula para ponto
    clean_text = text.strip().replace(" ", "")
    
    # Tentar extrair com regex de preço em Real
    price_match = re.search(r'R\$\s*([\d.,]+)', clean_text)
    if price_match:
        price_str = price_match.group(1).replace(".", "").replace(",", ".")
        try:
            # Converter para float e depois para centavos (inteiro)
            price_value = float(price_str)
            return True, int(price_value * 100)
        except ValueError:
            pass
    
    # Tentar encontrar qualquer número que possa ser um preço
    number_match = re.search(r'([\d,.]+)', clean_text)
    if number_match:
        num_str = number_match.group(1).replace(".", "").replace(",", ".")
        try:
            value = float(num_str)
            # Se for um valor muito pequeno ou muito grande, provavelmente não é um preço
            if 1 <= value <= 100000:
                return True, int(value * 100)
        except ValueError:
            pass
    
    return False, None


def is_product_code(text: str) -> bool:
    """Verificar se o texto é provavelmente um código de produto"""
    # Códigos geralmente têm formato específico
    if re.search(r'\d+\.\d+\.\d+\.\d+', text):  # Formato 1.00020.01.0001
        return True
    
    # Códigos alfanuméricos
    if re.search(r'^[A-Z0-9\-\.]{4,}$', text):
        return True
    
    # Códigos com prefixo
    if re.search(r'(REF|COD|SKU)[:.]\s*([A-Z0-9\-\.]+)', text, re.IGNORECASE):
        return True
    
    return False


def extract_colors(text: str) -> List[str]:
    """Extrair nomes de cores do texto"""
    colors = []
    text_lower = text.lower()
    
    for color in COLOR_LIST:
        if color in text_lower:
            colors.append(color.capitalize())
    
    return colors


def extract_materials(text: str) -> List[str]:
    """Extrair materiais do texto"""
    materials = []
    text_lower = text.lower()
    
    for material in MATERIAL_LIST:
        if material in text_lower:
            materials.append(material.capitalize())
    
    return materials


def identify_category(text: str) -> Optional[str]:
    """Identificar categoria do produto a partir do texto"""
    text_lower = text.lower()
    
    for keyword, category in CATEGORY_INDICATORS.items():
        if keyword in text_lower:
            return category
    
    return None


def calculate_distance(box1: Dict[str, Any], box2: Dict[str, Any]) -> float:
    """Calcular distância entre dois blocos de texto"""
    center1 = box1['center']
    center2 = box2['center']
    
    return math.sqrt((center1[0] - center2[0])**2 + (center1[1] - center2[1])**2)


def group_text_blocks(ocr_results: List[Dict[str, Any]], max_distance: float = 100) -> List[List[Dict[str, Any]]]:
    """
    Agrupar blocos de texto que estão próximos um do outro
    
    Args:
        ocr_results: Lista de resultados do OCR
        max_distance: Distância máxima para agrupar blocos
        
    Returns:
        Lista de grupos de blocos de texto
    """
    if not ocr_results:
        return []
    
    # Ordenar por coordenada Y (de cima para baixo)
    sorted_blocks = sorted(ocr_results, key=lambda x: x['center'][1])
    
    groups = []
    current_group = [sorted_blocks[0]]
    
    for i in range(1, len(sorted_blocks)):
        current_block = sorted_blocks[i]
        prev_block = current_group[-1]
        
        # Se o bloco atual está próximo do anterior, adicionar ao grupo atual
        if abs(current_block['center'][1] - prev_block['center'][1]) < max_distance:
            current_group.append(current_block)
        else:
            # Caso contrário, começar um novo grupo
            groups.append(current_group)
            current_group = [current_block]
    
    # Adicionar o último grupo
    if current_group:
        groups.append(current_group)
    
    # Ordenar blocos dentro de cada grupo por coordenada X (da esquerda para direita)
    for group in groups:
        group.sort(key=lambda x: x['center'][0])
    
    return groups


def cluster_blocks_into_products(ocr_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrupar blocos de texto em produtos usando um algoritmo mais sofisticado
    
    Args:
        ocr_results: Lista de resultados do OCR
        
    Returns:
        Lista de produtos extraídos
    """
    # Passo 1: Identificar títulos de produtos (geralmente texto grande ou em negrito)
    potential_titles = []
    
    # Ordenar blocos por tamanho (área) de modo decrescente
    sorted_by_area = sorted(ocr_results, key=lambda x: x['area'], reverse=True)
    
    # Os 20% maiores blocos de texto são candidatos a títulos
    title_candidates = sorted_by_area[:max(1, int(len(sorted_by_area) * 0.2))]
    
    # Verificar quais blocos contêm nomes de categorias (ex: "Cadeira", "Mesa")
    for block in ocr_results:
        text = block['text'].strip()
        
        # Se o bloco é um dos maiores ou contém palavra-chave de categoria
        if (block in title_candidates or identify_category(text)) and len(text) > 3:
            potential_titles.append(block)
    
    # Se não encontrou títulos, usar divisão por linhas
    if not potential_titles:
        logger.info("Nenhum título de produto identificado, usando agrupamento por linhas")
        return extract_products_by_lines(ocr_results)
    
    # Passo 2: Para cada título, encontrar blocos de texto relacionados
    products = []
    
    # Ordenar títulos por posição Y (de cima para baixo)
    potential_titles.sort(key=lambda x: x['center'][1])
    
    for i, title_block in enumerate(potential_titles):
        # Definir a região do produto (até o próximo título ou final da página)
        y_min = title_block['center'][1]
        y_max = float('inf')
        
        if i < len(potential_titles) - 1:
            y_max = potential_titles[i + 1]['center'][1]
        
        # Coletar todos os blocos de texto nesta região
        product_blocks = [
            block for block in ocr_results 
            if y_min <= block['center'][1] < y_max
        ]
        
        # Criar o produto
        product = extract_product_from_blocks(product_blocks, title_block['text'])
        products.append(product)
    
    return products


def extract_products_by_lines(ocr_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extrair produtos agrupando blocos de texto por linhas
    
    Args:
        ocr_results: Lista de resultados do OCR
        
    Returns:
        Lista de produtos extraídos
    """
    # Agrupar por proximidade vertical
    line_groups = group_text_blocks(ocr_results)
    
    # Processar cada grupo como uma linha de informação
    products = []
    current_product = None
    
    for line in line_groups:
        # Concatenar textos da linha
        line_text = " ".join([block['text'] for block in line])
        
        # Verificar se é um título de produto (início de um novo produto)
        category = identify_category(line_text)
        
        if category or (len(line_text) > 3 and line_text[0].isupper()):
            # Se já temos um produto em processamento, salvar ele
            if current_product and current_product['nome']:
                products.append(current_product)
            
            # Iniciar um novo produto
            current_product = {
                'nome': line_text,
                'descricao': "",
                'codigo_comercial': [],
                'cores': [],
                'preco': "",
                'pagina': 1,
                'categoria': category or ""
            }
        elif current_product:
            # Processar informações adicionais para o produto atual
            
            # Verificar se é um código
            if is_product_code(line_text) and not any(code == line_text for code in current_product['codigo_comercial']):
                current_product['codigo_comercial'].append(line_text)
            
            # Verificar se é um preço
            is_price_val, price_cents = is_price(line_text)
            if is_price_val and price_cents and not current_product['preco']:
                # Formatar como R$ XXX,XX
                price_reais = price_cents / 100
                current_product['preco'] = f"R$ {price_reais:.2f}".replace('.', ',')
            
            # Extrair cores
            colors = extract_colors(line_text)
            for color in colors:
                if color not in current_product['cores']:
                    current_product['cores'].append(color)
            
            # Se não foi classificado como outra coisa, adicionar à descrição
            if not is_price_val and not is_product_code(line_text) and not colors:
                if current_product['descricao']:
                    current_product['descricao'] += " " + line_text
                else:
                    current_product['descricao'] = line_text
    
    # Não esquecer de adicionar o último produto
    if current_product and current_product['nome']:
        products.append(current_product)
    
    return products


def extract_product_from_blocks(blocks: List[Dict[str, Any]], title_text: str) -> Dict[str, Any]:
    """
    Extrair informações de produto a partir de um conjunto de blocos de texto
    
    Args:
        blocks: Lista de blocos de texto
        title_text: Texto do título do produto
        
    Returns:
        Dicionário com informações do produto
    """
    product = {
        'nome': title_text,
        'descricao': "",
        'codigo_comercial': [],
        'cores': [],
        'preco': "",
        'pagina': 1,
        'categoria': identify_category(title_text) or ""
    }
    
    # Ordenar blocos por posição Y
    blocks.sort(key=lambda x: x['center'][1])
    
    # Processar cada bloco
    for block in blocks:
        text = block['text'].strip()
        
        # Pular o bloco do título, já foi processado
        if text == title_text:
            continue
        
        # Verificar se é um código
        if is_product_code(text) and not any(code == text for code in product['codigo_comercial']):
            product['codigo_comercial'].append(text)
            continue
        
        # Verificar se é um preço
        is_price_val, price_cents = is_price(text)
        if is_price_val and price_cents and not product['preco']:
            # Formatar como R$ XXX,XX
            price_reais = price_cents / 100
            product['preco'] = f"R$ {price_reais:.2f}".replace('.', ',')
            continue
        
        # Extrair cores
        colors = extract_colors(text)
        if colors:
            for color in colors:
                if color not in product['cores']:
                    product['cores'].append(color)
            continue
        
        # Se não foi classificado como outra coisa, adicionar à descrição
        if product['descricao']:
            product['descricao'] += " " + text
        else:
            product['descricao'] = text
    
    return product


def process_image_for_products(image_path: str, page_number: int = 1, lang: str = "pt") -> List[Dict[str, Any]]:
    """
    Processar uma imagem para extrair produtos
    
    Args:
        image_path: Caminho para a imagem
        page_number: Número da página
        lang: Código do idioma para OCR
        
    Returns:
        Lista de produtos extraídos
    """
    # Executar OCR na imagem
    ocr_results = run_paddle_ocr(image_path, lang)
    
    if not ocr_results:
        logger.warning(f"Nenhum texto extraído da imagem: {image_path}")
        return []
    
    # Agrupar blocos de texto em produtos
    products = cluster_blocks_into_products(ocr_results)
    
    # Se não encontrou produtos, tentar método alternativo
    if not products:
        logger.info("Tentando método alternativo de extração...")
        products = extract_products_by_lines(ocr_results)
    
    # Adicionar número da página e URL da imagem
    for product in products:
        product['pagina'] = page_number
        
        # Converter a imagem para base64
        try:
            with open(image_path, "rb") as img_file:
                img_data = base64.b64encode(img_file.read()).decode('utf-8')
                product['imagem'] = f"data:image/jpeg;base64,{img_data}"
        except Exception as e:
            logger.error(f"Erro ao converter imagem para base64: {e}")
            product['imagem'] = ""
    
    logger.info(f"Extraídos {len(products)} produtos da página {page_number}")
    return products


def process_pdf_with_paddle_ocr(pdf_path: str, output_json_path: Optional[str] = None, lang: str = "pt") -> str:
    """
    Processar um arquivo PDF com PaddleOCR para extrair produtos
    
    Args:
        pdf_path: Caminho para o arquivo PDF
        output_json_path: Caminho para salvar o JSON de saída (opcional)
        lang: Código do idioma para OCR
        
    Returns:
        Caminho para o arquivo JSON de saída
    """
    try:
        logger.info(f"Iniciando processamento do PDF: {pdf_path}")
        
        # Instalar dependências se necessário
        install_dependencies()
        
        # Criar diretório temporário para imagens
        temp_dir = tempfile.mkdtemp()
        logger.info(f"Diretório temporário criado: {temp_dir}")
        
        # Converter PDF para imagens
        image_paths = convert_pdf_to_images(pdf_path, temp_dir)
        
        if not image_paths:
            raise Exception("Falha ao converter PDF para imagens")
        
        logger.info(f"PDF convertido em {len(image_paths)} imagens")
        
        # Processar cada imagem para extrair produtos
        all_products = []
        
        for i, image_path in enumerate(image_paths):
            logger.info(f"Processando página {i+1}/{len(image_paths)}")
            
            # Extrair produtos da imagem
            products = process_image_for_products(image_path, i+1, lang)
            all_products.extend(products)
        
        # Definir caminho de saída
        if output_json_path is None:
            output_json_path = os.path.join(
                os.path.dirname(pdf_path),
                f"{os.path.splitext(os.path.basename(pdf_path))[0]}_products.json"
            )
        
        # Salvar resultados em JSON
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(all_products, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Extraídos {len(all_products)} produtos no total")
        logger.info(f"Resultados salvos em: {output_json_path}")
        
        return output_json_path
    except Exception as e:
        logger.error(f"Erro ao processar PDF: {e}")
        
        # Criar JSON vazio em caso de erro
        if output_json_path:
            with open(output_json_path, 'w', encoding='utf-8') as f:
                json.dump([], f)
            
            logger.info(f"Arquivo JSON vazio criado em: {output_json_path}")
            return output_json_path
        
        return ""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extrator de produtos de PDFs com PaddleOCR")
    parser.add_argument("pdf_path", help="Caminho para o arquivo PDF")
    parser.add_argument("output_json_path", nargs="?", help="Caminho para salvar o JSON de saída (opcional)")
    parser.add_argument("--lang", default="pt", help="Código do idioma para OCR (padrão: pt)")
    
    args = parser.parse_args()
    
    process_pdf_with_paddle_ocr(args.pdf_path, args.output_json_path, args.lang) 