import fitz  # PyMuPDF
import sys
import json
import os

def extract_images_from_pdf(pdf_path, output_dir):
    """
    Extrai imagens de um arquivo PDF e as salva no diretório de saída.
    Retorna uma lista de dicionários com informações sobre as imagens extraídas.
    """
    extracted_images_info = []
    try:
        if not os.path.exists(pdf_path):
            return {"error": f"Arquivo PDF não encontrado: {pdf_path}"}
        
        doc = fitz.open(pdf_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            image_list = page.get_images(full=True)
            
            for img_index, img_info in enumerate(image_list):
                xref = img_info[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                image_filename = f"page{page_num + 1}_img{img_index + 1}.{image_ext}"
                image_filepath = os.path.join(output_dir, image_filename)
                
                with open(image_filepath, "wb") as img_file:
                    img_file.write(image_bytes)
                
                extracted_images_info.append({
                    "page_number": page_num + 1,
                    "image_index_on_page": img_index + 1,
                    "filename": image_filename,
                    "filepath": image_filepath,
                    "extension": image_ext,
                    # PyMuPDF não fornece dimensões diretamente neste fluxo de forma simples
                    # Para dimensões, precisaríamos de etapas adicionais (ex: carregar com Pillow)
                })
        
        doc.close()
        return {"success": True, "images": extracted_images_info}

    except Exception as e:
        return {"error": str(e), "images": extracted_images_info} # Retorna o que conseguiu extrair + erro

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Uso: python extract_pdf_images.py <caminho_do_pdf> <diretorio_de_saida>"}))
        sys.exit(1)
    
    pdf_file_path = sys.argv[1]
    output_image_dir = sys.argv[2]
    
    result = extract_images_from_pdf(pdf_file_path, output_image_dir)
    print(json.dumps(result)) 