import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { ExtractedProduct } from './ocr-pdf-processor';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * Convert OCR-extracted products to the application's product format
 * @param products OCR-extracted products
 * @param userId User ID
 * @param catalogId Catalog ID
 * @returns Formatted products ready for storage
 */
export function convertOcrProductsToAppFormat(products: ExtractedProduct[], userId: number, catalogId: number) {
  return products.map(product => {
    // Convert price from "R$ XXX,XX" format to cents (integer)
    let priceInCents = 0;
    if (product.preco) {
      const priceMatch = product.preco.match(/R\$\s*(\d+[.,]?\d*)/);
      if (priceMatch) {
        const priceStr = priceMatch[1].replace(',', '.');
        priceInCents = Math.round(parseFloat(priceStr) * 100);
      }
    }
    
    return {
      userId,
      catalogId,
      name: product.nome || "Produto sem nome",
      description: product.descricao || "",
      code: product.codigo_comercial.length > 0 ? product.codigo_comercial[0] : `IMG-${Math.floor(Math.random() * 10000)}`,
      price: priceInCents,
      category: determineProductCategory(product.nome),
      colors: product.cores,
      materials: extractMaterialsFromDescription(product.descricao),
      sizes: [],
      imageUrl: product.imagem || ""
    };
  });
}

/**
 * Determine the product category based on the product name
 * @param productName Product name
 * @returns Category name
 */
function determineProductCategory(productName: string): string {
  if (!productName) return "Outros";
  
  const nameLower = productName.toLowerCase();
  
  if (nameLower.includes('cadeira') && (nameLower.includes('gamer') || nameLower.includes('gaming'))) {
    return 'Cadeiras Gamer';
  } else if (nameLower.includes('cadeira')) {
    return 'Cadeiras';
  } else if (nameLower.includes('banqueta')) {
    return 'Banquetas';
  } else if (nameLower.includes('poltrona')) {
    return 'Poltronas';
  } else if (nameLower.includes('sofá') || nameLower.includes('sofa')) {
    return 'Sofás';
  } else if (nameLower.includes('mesa')) {
    return 'Mesas';
  } else if (nameLower.includes('apoio')) {
    return 'Acessórios';
  } else {
    return 'Outros';
  }
}

/**
 * Extract materials from product description
 * @param description Product description
 * @returns Array of materials
 */
function extractMaterialsFromDescription(description: string): string[] {
  const materials: string[] = [];
  const materialKeywords = [
    'madeira', 'metal', 'aço', 'plástico', 'vidro', 'mdf', 'couro', 'tecido',
    'polipropileno', 'alumínio', 'cromado', 'nylon', 'mesh', 'tela'
  ];
  
  if (!description) return materials;
  
  const descLower = description.toLowerCase();
  
  for (const material of materialKeywords) {
    if (descLower.includes(material)) {
      materials.push(material.charAt(0).toUpperCase() + material.slice(1));
    }
  }
  
  return materials;
}

/**
 * Process an image file using OCR to extract product information
 * @param imagePath Path to the image file
 * @returns Array of extracted products
 */
export async function processImageWithOcr(imagePath: string): Promise<ExtractedProduct[]> {
  try {
    console.log(`Iniciando processamento OCR da imagem: ${imagePath}`);
    
    // Create temporary directory for Python script output
    const tempDir = path.join(process.cwd(), 'uploads', 'temp_ocr');
    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    
    // Get the output JSON path
    const outputJsonPath = path.join(
      tempDir,
      `${path.basename(imagePath, path.extname(imagePath))}_products.json`
    );
    
    // Create Python script content to process the image
    const pythonScriptPath = path.join(tempDir, 'process_image.py');
    const pythonScript = `
import os
import json
import base64
import sys
from typing import List, Dict, Any

def install_dependencies():
    """Install required Python dependencies"""
    import subprocess
    try:
        subprocess.check_call(['pip', 'install', 'paddlepaddle', 'paddleocr', 'Pillow'])
        print("Successfully installed dependencies")
    except Exception as e:
        print(f"Error installing dependencies: {e}")
        return False
    return True

def run_ocr_on_image(image_path, lang="pt"):
    """Run PaddleOCR on an image"""
    try:
        from paddleocr import PaddleOCR
        
        # Initialize PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang=lang)
        
        # Run OCR
        result = ocr.ocr(image_path, cls=True)
        
        # Process results
        ocr_results = []
        if result and result[0]:
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

def is_product_name(text):
    """Check if text is likely to be a product name"""
    import re
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

def is_price(text):
    """Check if text contains a price"""
    import re
    # Look for "R$" followed by numbers
    return bool(re.search(r'R\\$\\s*\\d+[.,]?\\d*', text))

def is_product_code(text):
    """Check if text is likely to be a product code"""
    import re
    # Fratini codes are like 1.00020.01.0001
    if re.search(r'\\d+\\.\\d+\\.\\d+\\.\\d+', text):
        return True
    
    # Generic product codes often contain letters and numbers
    return bool(re.search(r'[A-Z0-9]{4,}', text))

def is_color(text):
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

def extract_products_from_ocr_results(ocr_results):
    """Extract products from OCR results using a rule-based approach"""
    products = []
    current_product = None
    
    # Group text elements by vertical position (allow small differences)
    vertical_groups = {}
    
    for result in ocr_results:
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
                "imagem": "",
                "page": 1
            }
        
        # Process already found product
        elif current_product:
            # Check for price information
            if is_price(group_text):
                # Extract the price
                import re
                price_match = re.search(r'R\\$\\s*\\d+[.,]?\\d*', group_text)
                if price_match:
                    current_product["preco"] = price_match.group(0)
            
            # Check for product code
            elif is_product_code(group_text):
                import re
                code_match = re.search(r'\\d+\\.\\d+\\.\\d+\\.\\d+', group_text)
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
    
    # If no products were found, try to create one from general OCR text
    if not products and ocr_results:
        # Combine all text
        all_text = " ".join([result['text'] for result in ocr_results if result['text'].strip()])
        if all_text:
            # Try to extract product info from all text
            product = {
                "nome": "Produto em Imagem",
                "descricao": all_text[:200] if len(all_text) > 200 else all_text,
                "codigo_comercial": [],
                "cores": [],
                "preco": "",
                "imagem": "",
                "page": 1
            }
            
            # Try to find price
            import re
            price_match = re.search(r'R\\$\\s*(\\d+[.,]?\\d*)', all_text)
            if price_match:
                product["preco"] = "R$" + price_match.group(1)
                
            # Try to find codes
            code_matches = re.findall(r'\\b\\d+\\.\\d+\\.\\d+\\.\\d+\\b', all_text)
            if code_matches:
                product["codigo_comercial"] = code_matches
                
            # Try to find colors
            for color in ["preto", "branco", "cinza", "azul", "vermelho", "verde", 
                        "amarelo", "laranja", "roxo", "rosa", "marrom", "bege"]:
                if color in all_text.lower():
                    product["cores"].append(color.capitalize())
            
            products.append(product)
    
    # Convert image to base64
    try:
        with open(image_path, "rb") as img_file:
            import base64
            img_data = base64.b64encode(img_file.read()).decode('utf-8')
            img_format = os.path.splitext(image_path)[1][1:].lower()
            if img_format in ['jpg', 'jpeg']:
                img_format = 'jpeg'
            elif img_format == 'png':
                img_format = 'png'
            else:
                img_format = 'jpeg'
                
            image_base64 = f"data:image/{img_format};base64,{img_data}"
            
            # Assign the image to all products
            for product in products:
                product["imagem"] = image_base64
    except Exception as e:
        print(f"Error converting image to base64: {e}")
    
    return products

def process_image(image_path, output_json_path, lang="pt"):
    """Process image with OCR"""
    try:
        # Install dependencies
        install_dependencies()
        
        # Run OCR on the image
        ocr_results = run_ocr_on_image(image_path, lang)
        
        # Extract products from OCR results
        products = extract_products_from_ocr_results(ocr_results)
        
        # Save results to JSON file
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(products, f, ensure_ascii=False, indent=2)
        
        print(f"Extracted {len(products)} products from image")
        print(f"Results saved to {output_json_path}")
        
        return True
    except Exception as e:
        print(f"Error processing image with OCR: {e}")
        return False

if __name__ == "__main__":
    image_path = sys.argv[1]
    output_json_path = sys.argv[2]
    
    process_image(image_path, output_json_path)
`;
    
    // Write the Python script to a file
    await writeFile(pythonScriptPath, pythonScript);
    
    // Run the Python script as a child process
    const pythonProcess = spawn('python', [
      pythonScriptPath,
      imagePath,
      outputJsonPath
    ]);
    
    // Log output from the Python script
    pythonProcess.stdout.on('data', (data) => {
      console.log(`Python OCR output: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
      console.error(`Python OCR error: ${data}`);
    });
    
    // Wait for the Python process to complete
    await new Promise<void>((resolve, reject) => {
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`Python OCR process completed successfully`);
          resolve();
        } else {
          console.error(`Python OCR process exited with code ${code}`);
          reject(new Error(`Python OCR process exited with code ${code}`));
        }
      });
    });
    
    // Check if the output JSON file exists
    if (!fs.existsSync(outputJsonPath)) {
      throw new Error(`Output JSON file not found: ${outputJsonPath}`);
    }
    
    // Read the output JSON file
    const jsonContent = await readFile(outputJsonPath, 'utf-8');
    const products = JSON.parse(jsonContent) as ExtractedProduct[];
    
    console.log(`Extraídos ${products.length} produtos da imagem via OCR`);
    
    return products;
  } catch (error) {
    console.error('Erro ao processar imagem com OCR:', error);
    // Return an empty array to indicate no products were found
    return [];
  }
}

/**
 * Convert base64 image back to file for processing
 * @param base64Data Base64 encoded image data
 * @returns Path to the saved image file
 */
export async function saveBase64ImageForProcessing(base64Data: string): Promise<string> {
  try {
    // Extract the data from the base64 string
    const matches = base64Data.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 image format');
    }
    
    const imageFormat = matches[1];
    const base64Image = matches[2];
    
    // Create a temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'uploads', 'temp_images');
    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }
    
    // Generate a unique filename
    const filename = `image_${Date.now()}.${imageFormat}`;
    const filePath = path.join(tempDir, filename);
    
    // Write the base64 data to the file
    const buffer = Buffer.from(base64Image, 'base64');
    await writeFile(filePath, buffer);
    
    console.log(`Base64 image saved to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Erro ao salvar imagem base64:', error);
    throw error;
  }
}