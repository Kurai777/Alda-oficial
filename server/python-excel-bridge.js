/**
 * Ponte para Python para extração de imagens do Excel
 * 
 * Este é um módulo de fallback para extrair imagens do Excel
 * quando os métodos JavaScript falham. Ele cria um arquivo temporário
 * de Python e o executa para extrair as imagens.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function extractExcelImages(excelPath, outputDir) {
  try {
    console.log(`Tentando extrair imagens de ${excelPath} para ${outputDir} com Python`);
    
    // Verificar se o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Criar arquivo Python temporário para extração
    const tempPyFile = path.join(process.cwd(), 'temp_excel_extractor.py');
    
    // Código Python para extrair imagens
    const pythonCode = `
import os
import sys
import zipfile
import tempfile
from pathlib import Path

def extract_excel_images(excel_path, output_dir):
    """Extrai todas as imagens de um arquivo Excel (que é um arquivo ZIP)"""
    try:
        # Verifica se o arquivo existe
        if not os.path.exists(excel_path):
            print(f"Erro: Arquivo {excel_path} não encontrado", file=sys.stderr)
            return False, 0
            
        # Extrai todas as imagens da pasta xl/media
        count = 0
        with zipfile.ZipFile(excel_path, 'r') as zip_ref:
            # Lista todos os arquivos no ZIP
            files = zip_ref.namelist()
            
            # Filtra apenas arquivos de imagem na pasta xl/media
            media_files = [f for f in files if f.startswith('xl/media/') and 
                          any(f.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.emf'])]
            
            # Extrai cada arquivo
            for file in media_files:
                # Extrai apenas o nome do arquivo sem o caminho
                filename = os.path.basename(file)
                output_path = os.path.join(output_dir, filename)
                
                # Extrai o arquivo
                with open(output_path, 'wb') as f:
                    f.write(zip_ref.read(file))
                count += 1
                
        # Se não encontrou imagens na pasta xl/media, tenta encontrar em outros lugares
        if count == 0:
            # Cria um diretório temporário para extrair todo o conteúdo
            with tempfile.TemporaryDirectory() as temp_dir:
                zip_ref.extractall(temp_dir)
                
                # Procura por imagens em qualquer lugar
                for root, _, files in os.walk(temp_dir):
                    for file in files:
                        if any(file.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.emf']):
                            src_path = os.path.join(root, file)
                            dst_path = os.path.join(output_dir, file)
                            
                            # Copia o arquivo para o diretório de saída
                            with open(src_path, 'rb') as src, open(dst_path, 'wb') as dst:
                                dst.write(src.read())
                            count += 1
                
        print(f"Extraídas {count} imagens com sucesso!")
        return True, count
        
    except Exception as e:
        print(f"Erro ao extrair imagens: {str(e)}", file=sys.stderr)
        return False, 0

if __name__ == "__main__":
    # Argumentos da linha de comando
    if len(sys.argv) != 3:
        print("Uso: python extract_excel_images.py <caminho_excel> <diretorio_saida>")
        sys.exit(1)
        
    excel_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Extrai imagens
    success, count = extract_excel_images(excel_path, output_dir)
    
    # Saída para o processo Node.js
    print(f"RESULT:{{\"success\":{str(success).lower()},\"count\":{count}}}")
    
    # Retorna código de saída
    sys.exit(0 if success else 1)
`;
    
    // Escrever o código Python em um arquivo temporário
    fs.writeFileSync(tempPyFile, pythonCode);
    
    try {
      // Executar o script Python
      const result = execSync(`python3 ${tempPyFile} "${excelPath}" "${outputDir}"`, {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      // Remover o arquivo Python temporário
      try {
        fs.unlinkSync(tempPyFile);
      } catch (unlinkError) {
        console.warn(`Não foi possível remover o arquivo temporário: ${unlinkError.message}`);
      }
      
      // Processar resultado
      const resultMatch = result.match(/RESULT:(\{.*\})/);
      if (resultMatch && resultMatch[1]) {
        try {
          const resultJson = JSON.parse(resultMatch[1]);
          return {
            success: resultJson.success,
            count: resultJson.count,
            imageCount: resultJson.count
          };
        } catch (jsonError) {
          console.error('Erro ao processar resultado JSON do Python:', jsonError);
        }
      }
      
      // Se chegou aqui, contar manualmente os arquivos extraídos
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir).filter(file => 
          /\.(png|jpg|jpeg|gif|emf)$/i.test(file)
        );
        
        return {
          success: files.length > 0,
          count: files.length,
          imageCount: files.length
        };
      }
      
      return { success: false, count: 0, imageCount: 0 };
    } catch (execError) {
      console.error('Erro ao executar script Python:', execError);
      
      // Remover o arquivo Python temporário em caso de erro
      try {
        fs.unlinkSync(tempPyFile);
      } catch (unlinkError) {
        console.warn(`Não foi possível remover o arquivo temporário: ${unlinkError.message}`);
      }
      
      return { success: false, count: 0, imageCount: 0 };
    }
  } catch (error) {
    console.error('Erro na ponte Python:', error);
    return { success: false, count: 0, imageCount: 0 };
  }
}

/**
 * Associa imagens extraídas com produtos baseado em códigos de produto
 * @param {Array} products Lista de produtos a serem associados com imagens
 * @param {string} imagesDir Diretório contendo as imagens extraídas
 * @param {string} userId ID do usuário
 * @param {string} catalogId ID do catálogo
 * @returns {Array} Lista de produtos com URLs de imagens associadas
 */
async function associateImagesWithProducts(products, imagesDir, userId, catalogId) {
  try {
    console.log(`Associando imagens de ${imagesDir} com ${products.length} produtos`);
    
    if (!fs.existsSync(imagesDir)) {
      console.warn(`Diretório de imagens não encontrado: ${imagesDir}`);
      return products;
    }
    
    // Ler todas as imagens do diretório
    const files = fs.readdirSync(imagesDir).filter(file => 
      /\.(png|jpg|jpeg|gif|emf)$/i.test(file)
    );
    
    if (files.length === 0) {
      console.warn('Nenhuma imagem encontrada para associar com produtos');
      return products;
    }
    
    console.log(`Encontradas ${files.length} imagens no diretório`);
    
    // Criar diretório para imagens associadas
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Para cada produto, tentar encontrar uma imagem com nome semelhante ao código
    const updatedProducts = products.map(product => {
      const code = product.code || product.codigo || "";
      
      if (!code) {
        console.warn('Produto sem código, não é possível associar imagem');
        return product;
      }
      
      // Tentar encontrar uma imagem que contenha o código do produto no nome
      const matchingFile = files.find(file => {
        const cleanFileName = file.toLowerCase().replace(/\.[^/.]+$/, ""); // Remove extensão
        const cleanCode = code.toLowerCase().trim().replace(/\s+/g, "");
        return cleanFileName.includes(cleanCode);
      });
      
      if (matchingFile) {
        // Copiar a imagem para o diretório do usuário/catálogo
        const sourceFilePath = path.join(imagesDir, matchingFile);
        const targetFileName = `${Date.now()}-${matchingFile}`;
        const targetFilePath = path.join(targetDir, targetFileName);
        
        try {
          fs.copyFileSync(sourceFilePath, targetFilePath);
          
          // Atualizar produto com URL da imagem
          const imageUrl = `/api/images/${userId}/${catalogId}/${targetFileName}`;
          console.log(`Associada imagem ${matchingFile} ao produto ${code}: ${imageUrl}`);
          return { ...product, imageUrl };
        } catch (copyError) {
          console.error(`Erro ao copiar imagem ${matchingFile}:`, copyError);
          return product;
        }
      } else {
        console.log(`Nenhuma imagem encontrada para o produto ${code}`);
        return product;
      }
    });
    
    return updatedProducts;
  } catch (error) {
    console.error('Erro ao associar imagens com produtos:', error);
    return products;
  }
}

module.exports = {
  extractExcelImages,
  associateImagesWithProducts
};