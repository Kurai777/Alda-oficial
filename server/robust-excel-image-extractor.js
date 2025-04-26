/**
 * Extrator robusto de imagens de Excel
 * 
 * Este módulo fornece métodos mais avançados para extrair imagens de arquivos Excel.
 * Tenta múltiplas abordagens para maximizar a chance de sucesso.
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
async function robust_extractImages(excelPath, outputDir) {
  try {
    console.log(`Extraindo imagens de ${excelPath} com extrator robusto`);
    
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
    
    // Procurar imagens embutidas como objetos de desenho (mais complexo)
    const drawingFiles = Object.keys(zip.files).filter(fileName => 
      fileName.includes('drawings/') && fileName.endsWith('.xml')
    );
    
    // Esta é uma implementação simplificada - na prática, extrair imagens 
    // de objetos de desenho requer parseamento XML mais complexo
    
    console.log(`Extrator robusto encontrou ${imageCount} imagens`);
    
    return {
      success: imageCount > 0,
      imageCount
    };
  } catch (error) {
    console.error('Erro no extrator robusto:', error);
    return {
      success: false,
      imageCount: 0
    };
  }
}

module.exports = {
  robust_extractImages
};