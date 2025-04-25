/**
 * Extrator direto de Excel com salvamento local
 * 
 * Este módulo extrai imagens diretamente do Excel e as salva localmente,
 * sem depender do Firebase Storage, garantindo que as imagens estejam
 * disponíveis localmente para a aplicação.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execSync } = require('child_process');
const JSZip = require('jszip');
const xlsx = require('xlsx');

// Converter funções de callback para promises
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const existsAsync = promisify(fs.exists);

/**
 * Garante que os diretórios necessários existam
 */
async function ensureDirectoriesExist(userId, catalogId) {
  const baseDir = path.join(process.cwd(), 'uploads');
  const extractedDir = path.join(baseDir, 'extracted_images');
  const catalogDir = path.join(extractedDir, `catalog-${catalogId}`);
  const userImagesDir = path.join(baseDir, 'images', userId, catalogId);
  
  // Criar diretórios se não existirem
  for (const dir of [baseDir, extractedDir, catalogDir, path.join(baseDir, 'images'), path.join(baseDir, 'images', userId), userImagesDir]) {
    if (!fs.existsSync(dir)) {
      await mkdirAsync(dir, { recursive: true });
      console.log(`Diretório criado: ${dir}`);
    }
  }
  
  return { extractedDir, catalogDir, userImagesDir };
}

/**
 * Extrai imagens do Excel usando JSZip
 */
async function extractImagesWithJSZip(excelPath, outputDir) {
  try {
    // Ler o arquivo Excel como Buffer
    const data = await readFileAsync(excelPath);
    console.log(`Arquivo Excel lido: ${excelPath} (${data.length} bytes)`);
    
    // Processar o arquivo como ZIP
    const zip = await JSZip.loadAsync(data);
    console.log('Arquivo Excel carregado como ZIP');
    
    // Mapear relacionamentos de imagens para IDs
    const rels = {};
    const drawingRels = {};
    
    // Buscar arquivos de relacionamentos
    for (const fileName in zip.files) {
      if (fileName.includes('xl/drawings/_rels/') && fileName.endsWith('.rels')) {
        const relContent = await zip.files[fileName].async('string');
        const drawingName = fileName.split('/').pop().replace('.rels', '');
        
        const matches = relContent.match(/Relationship Id="rId(\d+)" Target="\.\.\/\.\.\/media\/image(\d+)\.(png|jpeg|jpg)"/g) || [];
        
        matches.forEach(match => {
          const [, rId, imageId, ext] = match.match(/Relationship Id="rId(\d+)" Target="\.\.\/\.\.\/media\/image(\d+)\.(png|jpeg|jpg)"/);
          drawingRels[`${drawingName}-rId${rId}`] = { imageId, ext };
        });
      }
    }
    
    console.log('Relacionamentos processados:', drawingRels);
    
    // Mapear imagens em cada planilha
    for (const fileName in zip.files) {
      if (fileName.startsWith('xl/worksheets/') && fileName.endsWith('.xml') && !fileName.includes('_rels')) {
        const sheetContent = await zip.files[fileName].async('string');
        const sheetName = fileName.split('/').pop().replace('.xml', '');
        
        // Encontrar todas as referências de desenhos na planilha
        const drawingMatches = sheetContent.match(/<drawing r:id="rId(\d+)"\/>/g) || [];
        
        drawingMatches.forEach(match => {
          const [, rId] = match.match(/<drawing r:id="rId(\d+)"\/>/);
          rels[`${sheetName}-rId${rId}`] = true;
        });
      }
    }
    
    // Extrair todas as imagens do arquivo
    const extractedImages = [];
    
    for (const fileName in zip.files) {
      if (fileName.startsWith('xl/media/') && (fileName.endsWith('.png') || fileName.endsWith('.jpeg') || fileName.endsWith('.jpg'))) {
        const imageId = fileName.match(/image(\d+)\./)[1];
        const extension = fileName.split('.').pop();
        const imageBuffer = await zip.files[fileName].async('nodebuffer');
        
        const outputImagePath = path.join(outputDir, `image${imageId}.${extension}`);
        await writeFileAsync(outputImagePath, imageBuffer);
        
        console.log(`Imagem extraída: ${outputImagePath} (${imageBuffer.length} bytes)`);
        extractedImages.push({
          id: imageId,
          path: outputImagePath,
          fileName: `image${imageId}.${extension}`,
          size: imageBuffer.length
        });
      }
    }
    
    return extractedImages;
  } catch (error) {
    console.error('Erro ao extrair imagens com JSZip:', error);
    return [];
  }
}

/**
 * Lê uma planilha do Excel e extrai dados usando colunas fixas
 */
function readExcelSheet(excelPath) {
  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Converter a planilha para JSON
  const jsonData = xlsx.utils.sheet_to_json(sheet, { 
    header: 'A',
    defval: '',
    blankrows: false
  });
  
  return { jsonData, workbook, sheet };
}

/**
 * Processa um arquivo Excel para extrair produtos com imagens
 * Salva as imagens localmente e associa aos produtos
 */
async function processExcelDirectly(excelPath, userId, catalogId) {
  try {
    // Garantir que os diretórios existam
    const { extractedDir, catalogDir, userImagesDir } = await ensureDirectoriesExist(userId, catalogId);
    
    console.log(`Processando Excel: ${excelPath}`);
    console.log(`Diretório para imagens: ${catalogDir}`);
    
    // Extrair imagens do Excel
    const extractedImages = await extractImagesWithJSZip(excelPath, catalogDir);
    console.log(`Extraídas ${extractedImages.length} imagens do Excel`);
    
    // Ler dados da planilha
    const { jsonData } = readExcelSheet(excelPath);
    console.log(`Lidas ${jsonData.length} linhas da planilha`);
    
    // Processar linhas para criar produtos
    const products = [];
    
    // Pular cabeçalhos (geralmente as primeiras 3 linhas)
    for (let i = 3; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      // Verificar se há dados suficientes na linha
      if (row.A && row.B) {
        try {
          // Mapeamento para colunas fixas do planilha
          const nome = row.A || '';           // Nome (coluna A)
          const local = row.B || '';          // Local (coluna B)
          const fornecedor = row.C || '';     // Fornecedor (coluna C)
          const imagem = row.D || '';         // Imagem (coluna D)
          const codigo = row.F || '';         // Código (coluna F)
          const descricao = row.G || '';      // Descrição (coluna G)
          const preco = parseFloat(row.L) || 0; // Preço (coluna L)
          
          // Determinar categoria com base no nome ou descrição
          let categoria = 'Outros';
          const textoCompleto = (nome + ' ' + descricao).toLowerCase();
          
          if (textoCompleto.includes('sofá') || textoCompleto.includes('sofa')) {
            categoria = 'Sofás';
          } else if (textoCompleto.includes('mesa')) {
            categoria = 'Mesas';
          } else if (textoCompleto.includes('cadeira')) {
            categoria = 'Cadeiras';
          } else if (textoCompleto.includes('poltrona')) {
            categoria = 'Poltronas';
          } else if (textoCompleto.includes('armário') || textoCompleto.includes('armario')) {
            categoria = 'Armários';
          } else if (textoCompleto.includes('estante')) {
            categoria = 'Estantes';
          }
          
          // Extrair dimensões (largura x altura x profundidade)
          const dimensoesRegex = /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)/i;
          const dimensoesMatch = textoCompleto.match(dimensoesRegex);
          
          const sizes = [];
          if (dimensoesMatch) {
            const largura = parseFloat(dimensoesMatch[1].replace(',', '.'));
            const altura = parseFloat(dimensoesMatch[2].replace(',', '.'));
            const profundidade = parseFloat(dimensoesMatch[3].replace(',', '.'));
            
            sizes.push({
              width: largura,
              height: altura,
              depth: profundidade,
              label: `L${largura} x A${altura} x P${profundidade}`
            });
          }
          
          // Extrair materiais
          const materiais = [];
          const materiaisKeywords = ['madeira', 'metal', 'vidro', 'couro', 'tecido', 'linho', 'algodão', 'aço', 'alumínio', 'inox', 'mármore', 'granito', 'pedra'];
          
          materiaisKeywords.forEach(material => {
            if (textoCompleto.includes(material)) {
              // Capitalizar primeira letra
              materiais.push(material.charAt(0).toUpperCase() + material.slice(1));
            }
          });
          
          // Associar imagem do Excel ao produto
          let imageUrl = null;
          const imageIndex = i - 3; // Ajustar índice considerando que pulamos as linhas de cabeçalho
          
          if (extractedImages.length > 0) {
            // Tentar usar imagem correspondente à linha atual
            const matchingImage = extractedImages[imageIndex] || extractedImages[0];
            
            if (matchingImage) {
              // Criar caminho de URL relativo que será servido pela API
              // Exemplo: /uploads/extracted_images/catalog-123/image1.png
              const relativePath = `/uploads/extracted_images/catalog-${catalogId}/${matchingImage.fileName}`;
              imageUrl = relativePath;
              
              console.log(`Produto ${nome} (linha ${i+1}): associado à imagem ${matchingImage.fileName}`);
            }
          }
          
          // Criar objeto do produto
          const product = {
            nome,
            codigo,
            descricao: `${nome} | Código: ${codigo} | ${descricao}`,
            preco,
            categoria,
            fornecedor,
            local,
            imageUrl,
            materiais,
            tamanhos: sizes,
            userId,
            catalogId
          };
          
          products.push(product);
          
        } catch (error) {
          console.error(`Erro ao processar linha ${i+1}:`, error);
        }
      }
    }
    
    console.log(`Processados ${products.length} produtos com ${extractedImages.length} imagens`);
    return products;
    
  } catch (error) {
    console.error('Erro ao processar Excel:', error);
    throw error;
  }
}

module.exports = {
  processExcelDirectly
};