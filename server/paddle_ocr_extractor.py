#!/usr/bin/env python
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
import re
import math
import shutil
import subprocess
from typing import List, Dict, Any, Tuple, Optional
import tempfile

def install_dependencies():
    """Instalar as dependências Python necessárias"""
    try:
        # Tentar importar PaddleOCR para ver se já está instalado
        import paddleocr
        print("PaddleOCR já instalado")
    except ImportError:
        print("Instalando PaddleOCR e dependências...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", 
            "paddleocr", "pdf2image", "pillow", "numpy", "opencv-python-headless"
        ])
        print("Dependências instaladas com sucesso")

def check_poppler():
    """Verificar se o poppler está instalado no sistema"""
    try:
        # Verificar se o poppler-utils está instalado via shutil
        if shutil.which("pdftoppm") is None:
            print("Poppler não encontrado no sistema. Por favor, instale-o antes de continuar.")
            print("Em sistemas baseados em Debian: sudo apt-get install poppler-utils")
            print("Em sistemas baseados em Red Hat: sudo yum install poppler-utils")
            print("Em MacOS: brew install poppler")
            return False
        return True
    except Exception as e:
        print(f"Erro ao verificar poppler: {e}")
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
        from pdf2image import convert_from_path
        
        if output_dir is None:
            output_dir = tempfile.mkdtemp()
        
        os.makedirs(output_dir, exist_ok=True)
        
        print(f"Convertendo PDF: {pdf_path}")
        images = convert_from_path(
            pdf_path, 
            dpi=300, 
            output_folder=output_dir,
            fmt="jpg"
        )
        
        image_paths = []
        for i, image in enumerate(images):
            image_path = os.path.join(output_dir, f"page_{i+1}.jpg")
            image.save(image_path, "JPEG")
            image_paths.append(image_path)
        
        print(f"PDF convertido em {len(image_paths)} imagens")
        return image_paths
    except Exception as e:
        print(f"Erro ao converter PDF para imagens: {e}")
        raise

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
        from paddleocr import PaddleOCR
        
        print(f"Executando OCR na imagem: {image_path}")
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        results = ocr.ocr(image_path, cls=True)
        
        # Formatar resultados
        formatted_results = []
        for result in results[0]:
            box = result[0]  # Pontos da caixa delimitadora: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            text = result[1][0]  # Texto extraído
            confidence = result[1][1]  # Confiança da extração
            
            # Encontrar o centro da caixa
            center_x = sum(point[0] for point in box) / 4
            center_y = sum(point[1] for point in box) / 4
            
            # Calcular largura e altura da caixa
            width = max(point[0] for point in box) - min(point[0] for point in box)
            height = max(point[1] for point in box) - min(point[1] for point in box)
            
            # Adicionar informações extraídas
            formatted_result = {
                "texto": text,
                "confianca": confidence,
                "posicao": {
                    "centro_x": center_x,
                    "centro_y": center_y,
                    "largura": width,
                    "altura": height
                },
                "box": box
            }
            
            # Analisar o texto para extrair informações adicionais
            is_price, price_value = is_price(text)
            if is_price:
                formatted_result["preco"] = price_value
                formatted_result["é_preço"] = True
            
            if is_product_code(text):
                formatted_result["é_código"] = True
            
            # Extrair cores, materiais e categorias
            colors = extract_colors(text)
            if colors:
                formatted_result["cores"] = colors
            
            materials = extract_materials(text)
            if materials:
                formatted_result["materiais"] = materials
            
            category = identify_category(text)
            if category:
                formatted_result["categoria"] = category
            
            formatted_results.append(formatted_result)
        
        print(f"OCR concluído. Extraídos {len(formatted_results)} blocos de texto.")
        return formatted_results
    except Exception as e:
        print(f"Erro ao executar PaddleOCR: {e}")
        raise

def is_price(text: str) -> Tuple[bool, Optional[float]]:
    """
    Verificar se o texto contém um preço e extraí-lo
    
    Returns:
        Tupla com (é_preço, valor_em_centavos)
    """
    # Padrões de preço comuns:
    # R$ 1.234,56
    # 1.234,56
    # R$1234,56
    # 1234.56
    
    # Padronizar o texto
    text = text.lower().strip()
    
    # Remover R$ e outros símbolos de moeda
    text = re.sub(r'r\$|\$|€|£', '', text)
    
    # Procurar padrões numéricos com vírgula ou ponto
    price_match = re.search(r'(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[,.]\d{2}|\d+)', text)
    
    if price_match:
        price_str = price_match.group(1)
        
        # Converter para formato numérico
        try:
            # Tratar formato brasileiro (1.234,56)
            if ',' in price_str:
                price_str = price_str.replace('.', '')
                price_str = price_str.replace(',', '.')
            
            price = float(price_str)
            
            # Verificar se tem características de preço (contexto)
            price_indicators = ['reais', 'avista', 'a vista', 'preço', 'preco', 'valor', 'por', 'de', 'apenas']
            has_indicator = any(indicator in text for indicator in price_indicators)
            
            # Usar heurísticas para identificar preços
            # - Valores muito altos ou baixos para móveis são menos prováveis de serem preços
            is_reasonable_price = 50 <= price <= 50000
            
            # Decisão final
            if has_indicator or (is_reasonable_price and (len(text) < 20 or price_match.group(0) == text)):
                return True, price
    
    return False, None

def is_product_code(text: str) -> bool:
    """Verificar se o texto é provavelmente um código de produto"""
    text = text.strip()
    
    # Padrões típicos de códigos de produtos
    # Exemplo: ABC-123, REF.123456, COD: XYZ789
    code_patterns = [
        r'^[A-Z0-9-]{5,15}$',  # Padrão geral (letras, números e hífens)
        r'^(ref|cod|código|codigo|cód|ref\.|cod\.)[\s:.]*[A-Z0-9-]+$',  # Prefixos comuns
        r'^[A-Z]{2,5}[\s-]?\d{3,8}$'  # Letras seguidas de números
    ]
    
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in code_patterns)

def extract_colors(text: str) -> List[str]:
    """Extrair nomes de cores do texto"""
    # Lista de cores comuns em português
    common_colors = [
        'preto', 'branco', 'cinza', 'vermelho', 'azul', 'verde', 'amarelo', 
        'laranja', 'roxo', 'rosa', 'marrom', 'bege', 'dourado', 'prateado', 
        'prata', 'bronze', 'creme', 'gelo', 'grafite', 'natural', 'violeta',
        'caramelo', 'chocolate', 'ocre', 'turquesa', 'magenta', 'bordô'
    ]
    
    # Padronizar texto
    text = text.lower()
    
    # Encontrar cores no texto
    found_colors = []
    for color in common_colors:
        if re.search(r'\b' + color + r'\b', text):
            found_colors.append(color)
    
    return found_colors

def extract_materials(text: str) -> List[str]:
    """Extrair materiais do texto"""
    # Lista de materiais comuns em móveis
    common_materials = [
        'madeira', 'pinus', 'mdf', 'melamina', 'mdp', 'couro', 'tecido', 'vidro', 
        'metal', 'aço', 'alumínio', 'plástico', 'veludo', 'mármore', 'granito',
        'laminado', 'inox', 'linho', 'algodão', 'sintético', 'pvc', 'napa', 'chenille',
        'carvalho', 'pinheiro', 'nogal', 'cerejeira', 'jequitibá', 'cedro', 'imbuia',
        'cobre', 'ferro', 'bronze', 'latão', 'borracha'
    ]
    
    # Padronizar texto
    text = text.lower()
    
    # Encontrar materiais no texto
    found_materials = []
    for material in common_materials:
        if re.search(r'\b' + material + r'\b', text):
            found_materials.append(material)
    
    return found_materials

def identify_category(text: str) -> Optional[str]:
    """Identificar categoria do produto a partir do texto"""
    # Mapeamento de palavras-chave para categorias
    category_keywords = {
        'sofá': 'Sofás',
        'sofa': 'Sofás',
        'poltrona': 'Poltronas',
        'cadeira': 'Cadeiras',
        'mesa': 'Mesas',
        'rack': 'Racks e Estantes',
        'estante': 'Racks e Estantes',
        'prateleira': 'Racks e Estantes',
        'armário': 'Armários',
        'armario': 'Armários',
        'cômoda': 'Cômodas',
        'comoda': 'Cômodas',
        'cama': 'Camas',
        'colchão': 'Colchões',
        'colchao': 'Colchões',
        'guarda-roupa': 'Guarda-roupas',
        'guarda roupa': 'Guarda-roupas',
        'criado-mudo': 'Criados-mudos',
        'criado mudo': 'Criados-mudos',
        'escrivaninha': 'Escrivaninhas',
        'estofado': 'Estofados',
        'banco': 'Bancos',
        'baú': 'Baús',
        'bau': 'Baús',
        'aparador': 'Aparadores',
        'buffet': 'Buffets',
        'luminária': 'Iluminação',
        'luminaria': 'Iluminação',
        'tapete': 'Tapetes',
        'cortina': 'Cortinas',
        'persiana': 'Persianas',
        'espelho': 'Espelhos',
        'quadro': 'Quadros e Painéis',
        'painel': 'Quadros e Painéis',
        'vaso': 'Decoração',
        'decorativo': 'Decoração'
    }
    
    # Padronizar texto
    text = text.lower()
    
    # Procurar palavras-chave no texto
    for keyword, category in category_keywords.items():
        if keyword in text:
            return category
    
    return None

def calculate_distance(box1: Dict[str, Any], box2: Dict[str, Any]) -> float:
    """Calcular distância entre dois blocos de texto"""
    x1 = box1["posicao"]["centro_x"]
    y1 = box1["posicao"]["centro_y"]
    x2 = box2["posicao"]["centro_x"]
    y2 = box2["posicao"]["centro_y"]
    
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

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
    
    # Cópia dos resultados para não modificar o original
    blocks = ocr_results.copy()
    groups = []
    
    while blocks:
        # Pegar o primeiro bloco
        current_group = [blocks.pop(0)]
        
        # Flag para controlar se ainda estamos encontrando blocos próximos
        found = True
        
        while found:
            found = False
            
            # Verificar blocos restantes
            i = 0
            while i < len(blocks):
                # Verificar se o bloco atual está próximo de qualquer bloco no grupo atual
                if any(calculate_distance(block, blocks[i]) <= max_distance for block in current_group):
                    # Adicionar ao grupo atual
                    current_group.append(blocks.pop(i))
                    found = True
                else:
                    i += 1
        
        # Adicionar grupo completo
        groups.append(current_group)
    
    return groups

def cluster_blocks_into_products(ocr_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrupar blocos de texto em produtos usando um algoritmo mais sofisticado
    
    Args:
        ocr_results: Lista de resultados do OCR
        
    Returns:
        Lista de produtos extraídos
    """
    # Agrupar blocos por proximidade
    groups = group_text_blocks(ocr_results, max_distance=150)
    
    products = []
    
    for group in groups:
        # Verificar se este grupo pode ser um produto
        # Procurar componentes importantes: nome, preço, código
        
        # Tentar identificar o título/nome do produto
        title_candidates = []
        
        for block in group:
            # Blocos que não são códigos ou preços e têm tamanho de fonte maior
            if (not block.get("é_código", False) and 
                not block.get("é_preço", False) and 
                len(block["texto"]) > 3):
                
                # Calcular pontuação heurística:
                # - Mais alta = mais provável de ser título
                # - Fatores: altura do texto, comprimento do texto, posição vertical (mais alto = mais importante)
                font_size_score = block["posicao"]["altura"] * 2
                text_length_score = min(len(block["texto"]) / 5, 10)  # Limitar influência do comprimento
                vertical_pos_score = max(0, 800 - block["posicao"]["centro_y"]) / 200
                
                score = font_size_score + text_length_score + vertical_pos_score
                
                title_candidates.append((block, score))
        
        # Ordenar candidatos pela pontuação
        title_candidates.sort(key=lambda x: x[1], reverse=True)
        
        if title_candidates:
            # Usar o texto do candidato com maior pontuação como título
            title_block = title_candidates[0][0]
            title_text = title_block["texto"]
            
            # Extrair produto usando o título identificado
            product = extract_product_from_blocks(group, title_text)
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
    if not ocr_results:
        return []
    
    # Ordenar blocos por coordenada Y (vertical)
    blocks_by_y = sorted(ocr_results, key=lambda x: x["posicao"]["centro_y"])
    
    # Agrupar blocos em linhas
    line_height_threshold = 30  # Altura máxima para considerar na mesma linha
    lines = []
    current_line = [blocks_by_y[0]]
    current_y = blocks_by_y[0]["posicao"]["centro_y"]
    
    for block in blocks_by_y[1:]:
        if abs(block["posicao"]["centro_y"] - current_y) <= line_height_threshold:
            # Mesmo nível (mesma linha)
            current_line.append(block)
        else:
            # Nova linha
            lines.append(current_line)
            current_line = [block]
            current_y = block["posicao"]["centro_y"]
    
    # Adicionar última linha
    if current_line:
        lines.append(current_line)
    
    # Para cada linha, ordene os blocos da esquerda para a direita
    for i in range(len(lines)):
        lines[i] = sorted(lines[i], key=lambda x: x["posicao"]["centro_x"])
    
    # Analisar linhas para encontrar produtos
    products = []
    
    # Cada produto tipicamente ocupa 2-4 linhas consecutivas
    i = 0
    while i < len(lines):
        # Verificar se a linha atual pode ser título de produto
        if i < len(lines) and any(len(block["texto"]) > 3 for block in lines[i]):
            # Considerar 3 linhas seguintes como parte do mesmo produto
            product_lines = [lines[i]]
            
            for j in range(1, 4):
                if i + j < len(lines):
                    product_lines.append(lines[i + j])
            
            # Achatando a lista de blocos
            product_blocks = [block for line in product_lines for block in line]
            
            # Usar o primeiro texto longo na primeira linha como título
            title_candidates = [block["texto"] for block in lines[i] if len(block["texto"]) > 3]
            title_text = title_candidates[0] if title_candidates else "Produto"
            
            # Extrair produto
            product = extract_product_from_blocks(product_blocks, title_text)
            products.append(product)
            
            # Avançar
            i += len(product_lines)
        else:
            i += 1
    
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
        "nome": title_text,
        "descricao": "",
        "codigo": [],
        "preco": "",
        "cores": [],
        "materiais": []
    }
    
    # Textos descritivos (excluindo o título)
    description_parts = []
    
    # Coletar informações de todos os blocos
    for block in blocks:
        text = block["texto"]
        
        # Ignorar o texto do título
        if text == title_text:
            continue
        
        # Verificar preço
        if block.get("é_preço", False) and block.get("preco") and not product["preco"]:
            product["preco"] = block.get("preco")
        
        # Verificar código
        if block.get("é_código", False):
            product["codigo"].append(text)
        
        # Coletar cores
        if "cores" in block:
            for color in block["cores"]:
                if color not in product["cores"]:
                    product["cores"].append(color)
        
        # Coletar materiais
        if "materiais" in block:
            for material in block["materiais"]:
                if material not in product["materiais"]:
                    product["materiais"].append(material)
        
        # Verificar categoria
        if "categoria" in block and not product.get("categoria"):
            product["categoria"] = block["categoria"]
        
        # Adicionar à descrição
        if len(text) > 3 and text != title_text:
            description_parts.append(text)
    
    # Compilar descrição
    product["descricao"] = " | ".join(description_parts)
    
    # Ajustes finais
    if not product["codigo"]:
        product["codigo"] = ["UNKNOWN-CODE"]
    
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
    # Executar OCR
    ocr_results = run_paddle_ocr(image_path, lang=lang)
    
    # Tentar dois métodos de extração e escolher o melhor resultado
    # Método 1: Clustering baseado em distância
    products1 = cluster_blocks_into_products(ocr_results)
    
    # Método 2: Agrupamento por linhas
    products2 = extract_products_by_lines(ocr_results)
    
    # Escolher o método que extraiu mais produtos
    products = products1 if len(products1) >= len(products2) else products2
    
    # Adicionar número da página
    for product in products:
        product["page"] = page_number
    
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
    # Instalar dependências se necessário
    install_dependencies()
    
    # Verificar poppler
    if not check_poppler():
        raise RuntimeError("Poppler não está instalado. Instale-o antes de prosseguir.")
    
    # Criar diretório temporário para armazenar imagens
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Converter PDF para imagens
            image_paths = convert_pdf_to_images(pdf_path, temp_dir)
            
            if not image_paths:
                raise ValueError(f"Não foi possível converter o PDF: {pdf_path}")
            
            # Processar cada imagem
            all_products = []
            
            for i, image_path in enumerate(image_paths):
                page_number = i + 1
                print(f"Processando página {page_number}...")
                
                # Extrair produtos da imagem
                products = process_image_for_products(image_path, page_number, lang)
                
                print(f"Extraídos {len(products)} produtos da página {page_number}")
                all_products.extend(products)
        except Exception as e:
            print(f"Erro ao processar PDF: {e}")
            # Se for um caminho de imagem direto, tentar processar como imagem
            if os.path.isfile(pdf_path) and pdf_path.lower().endswith((".jpg", ".jpeg", ".png")):
                print("Tentando processar como imagem...")
                all_products = process_image_for_products(pdf_path, 1, lang)
            else:
                raise
    
    # Determinar caminho de saída
    if output_json_path is None:
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        output_json_path = f"{base_name}_products.json"
    
    # Salvar resultados em JSON
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_products, f, ensure_ascii=False, indent=2)
    
    print(f"Processamento concluído. Total de {len(all_products)} produtos extraídos.")
    print(f"Resultados salvos em: {output_json_path}")
    
    return output_json_path

if __name__ == "__main__":
    # Verificar argumentos
    if len(sys.argv) < 2:
        print("Uso: python paddle_ocr_extractor.py <caminho_do_pdf> [caminho_do_json_saida]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_json_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        result_path = process_pdf_with_paddle_ocr(pdf_path, output_json_path)
        sys.exit(0)
    except Exception as e:
        print(f"Erro: {e}")
        sys.exit(1)