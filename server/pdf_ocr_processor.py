import os
import json
import base64
import subprocess
import tempfile
from pathlib import Path
import re
from typing import List, Dict, Any, Tuple

def install_dependencies():
    """Install required Python dependencies"""
    try:
        subprocess.check_call(['pip', 'install', 'pdf2image', 'paddlepaddle', 'paddleocr', 'Pillow'])
        print("Successfully installed dependencies")
    except Exception as e:
        print(f"Error installing dependencies: {e}")
        return False
    return True

def convert_pdf_to_images(pdf_path: str, output_dir: str = None) -> List[str]:
    """
    Convert PDF to images using pdf2image
    
    Args:
        pdf_path: Path to the PDF file
        output_dir: Directory to save images (optional)
        
    Returns:
        List of paths to the generated images
    """
    try:
        # Use python subprocess to avoid importing pdf2image which might not be available yet
        if output_dir is None:
            output_dir = tempfile.mkdtemp()
        
        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)
        
        # Get the base name of the PDF
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        
        # Convert PDF to images using poppler (external dependency)
        # First, check if poppler is installed
        try:
            subprocess.check_call(['pdftoppm', '-v'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except:
            print("poppler-utils not found, trying to install...")
            
        # Use poppler's pdftoppm to convert PDF to images
        image_pattern = os.path.join(output_dir, f"{base_name}-%d.jpg")
        subprocess.check_call([
            'pdftoppm', '-jpeg', '-r', '300',
            pdf_path, os.path.join(output_dir, base_name)
        ])
        
        # Get list of generated images
        image_paths = sorted([
            os.path.join(output_dir, f) 
            for f in os.listdir(output_dir) 
            if f.startswith(base_name) and f.endswith('.jpg')
        ])
        
        print(f"Converted PDF to {len(image_paths)} images")
        return image_paths
    except Exception as e:
        print(f"Error converting PDF to images: {e}")
        return []

def run_ocr_on_image(image_path: str, lang: str = "pt") -> List[Dict[str, Any]]:
    """
    Run PaddleOCR on an image
    
    Args:
        image_path: Path to the image
        lang: Language code (pt for Portuguese)
        
    Returns:
        List of OCR results with text and bounding boxes
    """
    try:
        # Install and import paddleocr
        from paddleocr import PaddleOCR
        
        # Initialize PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        
        # Run OCR
        result = ocr.ocr(image_path, cls=True)
        
        # Process results
        ocr_results = []
        for line in result[0]:
            box = line[0]  # Coordinates: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            text = line[1][0]  # Text content
            confidence = line[1][1]  # Confidence score
            
            # Calculate center point of the bounding box
            center_x = sum(point[0] for point in box) / 4
            center_y = sum(point[1] for point in box) / 4
            
            ocr_results.append({
                'text': text,
                'confidence': confidence,
                'box': box,
                'center': [center_x, center_y]
            })
        
        return ocr_results
    except Exception as e:
        print(f"Error running OCR on image: {e}")
        return []

def is_product_name(text: str) -> bool:
    """Check if text is likely to be a product name"""
    # Product names often start with "Cadeira", "Mesa", "Poltrona", etc.
    product_prefixes = ["cadeira", "mesa", "poltrona", "sofá", "sofa", "banqueta", 
                        "apoio", "estante", "armário", "armario", "rack", "bancada"]
    
    text_lower = text.lower()
    
    # Check if text starts with any of the prefixes
    for prefix in product_prefixes:
        if text_lower.startswith(prefix):
            return True
    
    # Check for capitalized words which might be product names
    words = text.split()
    if len(words) >= 2 and words[0][0].isupper() and words[1][0].isupper():
        return True
    
    return False

def is_price(text: str) -> bool:
    """Check if text contains a price"""
    # Look for "R$" followed by numbers
    return bool(re.search(r'R\$\s*\d+[.,]?\d*', text))

def is_product_code(text: str) -> bool:
    """Check if text is likely to be a product code"""
    # Fratini codes are like 1.00020.01.0001
    if re.search(r'\d+\.\d+\.\d+\.\d+', text):
        return True
    
    # Generic product codes often contain letters and numbers
    return bool(re.search(r'[A-Z0-9]{4,}', text))

def is_color(text: str) -> bool:
    """Check if text is likely to be a color name"""
    colors = ["preto", "branco", "cinza", "azul", "vermelho", "verde", 
              "amarelo", "laranja", "roxo", "rosa", "marrom", "bege", 
              "prata", "dourado", "cromado", "natural", "madeira"]
    
    text_lower = text.lower()
    
    # Check exact matches first
    for color in colors:
        if color == text_lower:
            return True
    
    # Check if any color is contained in the text
    for color in colors:
        if color in text_lower:
            return True
    
    return False

def extract_products_from_ocr_results(ocr_results_by_page: List[List[Dict]], page_images: List[str]) -> List[Dict]:
    """
    Extract products from OCR results using a rule-based approach
    
    Args:
        ocr_results_by_page: List of OCR results for each page
        page_images: List of paths to page images
        
    Returns:
        List of products with their details
    """
    products = []
    current_product = None
    
    def get_page_number(idx):
        """Get page number from image path"""
        try:
            # Extract page number from the filename
            filename = os.path.basename(page_images[idx])
            match = re.search(r'-(\d+)\.jpg$', filename)
            if match:
                return int(match.group(1))
            return idx + 1
        except:
            return idx + 1
    
    # Process each page
    for page_idx, page_results in enumerate(ocr_results_by_page):
        # Group text elements by vertical position (allow small differences)
        vertical_groups = {}
        
        for result in page_results:
            text = result['text'].strip()
            if not text:
                continue
                
            center_y = result['center'][1]
            # Group items that are within 20 pixels vertically
            group_key = int(center_y / 20)
            
            if group_key not in vertical_groups:
                vertical_groups[group_key] = []
            
            vertical_groups[group_key].append(result)
        
        # Sort groups by vertical position
        sorted_groups = sorted(vertical_groups.items())
        
        # Process each vertical group
        for _, group in sorted_groups:
            # Sort items within group by horizontal position
            sorted_items = sorted(group, key=lambda x: x['center'][0])
            
            # Concatenate all text in the group
            group_text = " ".join([item['text'] for item in sorted_items])
            
            # Look for product name patterns
            if is_product_name(group_text):
                # If we were processing a product, save it
                if current_product:
                    products.append(current_product)
                
                # Start a new product
                current_product = {
                    "nome": group_text,
                    "descricao": "",
                    "codigo_comercial": [],
                    "cores": [],
                    "preco": "",
                    "imagem": f"{page_images[page_idx]}",
                    "page": get_page_number(page_idx)
                }
            
            # Process already found product
            elif current_product:
                # Check for price information
                if is_price(group_text):
                    # Extract the price
                    price_match = re.search(r'R\$\s*\d+[.,]?\d*', group_text)
                    if price_match:
                        current_product["preco"] = price_match.group(0)
                
                # Check for product code
                elif is_product_code(group_text):
                    code_match = re.search(r'\d+\.\d+\.\d+\.\d+', group_text)
                    if code_match:
                        code = code_match.group(0)
                        if code not in current_product["codigo_comercial"]:
                            current_product["codigo_comercial"].append(code)
                
                # Check for colors
                elif is_color(group_text):
                    # Extract known colors
                    for color in ["preto", "branco", "cinza", "azul", "vermelho", "verde", 
                                "amarelo", "laranja", "roxo", "rosa", "marrom", "bege"]:
                        if color in group_text.lower() and color not in current_product["cores"]:
                            current_product["cores"].append(color.capitalize())
                
                # If not identified as a special field, add to description
                elif not group_text.startswith("Código") and not group_text.startswith("Cor"):
                    if current_product["descricao"]:
                        current_product["descricao"] += " " + group_text
                    else:
                        current_product["descricao"] = group_text
    
    # Don't forget the last product
    if current_product:
        products.append(current_product)
    
    # Post-process products
    for product in products:
        # Convert image path to base64
        try:
            with open(product["imagem"], "rb") as img_file:
                img_data = base64.b64encode(img_file.read()).decode('utf-8')
                product["imagem"] = f"data:image/jpeg;base64,{img_data}"
        except Exception as e:
            print(f"Error converting image to base64: {e}")
            product["imagem"] = ""
        
        # Make sure we have at least empty arrays for required fields
        if not product["codigo_comercial"]:
            product["codigo_comercial"] = []
        
        if not product["cores"]:
            product["cores"] = []
    
    return products

def process_pdf_with_ocr(pdf_path: str, output_json_path: str = None, lang: str = "pt") -> str:
    """
    Process a PDF file with OCR
    
    Args:
        pdf_path: Path to the PDF file
        output_json_path: Path to save the output JSON (optional)
        lang: Language code for OCR
        
    Returns:
        Path to the output JSON file
    """
    try:
        # Install dependencies if needed
        install_dependencies()
        
        # Create temporary directory for images
        temp_dir = tempfile.mkdtemp()
        
        # Convert PDF to images
        image_paths = convert_pdf_to_images(pdf_path, temp_dir)
        
        if not image_paths:
            raise Exception("Failed to convert PDF to images")
        
        # Run OCR on each image
        ocr_results_by_page = []
        for image_path in image_paths:
            ocr_results = run_ocr_on_image(image_path, lang)
            ocr_results_by_page.append(ocr_results)
        
        # Extract products from OCR results
        products = extract_products_from_ocr_results(ocr_results_by_page, image_paths)
        
        # Save results to JSON file
        if output_json_path is None:
            output_json_path = os.path.join(os.path.dirname(pdf_path), 
                                           f"{os.path.splitext(os.path.basename(pdf_path))[0]}_products.json")
        
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(products, f, ensure_ascii=False, indent=2)
        
        print(f"Extracted {len(products)} products from PDF")
        print(f"Results saved to {output_json_path}")
        
        return output_json_path
    except Exception as e:
        print(f"Error processing PDF with OCR: {e}")
        return ""

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python pdf_ocr_processor.py <pdf_path> [output_json_path]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_json_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    process_pdf_with_ocr(pdf_path, output_json_path)