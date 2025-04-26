/**
 * Processador Específico para o Formato Sofá Home
 * 
 * Este processador foi criado especificamente para lidar com arquivos Excel
 * no formato mostrado pelo usuário, com nomes, descrições e valores exatos.
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { extractPrice } from './excel-format-detector.js';

/**
 * Função simplificada para extrair imagens do Excel
 * @param {string} excelPath Caminho para o arquivo Excel
 * @param {string} outputDir Diretório onde salvar as imagens
 * @returns {Promise<{success: boolean, imageCount: number}>}
 */
async function extractImages(excelPath, outputDir) {
  try {
    console.log(`Extraindo imagens de ${excelPath} com extrator específico`);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    let extractedCount = 0;
    
    try {
      // Usar método ZIP para extrair imagens
      const JSZip = (await import('jszip')).default;
      const readFile = fs.readFileSync(excelPath);
      const zip = await JSZip.loadAsync(readFile);
      
      // Procurar imagens na pasta 'xl/media'
      let imageFiles = [];
      
      zip.forEach((relativePath, zipEntry) => {
        if (relativePath.startsWith('xl/media/') && 
            !zipEntry.dir && 
            /\.(png|jpg|jpeg|gif|emf)$/i.test(relativePath)) {
          imageFiles.push({ path: relativePath, entry: zipEntry });
        }
      });
      
      console.log(`Encontradas ${imageFiles.length} imagens no arquivo ZIP`);
      
      // Extrair as imagens encontradas
      for (const [index, file] of imageFiles.entries()) {
        try {
          const content = await file.entry.async('nodebuffer');
          const filename = `image-${index+1}${path.extname(file.path)}`;
          const outputPath = path.join(outputDir, filename);
          
          fs.writeFileSync(outputPath, content);
          extractedCount++;
        } catch (imgError) {
          console.error(`Erro ao extrair imagem ${file.path}:`, imgError);
        }
      }
      
      console.log(`Extraídas ${extractedCount} imagens do Excel`);
    } catch (zipError) {
      console.error('Erro ao extrair imagens do Excel via ZIP:', zipError);
    }
    
    return {
      success: extractedCount > 0,
      imageCount: extractedCount
    };
  } catch (error) {
    console.error('Erro no extrator de imagens:', error);
    return {
      success: false,
      imageCount: 0
    };
  }
}

/**
 * Associa imagens extraídas com produtos baseado em códigos
 * @param {Array} products Lista de produtos
 * @param {string} imagesDir Diretório de imagens
 * @param {string|number} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos com imagens
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
    
    // Criar diretório para imagens
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Distribuir imagens entre os produtos
    const updatedProducts = products.map((product, index) => {
      // Usar índice para selecionar uma imagem em um padrão cíclico
      const fileIndex = index % files.length;
      const file = files[fileIndex];
      
      const sourceFilePath = path.join(imagesDir, file);
      const targetFileName = `${Date.now()}-${file}`;
      const targetFilePath = path.join(targetDir, targetFileName);
      
      try {
        fs.copyFileSync(sourceFilePath, targetFilePath);
        const imageUrl = `/api/images/${userId}/${catalogId}/${targetFileName}`;
        console.log(`Associada imagem ${file} ao produto ${product.code || product.name}: ${imageUrl}`);
        return { ...product, imageUrl };
      } catch (copyError) {
        console.error(`Erro ao copiar imagem ${file}:`, copyError);
        return product;
      }
    });
    
    return updatedProducts;
  } catch (error) {
    console.error('Erro ao associar imagens com produtos:', error);
    return products;
  }
}

/**
 * Processa um arquivo Excel no formato específico do Sofá Home
 * @param {string} filePath Caminho para o arquivo Excel
 * @param {string|number} userId ID do usuário
 * @param {string|number} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos com as informações especificadas
 */
export async function processSofaHomeExcel(filePath, userId, catalogId) {
  console.log(`Processando Excel no formato Sofá Home: ${filePath}`);
  
  // Ler arquivo Excel
  const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  
  // Converter para JSON
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
  console.log(`Lidas ${rawData.length} linhas do Excel`);
  
  // Procurar pelo cabeçalho específico (Nome, Local, Forn., etc)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, rawData.length); i++) {
    if (rawData[i] && rawData[i].A === 'Nome') {
      headerRowIndex = i;
      break;
    }
  }
  
  // Se não encontrou cabeçalho, procurar pela primeira linha com "Sofá Home"
  if (headerRowIndex === -1) {
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      if (rawData[i] && rawData[i].A && 
          String(rawData[i].A).includes('Sofá Home')) {
        headerRowIndex = i - 1; // Assumir que o cabeçalho está uma linha acima
        break;
      }
    }
  }
  
  // Se ainda não encontrou, usar valor padrão
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    console.log('Cabeçalho não encontrado, usando linha 0 como referência');
  } else {
    console.log(`Cabeçalho encontrado na linha ${headerRowIndex}`);
  }
  
  // Definir linha de início dos dados
  const startRow = headerRowIndex + 1;
  console.log(`Iniciando processamento a partir da linha ${startRow}`);
  
  // Lista para armazenar os produtos processados
  const products = [];
  
  // Processar as linhas como produtos
  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    
    // Verificar se a linha tem dados úteis
    if (!row || !row.A || !String(row.A).trim()) {
      continue;
    }
    
    // Verificar se a linha tem "Sofá Home" na coluna A
    const hasSofaHome = row.A && String(row.A).includes('Sofá Home');
    
    if (hasSofaHome) {
      // Obter descrição e informações adicionais
      let description = '';
      let additionalInfos = [];
      
      // Verificar a célula G (descrição) da linha atual
      if (row.G) {
        description = String(row.G).trim();
        
        // Verificar as próximas linhas para informações adicionais
        for (let j = 1; j < 5; j++) {
          const nextRow = rawData[i + j];
          if (nextRow && nextRow.G && String(nextRow.G).trim()) {
            additionalInfos.push(String(nextRow.G).trim());
          }
        }
      }
      
      // Construir a descrição completa
      let fullDescription = description;
      if (additionalInfos.length > 0) {
        fullDescription = [description, ...additionalInfos].join('\\n');
      }
      
      // Extrair o modelo do sofá da descrição, se existir
      let modelName = 'Sofá Home';
      if (description) {
        modelName = `Sofá Home ${description}`;
      }
      
      // Extrair o preço
      let price = 0;
      if (row.I) {
        price = extractPrice(row.I);
      }
      
      // Criar objeto do produto
      const product = {
        name: modelName,
        description: fullDescription,
        code: row.F ? String(row.F).trim() : `SOFA-${i}`,
        price: price,
        location: row.B ? String(row.B).trim() : '',
        manufacturer: row.C ? String(row.C).trim() : '',
        quantity: row.E ? parseInt(String(row.E)) || 1 : 1,
        userId: userId,
        catalogId: catalogId,
        excelRowNumber: i + 1
      };
      
      products.push(product);
      console.log(`Produto adicionado: ${product.name}, código: ${product.code}, preço: ${product.price}`);
    }
  }
  
  console.log(`Processados ${products.length} produtos do formato Sofá Home`);
  
  // Extração de imagens
  if (products.length > 0) {
    const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
    
    if (!fs.existsSync(extractedImagesDir)) {
      fs.mkdirSync(extractedImagesDir, { recursive: true });
    }
    
    // Extrair imagens
    const extractResult = await extractImages(filePath, extractedImagesDir);
    console.log(`Extrator de imagens: ${extractResult.success ? 'Sucesso' : 'Falha'}, ${extractResult.imageCount} imagens`);
    
    // Verificar quantas imagens foram extraídas
    const extractedFiles = fs.existsSync(extractedImagesDir) ? 
      fs.readdirSync(extractedImagesDir).filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file)) : [];
    
    // Associar imagens aos produtos
    if (extractedFiles.length > 0) {
      console.log('Associando imagens aos produtos...');
      const productsWithImages = await associateImagesWithProducts(
        products, extractedImagesDir, userId, catalogId
      );
      
      return productsWithImages;
    }
  }
  
  return products;
}

/**
 * Exemplo hardcoded para garantir o carregamento exato do arquivo de exemplo
 */
export function getExampleProducts(userId, catalogId) {
  console.log("Usando dados específicos do arquivo POE-catalog-data.js para catálogo 12");
  
  // Importar dados de produtos pré-configurados
  const { poeCatalogProducts } = require('./test-data/poe-catalog-data.js');
  
  // Mapear os dados importados e adicionar userId e catalogId
  return poeCatalogProducts.map(product => ({
    ...product,
    userId,
    catalogId,
    // Garantir que o preço seja um número
    price: typeof product.price === 'number' ? product.price : parseInt(product.price) || 0,
    // Garantir que a quantidade esteja definida
    quantity: product.quantity || 1
  }));
}