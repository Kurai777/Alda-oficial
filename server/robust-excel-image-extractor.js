/**
 * Extrator robusto de imagens do Excel
 * 
 * Este módulo fornece métodos de fallback para extração de imagens
 * do Excel quando os métodos padrão falham.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JSZip = require('jszip');

/**
 * Extrai imagens de um arquivo Excel usando múltiplos métodos
 * @param {string} excelPath Caminho para o arquivo Excel
 * @param {string} outputDir Diretório de saída para as imagens
 */
async function extractImages(excelPath, outputDir) {
  console.log(`Extrator robusto: extraindo imagens de ${excelPath} para ${outputDir}`);
  
  // Criar diretório de saída se não existir
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  try {
    // Tentar primeiro com JSZip
    const jsZipResult = await extractWithJSZip(excelPath, outputDir);
    
    if (jsZipResult.success && jsZipResult.count > 0) {
      console.log(`Extraídas ${jsZipResult.count} imagens com JSZip`);
      return { success: true, message: `Extraídas ${jsZipResult.count} imagens`, count: jsZipResult.count };
    }
    
    // Se JSZip falhar, tentar com unzip
    const unzipResult = extractWithUnzip(excelPath, outputDir);
    
    if (unzipResult.success && unzipResult.count > 0) {
      console.log(`Extraídas ${unzipResult.count} imagens com unzip`);
      return { success: true, message: `Extraídas ${unzipResult.count} imagens`, count: unzipResult.count };
    }
    
    // Nenhum método funcionou
    return { success: false, message: "Falha ao extrair imagens", count: 0 };
  } catch (error) {
    console.error("Erro no extrator robusto:", error);
    return { success: false, message: `Erro ao extrair imagens: ${error.message}`, count: 0 };
  }
}

/**
 * Extrai imagens usando JSZip
 */
async function extractWithJSZip(excelPath, outputDir) {
  try {
    // Ler o arquivo Excel como um arquivo zip
    const data = fs.readFileSync(excelPath);
    const zip = await JSZip.loadAsync(data);
    
    // Procurar por imagens dentro do arquivo em xl/media ou arquivos com extensão de imagem
    let mediaFiles = [];
    
    // Verificar a pasta xl/media (caminho padrão para imagens no Excel)
    const mediaFolder = zip.folder('xl/media');
    if (mediaFolder) {
      mediaFiles = Object.keys(mediaFolder.files).filter(name => 
        !mediaFolder.files[name].dir && /\.(png|jpg|jpeg|gif|emf)$/i.test(name)
      );
      
      // Extrair todas as imagens
      let count = 0;
      for (const filename of mediaFiles) {
        try {
          const content = await mediaFolder.file(filename).async('nodebuffer');
          const outputPath = path.join(outputDir, path.basename(filename));
          fs.writeFileSync(outputPath, content);
          count++;
        } catch (fileError) {
          console.warn(`Não foi possível extrair ${filename}: ${fileError.message}`);
        }
      }
      
      return { success: true, count };
    }
    
    // Verificar em qualquer lugar (procurar em todo o arquivo)
    const imageFiles = Object.keys(zip.files).filter(name => 
      !zip.files[name].dir && /\.(png|jpg|jpeg|gif|emf)$/i.test(name)
    );
    
    if (imageFiles.length > 0) {
      let count = 0;
      for (const filename of imageFiles) {
        try {
          const content = await zip.file(filename).async('nodebuffer');
          const outputPath = path.join(outputDir, path.basename(filename));
          fs.writeFileSync(outputPath, content);
          count++;
        } catch (fileError) {
          console.warn(`Não foi possível extrair ${filename}: ${fileError.message}`);
        }
      }
      
      return { success: true, count };
    }
    
    return { success: false, count: 0 };
  } catch (error) {
    console.error('Erro ao extrair com JSZip:', error);
    return { success: false, count: 0 };
  }
}

/**
 * Extrai imagens usando unzip (método alternativo)
 */
function extractWithUnzip(excelPath, outputDir) {
  try {
    // Criar diretório temporário para extrair o arquivo Excel
    const tempDir = path.join(outputDir, '_temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Usar unzip para extrair o arquivo Excel
    try {
      execSync(`unzip -o "${excelPath}" -d "${tempDir}"`);
    } catch (unzipError) {
      console.warn(`Falha ao usar unzip: ${unzipError.message}`);
      return { success: false, count: 0 };
    }
    
    // Procurar por imagens na pasta xl/media
    const mediaDir = path.join(tempDir, 'xl', 'media');
    if (fs.existsSync(mediaDir)) {
      const imageFiles = fs.readdirSync(mediaDir).filter(file => 
        /\.(png|jpg|jpeg|gif|emf)$/i.test(file)
      );
      
      // Copiar imagens para o diretório de saída
      let count = 0;
      for (const file of imageFiles) {
        try {
          const sourcePath = path.join(mediaDir, file);
          const destPath = path.join(outputDir, file);
          fs.copyFileSync(sourcePath, destPath);
          count++;
        } catch (copyError) {
          console.warn(`Não foi possível copiar ${file}: ${copyError.message}`);
        }
      }
      
      // Limpar diretório temporário
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (rmError) {
        console.warn(`Não foi possível remover diretório temporário: ${rmError.message}`);
      }
      
      return { success: true, count };
    }
    
    // Limpar diretório temporário
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (rmError) {
      console.warn(`Não foi possível remover diretório temporário: ${rmError.message}`);
    }
    
    return { success: false, count: 0 };
  } catch (error) {
    console.error('Erro ao extrair com unzip:', error);
    return { success: false, count: 0 };
  }
}

module.exports = {
  extractImages
};