/**
 * Processador específico para catálogos POE - NOVA VERSÃO
 * 
 * Este processador segue exatamente o mapeamento de colunas solicitado:
 * - Nome do Produto => Coluna G (Descrição)
 * - Código do Produto => Coluna H (Código do Produto)
 * - Preço => Coluna M (Valor Total)
 * - Categoria => Inferida do fornecedor ou nome do produto
 * - Materiais => Opcionais, inferidos do nome se possível
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

/**
 * Extrai valor de preço de uma string formatada no padrão monetário brasileiro
 * @param {string} priceStr String contendo o preço (ex: "R$ 1.234,56")
 * @returns {number} Valor em centavos (ex: 123456)
 */
function extractPOEPrice(priceStr) {
  if (!priceStr) return 0;
  
  try {
    // Converter para string se não for
    const priceString = priceStr.toString().trim();
    
    // Log para diagnóstico
    console.log(`Extraindo preço (bruto): "${priceString}"`);
    
    // Se a string contém apenas 0, 0.00, ou algo similar, retornar 0 imediatamente
    if (/^0([.,]0{1,2})?$/.test(priceString) || 
        priceString === "" || 
        priceString === "-" ||
        priceString.toLowerCase() === "r$0,00" ||
        priceString.toLowerCase() === "r$0.00") {
      console.log("Preço zero detectado, retornando 0");
      return 0;
    }
    
    // Remover símbolos de moeda (R$, $, etc.) e espaços
    let sanitized = priceString.replace(/R\$|\$|\€|\£/g, "").trim();
    
    // Remover caracteres não numéricos (exceto ponto e vírgula)
    sanitized = sanitized.replace(/\s/g, "").replace(/[^\d.,]/g, "");
    
    console.log(`Após limpeza: "${sanitized}"`);
    
    // Detectar o formato brasileiro (1.234,56) vs internacional (1,234.56)
    const isBrazilianFormat = sanitized.includes(',') && 
                            (sanitized.indexOf(',') > sanitized.indexOf('.') || !sanitized.includes('.'));
    
    if (isBrazilianFormat) {
      // Formato brasileiro: remover pontos de milhar, substituir vírgula por ponto
      sanitized = sanitized.replace(/\./g, "");
      sanitized = sanitized.replace(',', '.');
    } else if (sanitized.includes(',') && !sanitized.includes('.')) {
      // Caso especial: número apenas com vírgula (ex: "1,5")
      sanitized = sanitized.replace(',', '.');
    }
    
    console.log(`Após normalização: "${sanitized}"`);
    
    // Tentar converter para número
    const value = parseFloat(sanitized);
    
    if (isNaN(value)) {
      console.log(`Erro ao extrair valor numérico de "${priceString}"`);
      return 0;
    }
    
    // Se o valor é zero, retornar zero diretamente
    if (value === 0) {
      return 0;
    }
    
    // Converter para centavos (multiplicar por 100)
    const cents = Math.round(value * 100);
    console.log(`Valor extraído: ${value} -> ${cents} centavos`);
    
    return cents;
  } catch (error) {
    console.error(`Erro ao processar preço "${priceStr}":`, error);
    return 0;
  }
}

/**
 * Verifica se uma linha deve ser ignorada por conter textos de seção/cabeçalho
 * @param {Object} row Linha do Excel 
 * @returns {boolean} True se a linha deve ser ignorada
 */
function isIgnorableLine(row) {
  // Verificar se é uma linha de cabeçalho
  const headerKeywords = ['descrição', 'código', 'qtd', 'valor', 'local', 'fornecedor'];
  
  // Verificar por textos comuns de cabeçalho em qualquer coluna
  for (const key in row) {
    if (row[key]) {
      const cellValue = row[key].toString().toLowerCase().trim();
      if (headerKeywords.some(keyword => cellValue === keyword || cellValue.includes(keyword))) {
        console.log(`Ignorando linha de cabeçalho: "${cellValue}"`);
        return true;
      }
    }
  }
  
  // Verificar se é uma linha de faixa de preço ou localização
  if (row.B) {
    const valueB = row.B.toString().toLowerCase().trim();
    if (/^\d+k$/i.test(valueB) || 
        /^\d+\s*-\s*\d+k$/i.test(valueB) ||
        valueB.includes('piso') || 
        valueB.includes('andar')) {
      console.log(`Ignorando linha de faixa de preço/localização: "${valueB}"`);
      return true; 
    }
  }
  
  // Verificar também na coluna H (código) se é uma localização
  if (row.H) {
    const valueH = row.H.toString().toLowerCase().trim();
    if (valueH.includes('piso') || 
        valueH.includes('andar') ||
        /^\d+º/i.test(valueH)) {
      console.log(`Ignorando linha com código inválido: "${valueH}"`);
      return true;
    }
  }
  
  return false;
}

/**
 * Infere categoria com base no nome do produto ou fornecedor
 * @param {string} productName Nome do produto
 * @param {string} manufacturer Fornecedor/fabricante
 * @returns {string} Categoria inferida
 */
function inferCategory(productName, manufacturer) {
  // Normalizar para busca
  const nameLower = productName ? productName.toLowerCase() : '';
  const mfrLower = manufacturer ? manufacturer.toLowerCase() : '';
  
  // Tentar inferir do nome do produto primeiro
  if (nameLower.includes('sofá') || nameLower.includes('sofa') || nameLower.includes('poltrona')) {
    return 'Sofás';
  } else if (nameLower.includes('mesa')) {
    return 'Mesas';
  } else if (nameLower.includes('cadeira')) {
    return 'Cadeiras';
  } else if (nameLower.includes('estante') || nameLower.includes('prateleira')) {
    return 'Estantes';
  } else if (nameLower.includes('cama') || nameLower.includes('colchão')) {
    return 'Camas';
  } else if (nameLower.includes('luminária') || nameLower.includes('lustre') || nameLower.includes('pendente')) {
    return 'Iluminação';
  } else if (nameLower.includes('tapete') || nameLower.includes('carpete')) {
    return 'Tapetes';
  } else if (nameLower.includes('armário') || nameLower.includes('guarda-roupa')) {
    return 'Armários';
  }
  
  // Depois tentar inferir do fabricante
  if (mfrLower) {
    if (mfrLower === 'boheme' || mfrLower === 'oxy' || mfrLower === 'dalio' || mfrLower.includes('estof')) {
      return 'Sofás';
    } else if (mfrLower.includes('lumin') || mfrLower.includes('light')) {
      return 'Iluminação';
    } else if (mfrLower.includes('chair') || mfrLower.includes('cadeira')) {
      return 'Cadeiras';
    } else if (mfrLower.includes('mesa') || mfrLower.includes('table')) {
      return 'Mesas';
    }
  }
  
  // Categoria padrão
  return 'Móveis';
}

/**
 * Extrai produtos de um arquivo Excel no formato POE
 * @param {string} filePath Caminho para o arquivo Excel
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos processados
 */
export async function processPOECatalog(filePath, userId, catalogId) {
  try {
    console.log(`\n=== INICIANDO PROCESSAMENTO POE (NOVA VERSÃO) ===`);
    console.log(`Arquivo: ${filePath}`);
    
    // Ler arquivo Excel
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Extraídos ${rawData.length} registros da planilha`);
    
    // Lista para armazenar produtos processados
    const products = [];
    
    // Processar cada linha
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;
      
      console.log(`\n--- PROCESSANDO LINHA ${rowNum} ---`);
      
      // Verificar se a linha é válida (não é cabeçalho, faixa de preço, etc)
      if (isIgnorableLine(row)) {
        console.log(`Linha ${rowNum} IGNORADA - cabeçalho, faixa de preço ou localização`);
        continue;
      }
      
      // ETAPA 1: NOME DO PRODUTO - DEVE VIR DA COLUNA G (DESCRIÇÃO)
      if (!row.G) {
        console.log(`Linha ${rowNum} sem nome de produto (coluna G vazia). IGNORANDO`);
        continue;
      }
      
      const productName = row.G.toString().trim();
      if (productName.length < 3) {
        console.log(`Linha ${rowNum} com nome muito curto: "${productName}". IGNORANDO`);
        continue;
      }
      
      console.log(`Nome do produto (coluna G): "${productName}"`);
      
      // ETAPA 2: CÓDIGO DO PRODUTO - DEVE VIR DA COLUNA H
      if (!row.H) {
        console.log(`Linha ${rowNum} sem código de produto (coluna H vazia). IGNORANDO`);
        continue;
      }
      
      const productCode = row.H.toString().trim();
      console.log(`Código do produto (coluna H): "${productCode}"`);
      
      // Verificar se o código parece ser uma localização ou faixa de preço
      if (productCode.toLowerCase().includes('piso') || 
          /^\d+º/i.test(productCode) || 
          /^\d+-\d+k$/i.test(productCode)) {
        console.log(`Código inválido (parece ser localização): "${productCode}". IGNORANDO`);
        continue;
      }
      
      // ETAPA 3: PREÇO DO PRODUTO - DEVE VIR DA COLUNA M (VALOR TOTAL)
      let productPrice = 0;
      
      if (row.M) {
        productPrice = extractPOEPrice(row.M);
        console.log(`Preço do produto (coluna M): ${row.M} -> ${productPrice} centavos`);
      } else {
        console.log(`Preço não encontrado na coluna M. Definindo como zero.`);
      }
      
      // ETAPA 4: FORNECEDOR - COLUNA C
      let manufacturer = '';
      if (row.C) {
        manufacturer = row.C.toString().trim();
        console.log(`Fornecedor (coluna C): "${manufacturer}"`);
      }
      
      // ETAPA 5: LOCALIZAÇÃO - COLUNA B
      let location = '';
      if (row.B) {
        location = row.B.toString().trim();
        console.log(`Localização (coluna B): "${location}"`);
      }
      
      // ETAPA 6: INFERIR CATEGORIA
      const category = inferCategory(productName, manufacturer);
      console.log(`Categoria inferida: "${category}"`);
      
      // ETAPA 7: EXTRAIR MATERIAIS DO NOME (OPCIONAL)
      const materials = [];
      const materialKeywords = {
        'madeira': 'Madeira',
        'metal': 'Metal',
        'tecido': 'Tecido',
        'couro': 'Couro',
        'vidro': 'Vidro',
        'mármore': 'Mármore',
        'veludo': 'Veludo',
        'inox': 'Aço Inox',
        'fórmica': 'Fórmica',
        'linho': 'Linho'
      };
      
      const nameLower = productName.toLowerCase();
      for (const [keyword, material] of Object.entries(materialKeywords)) {
        if (nameLower.includes(keyword)) {
          materials.push(material);
        }
      }
      
      // CRIAR OBJETO DO PRODUTO COM TODOS OS CAMPOS NECESSÁRIOS
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        name: productName,           // Coluna G (Descrição)
        code: productCode,           // Coluna H (Código)
        description: productName,    // Usar o mesmo que o nome
        price: productPrice,         // Coluna M (Valor Total)
        category: category,          // Inferido
        manufacturer: manufacturer,  // Coluna C
        materials: materials,        // Inferido do nome
        colors: [],                  // Nenhum por padrão
        location: location,          // Coluna B
        excelRowNumber: rowNum,
        isEdited: false
      };
      
      // Adicionar produto à lista
      products.push(product);
      console.log(`✅ Produto POE extraído com sucesso da linha ${rowNum}: ${product.name} (${product.code}) - R$ ${(product.price/100).toFixed(2)}`);
    }
    
    console.log(`\n=== PROCESSAMENTO POE CONCLUÍDO ===`);
    console.log(`Total de produtos extraídos: ${products.length}`);
    
    return products;
    
  } catch (error) {
    console.error("Erro ao processar catálogo POE:", error);
    throw error;
  }
}

/**
 * Extrai e associa imagens a produtos de catálogo POE
 * @param {Array} products Lista de produtos
 * @param {string} excelPath Caminho do arquivo Excel
 * @param {string} imagesDir Diretório de imagens extraídas
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos com imagens associadas
 */
export async function associatePOEProductsWithImages(products, excelPath, imagesDir, userId, catalogId) {
  console.log(`\n=== ASSOCIANDO IMAGENS A ${products.length} PRODUTOS POE ===`);
  
  try {
    // Verificar o diretório de imagens
    if (!fs.existsSync(imagesDir)) {
      console.log(`Diretório de imagens não encontrado: ${imagesDir}`);
      return products;
    }
    
    // Listar todas as imagens extraídas
    const imageFiles = fs.readdirSync(imagesDir);
    console.log(`Encontradas ${imageFiles.length} imagens extraídas em ${imagesDir}`);
    
    if (imageFiles.length === 0) {
      console.log("Nenhuma imagem encontrada para associar");
      return products;
    }
    
    // Pasta para salvar as imagens processadas
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Criar mapeamento de linha do Excel para produto
    const rowToProductMap = {};
    products.forEach(product => {
      if (product.excelRowNumber) {
        rowToProductMap[product.excelRowNumber] = product;
      }
    });
    
    // Associar imagens aos produtos
    const timestamp = Date.now();
    let imagesAssociated = 0;
    
    for (let i = 0; i < imageFiles.length; i++) {
      const imageFile = imageFiles[i];
      
      // Extrair número da imagem do nome do arquivo
      const match = imageFile.match(/image[-_]?(\d+)\.(?:png|jpe?g|gif|webp)/i);
      if (!match) continue;
      
      const imageNumber = parseInt(match[1]);
      if (isNaN(imageNumber)) continue;
      
      // Encontrar produto com número similar
      let targetProduct = null;
      
      // Tentar corresponder pelo número da linha
      for (const product of products) {
        // Verificar se o número de linha está próximo do número da imagem
        if (Math.abs(product.excelRowNumber - imageNumber) <= 3) {
          targetProduct = product;
          break;
        }
      }
      
      // Se não encontrou, tenta pelo índice do produto na lista
      if (!targetProduct && i < products.length) {
        targetProduct = products[i];
      }
      
      if (targetProduct) {
        // Copiar a imagem para o diretório de destino
        const newImageName = `${timestamp}-${imageFile}`;
        const targetPath = path.join(targetDir, newImageName);
        
        fs.copyFileSync(path.join(imagesDir, imageFile), targetPath);
        
        // Atualizar URL da imagem no produto
        targetProduct.imageUrl = `/api/images/${userId}/${catalogId}/${newImageName}`;
        
        console.log(`✅ Imagem ${imageFile} associada ao produto "${targetProduct.name}" (${targetProduct.code})`);
        imagesAssociated++;
      }
    }
    
    console.log(`=== ASSOCIAÇÃO DE IMAGENS CONCLUÍDA ===`);
    console.log(`Total: ${imagesAssociated} imagens associadas de ${imageFiles.length} disponíveis`);
    
    return products;
  } catch (error) {
    console.error("Erro ao associar imagens a produtos POE:", error);
    // Retorna os produtos sem imagens em caso de erro
    return products;
  }
}