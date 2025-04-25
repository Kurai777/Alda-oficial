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
 * Extrai imagens do Excel usando JSZip com informações adicionais sobre posição
 */
async function extractImagesWithJSZip(excelPath, outputDir) {
  try {
    // Usar um timestamp para garantir unicidade na extração
    const timestamp = new Date().getTime();
    
    // Ler o arquivo Excel como Buffer
    const data = await readFileAsync(excelPath);
    console.log(`Arquivo Excel lido: ${excelPath} (${data.length} bytes)`);
    
    // Processar o arquivo como ZIP
    const zip = await JSZip.loadAsync(data);
    console.log('Arquivo Excel carregado como ZIP');
    
    // Mapear relacionamentos de imagens para IDs
    const rels = {};
    const drawingRels = {};
    const imagePositions = {};
    
    // Buscar arquivos de relacionamentos
    for (const fileName in zip.files) {
      if (fileName.includes('xl/drawings/_rels/') && fileName.endsWith('.rels')) {
        const relContent = await zip.files[fileName].async('string');
        const drawingName = fileName.split('/').pop().replace('.rels', '');
        
        const matches = relContent.match(/Relationship Id="rId(\d+)" Target="\.\.\/\.\.\/media\/image(\d+)\.(png|jpeg|jpg)"/g) || [];
        
        matches.forEach(match => {
          const [, rId, imageId, ext] = match.match(/Relationship Id="rId(\d+)" Target="\.\.\/\.\.\/media\/image(\d+)\.(png|jpeg|jpg)"/);
          // Adicionar timestamp ao identificador para garantir unicidade
          drawingRels[`${drawingName}-rId${rId}-${timestamp}`] = { imageId, ext };
        });
      }
    }
    
    console.log('Relacionamentos processados:', drawingRels);
    
    // Mapear imagens em cada planilha e tentar extrair posição de linhas e colunas
    for (const fileName in zip.files) {
      if (fileName.startsWith('xl/worksheets/') && fileName.endsWith('.xml') && !fileName.includes('_rels')) {
        const sheetContent = await zip.files[fileName].async('string');
        const sheetName = fileName.split('/').pop().replace('.xml', '');
        
        // Extrair informações sobre células com desenhos/imagens
        // Exemplo formato: <twoCellAnchor><from><col>1</col><row>4</row></from>...</twoCellAnchor>
        const cellPositionMatches = sheetContent.match(/<(oneCellAnchor|twoCellAnchor)>[\s\S]*?<from><col>(\d+)<\/col><row>(\d+)<\/row><\/from>[\s\S]*?<drawing r:id="rId(\d+)"[\s\S]*?<\/(oneCellAnchor|twoCellAnchor)>/g) || [];
        
        for (const posMatch of cellPositionMatches) {
          try {
            const colMatch = posMatch.match(/<from><col>(\d+)<\/col>/);
            const rowMatch = posMatch.match(/<from><row>(\d+)<\/row>/);
            const rIdMatch = posMatch.match(/<drawing r:id="rId(\d+)"/);
            
            if (colMatch && rowMatch && rIdMatch) {
              const col = parseInt(colMatch[1]);
              const row = parseInt(rowMatch[1]);
              const rId = rIdMatch[1];
              
              // A planilha está em XML mas queremos encontrar a conexão:
              // XML worksheet -> drawing reference (rId) -> drawing file -> drawing relationships -> image
              const drawingRefKey = `${sheetName}-rId${rId}`;
              
              // Adicionar informação de posição (linha/coluna) para cada relação
              rels[drawingRefKey] = { sheet: sheetName, row, col, rId };
              
              console.log(`Encontrada imagem na posição: planilha=${sheetName}, linha=${row}, coluna=${col}, rId=${rId}`);
            }
          } catch (posError) {
            console.error('Erro ao extrair posição de imagem:', posError);
          }
        }
        
        // Também procurar por referências de desenhos padrão (para garantir compatibilidade)
        const drawingMatches = sheetContent.match(/<drawing r:id="rId(\d+)"\/>/g) || [];
        drawingMatches.forEach(match => {
          const [, rId] = match.match(/<drawing r:id="rId(\d+)"\/>/);
          if (!rels[`${sheetName}-rId${rId}`]) {
            rels[`${sheetName}-rId${rId}`] = { sheet: sheetName, rId };
          }
        });
      }
    }
    
    // Agora vamos analisar os arquivos de desenho (drawings) para mapear as referências completas
    for (const fileName in zip.files) {
      if (fileName.startsWith('xl/drawings/') && fileName.endsWith('.xml') && !fileName.includes('_rels')) {
        const drawingContent = await zip.files[fileName].async('string');
        const drawingName = fileName.split('/').pop().replace('.xml', '');
        
        // Encontrar todas as referências de embedded picture (imagens)
        const pictRefMatches = drawingContent.match(/<xdr:pic>[\s\S]*?<a:blip r:embed="rId(\d+)"[\s\S]*?<\/xdr:pic>/g) || [];
        
        for (const pictMatch of pictRefMatches) {
          try {
            const embedMatch = pictMatch.match(/<a:blip r:embed="rId(\d+)"/);
            if (embedMatch) {
              const embedId = embedMatch[1];
              // A relação completa: 
              // worksheet -> drawing -> blip embed (rId) -> image
              const drawingRelKey = `${drawingName}-rId${embedId}`;
              
              if (drawingRels[drawingRelKey]) {
                const imageId = drawingRels[drawingRelKey].imageId;
                const ext = drawingRels[drawingRelKey].ext;
                
                // Procurar qual relação de planilha usa este desenho
                for (const [relKey, relInfo] of Object.entries(rels)) {
                  if (relKey.endsWith(`-rId${relInfo.rId}`) && relKey.includes(relInfo.sheet)) {
                    // Isso conecta a imagem à sua posição na planilha!
                    imagePositions[imageId] = {
                      ...relInfo,
                      imageId,
                      ext,
                      fileName: `image${imageId}.${ext}`
                    };
                    
                    console.log(`Conectada imagem ${imageId} à posição: planilha=${relInfo.sheet}, linha=${relInfo.row}, coluna=${relInfo.col}`);
                    break;
                  }
                }
              }
            }
          } catch (refError) {
            console.error('Erro ao processar referência de imagem:', refError);
          }
        }
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
        
        // Criar objeto da imagem com informações extras sobre posição
        const imageInfo = {
          id: imageId,
          path: outputImagePath,
          fileName: `image${imageId}.${extension}`,
          size: imageBuffer.length,
          // Adicionar informações de posição se disponíveis
          ...(imagePositions[imageId] || {})
        };
        
        // Se temos informações de linha, usar o rowIndex para facilitar correspondência depois
        if (imageInfo.row !== undefined) {
          imageInfo.rowIndex = imageInfo.row;
        }
        
        console.log(`Imagem extraída: ${outputImagePath} (${imageBuffer.length} bytes)`, 
          imageInfo.row ? `posição: linha=${imageInfo.row}, coluna=${imageInfo.col}` : '');
        
        extractedImages.push(imageInfo);
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
 * Garante uma relação 1:1 estrita entre produtos e imagens
 */
async function processExcelDirectly(excelPath, userId, catalogId) {
  try {
    // Garantir que os diretórios existam
    const { extractedDir, catalogDir, userImagesDir } = await ensureDirectoriesExist(userId, catalogId);
    
    console.log(`Processando Excel: ${excelPath}`);
    console.log(`Diretório para imagens: ${catalogDir}`);
    
    // Extrair imagens do Excel (com timestamp para garantir exclusividade)
    const timestamp = new Date().getTime();
    const tempDir = path.join(process.cwd(), 'uploads', 'temp-excel-images', `excel_${timestamp}`);
    if (!fs.existsSync(tempDir)) {
      await mkdirAsync(tempDir, { recursive: true });
    }
    
    // Extrair imagens do Excel para pasta temporária única
    const extractedImages = await extractImagesWithJSZip(excelPath, tempDir);
    console.log(`Extraídas ${extractedImages.length} imagens do Excel para diretório exclusivo: ${tempDir}`);
    
    // Ler dados da planilha
    const { jsonData } = readExcelSheet(excelPath);
    console.log(`Lidas ${jsonData.length} linhas da planilha`);
    
    // Processar linhas para criar produtos
    const products = [];
    
    // Registro de imagens já utilizadas (para garantir associação 1:1)
    const usedImageIndices = new Set();
    
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
          
          // Associar imagem do Excel ao produto de forma EXATA - sem compartilhamento de imagens
          let imageUrl = null;
          
          if (extractedImages.length > 0) {
            let matchingImage = null;
            let matchType = "nenhum";
            
            // Importante: Garantir que imagens já utilizadas não sejam reatribuídas
            const availableImages = extractedImages.filter(img => !img.used);
            
            // Estratégia 1: Verificar se há uma célula com imagem EXATAMENTE nesta linha (correspondência mais confiável)
            const exactRowMatch = availableImages.find(img => img.rowIndex === i);
            if (exactRowMatch) {
              matchingImage = exactRowMatch;
              matchType = "célula exata";
            }
            // Estratégia 2: Correspondência EXATA por código (sem includes, apenas match exato)
            else if (codigo) {
              const normalizedCode = codigo.toLowerCase().trim().replace(/\s+/g, '');
              const exactCodeMatch = availableImages.find(img => {
                const imgCode = img.fileName.toLowerCase().replace(/\D/g, ''); // Extrair números
                const productCode = normalizedCode.replace(/\D/g, ''); // Extrair números
                return imgCode === productCode && productCode.length > 0;
              });
              if (exactCodeMatch) {
                matchingImage = exactCodeMatch;
                matchType = "código exato";
              }
            }
            // Estratégia 3: Correspondência por imagem na mesma posição relativa
            else {
              const positionIndex = i - 3; // Ajustar índice considerando que pulamos as linhas de cabeçalho
              if (positionIndex >= 0 && positionIndex < availableImages.length) {
                const positionMatch = availableImages[positionIndex];
                if (positionMatch) {
                  matchingImage = positionMatch;
                  matchType = "posição exata";
                }
              }
            }
            
            // Se ainda não encontramos, usar qualquer imagem disponível que não foi associada
            if (!matchingImage && availableImages.length > 0) {
              // Usar a primeira imagem disponível, mas apenas se não formos encontrar algo melhor
              matchingImage = availableImages[0];
              matchType = "próxima disponível";
            }
            
            if (matchingImage) {
              // Marcar a imagem como já utilizada para que outros produtos não a reutilizem
              matchingImage.used = true;
              
              // Criar URL mock com userId + catalogId para rastreabilidade
              const mockUrl = `https://mock-firebase-storage.com/${userId}/${catalogId}/${matchingImage.fileName}`;
              imageUrl = mockUrl;
              
              // Registrar a associação para debugging
              console.log(`Produto ${nome || 'sem nome'} (Código: ${codigo || 'sem código'}) (linha ${i+1}): associado à imagem ${matchingImage.fileName} (${matchType})`);
              
              // Garantir que a imagem seja copiada para os diretórios corretos
              try {
                const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
                const catalogDir = path.join(extractedImagesDir, `catalog-${catalogId}`);
                
                if (!fs.existsSync(catalogDir)) {
                  fs.mkdirSync(catalogDir, { recursive: true });
                }
                
                // Copiar a imagem do seu local original para o diretório do catálogo
                if (matchingImage.path && fs.existsSync(matchingImage.path)) {
                  const targetPath = path.join(catalogDir, matchingImage.fileName);
                  fs.copyFileSync(matchingImage.path, targetPath);
                }
              } catch (copyError) {
                console.error('Erro ao copiar imagem:', copyError);
              }
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