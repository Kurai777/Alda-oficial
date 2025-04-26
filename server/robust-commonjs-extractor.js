/**
 * Extrator robusto de imagens de Excel (versão CommonJS)
 * 
 * Este módulo fornece métodos mais avançados para extrair imagens de arquivos Excel
 * usando apenas CommonJS para evitar problemas de compatibilidade.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/**
 * Extrai imagens de um arquivo Excel (que é basicamente um ZIP) de forma robusta
 * @param {string} excelPath Caminho para o arquivo Excel
 * @param {string} outputDir Diretório onde salvar as imagens extraídas
 * @returns {Promise<{success: boolean, imageCount: number}>} Resultado da extração
 */
async function extractImages(excelPath, outputDir) {
  try {
    console.log(`Extraindo imagens de ${excelPath} com extrator CommonJS`);
    
    // Verificar se o diretório de saída existe
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Ler o arquivo Excel como um buffer binário
    const excelData = fs.readFileSync(excelPath);
    
    // Carregar o arquivo como um ZIP
    const zip = await JSZip.loadAsync(excelData);
    
    // Contador de imagens encontradas
    let imageCount = 0;
    
    // Extrair imagens de xl/media/ (localização padrão de imagens no Excel)
    const mediaFiles = Object.keys(zip.files).filter(fileName => 
      fileName.startsWith('xl/media/') && 
      /\.(png|jpg|jpeg|gif|emf)$/i.test(fileName)
    );
    
    // Processar cada arquivo de imagem encontrado
    for (const fileName of mediaFiles) {
      const fileData = await zip.files[fileName].async('nodebuffer');
      const outputPath = path.join(outputDir, path.basename(fileName));
      
      fs.writeFileSync(outputPath, fileData);
      imageCount++;
    }
    
    // Se não encontrou imagens no local padrão, procurar em outras pastas
    if (imageCount === 0) {
      const allImageFiles = Object.keys(zip.files).filter(fileName => 
        /\.(png|jpg|jpeg|gif|emf)$/i.test(fileName)
      );
      
      for (const fileName of allImageFiles) {
        const fileData = await zip.files[fileName].async('nodebuffer');
        const outputPath = path.join(outputDir, path.basename(fileName));
        
        fs.writeFileSync(outputPath, fileData);
        imageCount++;
      }
    }
    
    console.log(`Extrator CommonJS encontrou ${imageCount} imagens`);
    
    return {
      success: imageCount > 0,
      imageCount
    };
  } catch (error) {
    console.error('Erro no extrator CommonJS:', error);
    return {
      success: false,
      imageCount: 0
    };
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
  extractImages,
  associateImagesWithProducts
};