/**
 * Processador específico para catálogos POE
 * 
 * Este processador é otimizado para o formato específico dos catálogos POE,
 * extraindo corretamente nomes, descrições, preços e outros atributos.
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
    
    // Log para diagnóstico detalhado
    console.log(`Extraindo preço POE (bruto): "${priceString}"`);
    
    // Se a string contém apenas 0, 0.00, ou algo similar, retornar 0 imediatamente
    if (/^0([.,]0{1,2})?$/.test(priceString) || 
        priceString === "" || 
        priceString === "-" ||
        priceString.toLowerCase() === "r$0,00" ||
        priceString.toLowerCase() === "r$0.00") {
      console.log("Preço zero detectado diretamente, retornando 0");
      return 0;
    }
    
    // Remover símbolos de moeda (R$, $, etc.) e espaços
    let sanitized = priceString.replace(/R\$|\$|\€|\£/g, "").trim();
    
    // Remover caracteres não numéricos (exceto ponto e vírgula)
    sanitized = sanitized.replace(/\s/g, "").replace(/[^\d.,]/g, "");
    
    console.log(`Após limpeza básica: "${sanitized}"`);
    
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
    
    console.log(`Após normalização de formato: "${sanitized}"`);
    
    // Tentar converter para número
    const value = parseFloat(sanitized);
    
    if (isNaN(value)) {
      console.log(`Não foi possível extrair um valor numérico de "${priceString}"`);
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
 * Extrai produtos de um arquivo Excel no formato POE
 * @param {string} filePath Caminho para o arquivo Excel
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos processados
 */
export async function processPOECatalog(filePath, userId, catalogId) {
  try {
    console.log(`Processando catálogo POE: ${filePath}`);
    
    // Ler arquivo Excel para processamento
    const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', raw: true });
    
    if (!rawData || rawData.length === 0) {
      throw new Error('Planilha vazia ou inválida');
    }
    
    console.log(`Extraídos ${rawData.length} registros da planilha POE`);
    
    // Analisar as primeiras linhas para detectar cabeçalho
    console.log("Primeiras linhas do arquivo:", JSON.stringify(rawData.slice(0, 5)));
    
    // Baseado na imagem compartilhada, a estrutura do cabeçalho é diferente
    // Vamos verificar cada linha para encontrar um padrão de cabeçalho compatível
    let headerRow = -1;
    
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      // Verificar se a linha tem "Nome" na coluna B ou "Local" na coluna C ou algum outro indicador de cabeçalho
      if ((row.B && row.B.toString().includes('Nome')) || 
          (row.C && row.C.toString().includes('Local')) || 
          (row.F && row.F.toString().includes('Cód'))) {
        headerRow = i;
        console.log(`Linha de cabeçalho detectada na posição ${headerRow + 1}: ${JSON.stringify(row)}`);
        break;
      }
    }
    
    // Se não encontrou cabeçalho explícito, usar linha 0 como referência
    if (headerRow === -1) {
      headerRow = 0;
      console.log("Nenhum cabeçalho explícito encontrado, usando primeira linha como referência");
    }
    
    // Mapeamento atualizado baseado no formato real do arquivo Excel
    // Este mapeamento foi ajustado conforme solicitação do cliente
    const columnMapping = {
      // COLUNAS ATUALIZADAS DO EXCEL POE
      A: 'itemCode',      // Coluna A: Número do item (ex: "20-40k", "1-5k")
      B: 'location',      // Coluna B: "Local" - como "2°Piso", "Depósito/OUTLET", etc.
      C: 'manufacturer',  // Coluna C: Fabricante ou modelo (ex: "Boheme", "OXY")
      D: 'imageRef',      // Coluna D: "Imagem" - referência/imagem embutida
      E: 'quantity',      // Coluna E: "Qtd" - quantidade
      F: 'internalName',  // Coluna F: Nome interno (será usado como code)
      G: 'description',   // Coluna G: Descrição completa (será usada como nome do produto)
      H: 'code',          // Coluna H: Código do produto
      L: 'totalPrice',    // Coluna L: Valor Total (preço final)
      M: 'totalPrice2'    // Coluna M: Valor Total alternativo (caso L esteja vazio)
    };
    
    // Processar os dados convertendo para formato padrão de produto
    const products = [];
    
    // Processar a partir da linha após o cabeçalho
    for (let i = headerRow + 1; i < rawData.length; i++) {
      const row = rawData[i];
      
      // Verificar se há algum dado útil na linha
      let hasData = false;
      for (const value of Object.values(row)) {
        if (value && value.toString().trim()) {
          hasData = true;
          break;
        }
      }
      
      // Pular linhas completamente vazias
      if (!hasData) continue;
      
      // Verificar se é uma linha válida de produto - pular linhas de cabeçalho, título, etc
      // Condições para uma linha válida:
      // 1. Ter uma descrição significativa (G)
      // 2. Ter um código de produto (H ou F)
      // 3. Não conter textos que indicam cabeçalho como "DESCRIÇÃO", "LOCAL", "TOTAL", etc.
      
      // Verificar por textos que indicam cabeçalho
      const possibleHeaderTexts = ["descrição", "local", "valor total", "forn", "código", "qtd"];
      const isHeaderRow = Object.values(row).some(val => {
        if (!val) return false;
        const valText = val.toString().toLowerCase().trim();
        return possibleHeaderTexts.some(header => valText === header || valText.includes(header));
      });
      
      if (isHeaderRow) {
        console.log(`Linha ${i+1} parece ser um cabeçalho - ignorando`);
        continue;
      }
      
      // Verificar se a linha tem dados significativos (código ou descrição)
      if ((!row.G || row.G.toString().trim().length < 2) && 
          (!row.H || row.H.toString().trim().length < 2) && 
          (!row.F || row.F.toString().trim().length < 2)) {
        console.log(`Linha ${i+1} sem dados significativos - ignorando`);
        continue;
      }
      
      // Inicializar produto
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        excelRowNumber: i + 1,
        isEdited: false,
        
        // Valores padrão
        price: 0,
        quantity: 1,
        materials: []
      };
      
      // Extrair dados baseado no mapeamento de colunas atualizado
      console.log(`Processando linha ${i+1} do catálogo POE:`, JSON.stringify(row));

      // Código do item (geralmente um código numérico) - Coluna A
      if (row.A) {
        const itemCodeText = row.A.toString().trim();
        // Este é o identificador numérico do item
        product.itemCode = itemCodeText;
        
        // Definir uma categoria com base no itemCode se possível
        if (itemCodeText.toLowerCase().includes('sofa') || 
            itemCodeText.toLowerCase().includes('sofá')) {
          product.category = 'Sofás';
        } else if (itemCodeText.toLowerCase().includes('mesa')) {
          product.category = 'Mesas';
        } else if (itemCodeText.toLowerCase().includes('poltrona')) {
          product.category = 'Poltronas';
        } else if (itemCodeText.toLowerCase().includes('cadeira')) {
          product.category = 'Cadeiras';
        }
      }
      
      // Localização do produto - Coluna B
      if (row.B) {
        product.location = row.B.toString().trim();
      }
      
      // Fabricante/Modelo - Coluna C
      if (row.C) {
        product.manufacturer = row.C.toString().trim();
        
        // Se não temos categoria ainda, tentar extrair do fabricante
        if (!product.category) {
          const mfrText = product.manufacturer.toLowerCase();
          if (mfrText === 'boheme' || mfrText === 'oxy' || mfrText === 'dalio') {
            product.category = 'Sofás';
          } else if (mfrText.includes('chair') || mfrText.includes('cadeira')) {
            product.category = 'Cadeiras';
          } else if (mfrText.includes('mesa') || mfrText.includes('table')) {
            product.category = 'Mesas';
          }
        }
      }
      
      // Quantidade - Coluna E
      if (row.E && !isNaN(parseInt(row.E))) {
        product.quantity = parseInt(row.E);
      }
      
      // Nome interno - Coluna F - será usado como prefixo para o nome
      let internalName = '';
      if (row.F) {
        internalName = row.F.toString().trim();
        product.internalName = internalName;
      }
      
      // Descrição - Coluna G - será usado como NOME DO PRODUTO
      if (row.G) {
        const descriptionText = row.G.toString().trim();
        product.description = descriptionText;
        
        // Extrair dimensões e materiais da descrição se possível
        if (descriptionText) {
          const descLines = descriptionText.split('\\n').join('\n').split('\n');
          
          // Extrair dimensões
          const dimensionLine = descLines.find(line => 
            line.toLowerCase().includes('cm') || 
            line.toLowerCase().includes('larg') || 
            line.toLowerCase().includes('alt') || 
            line.toLowerCase().includes('prof')
          );
          
          if (dimensionLine) {
            // Tentar extrair dimensões específicas
            const dimensions = [];
            let width, height, depth;
            
            // Buscar por padrões como "L 80 x A 90 x P 70"
            const dimensionMatch = dimensionLine.match(/L\s*(\d+).*?A\s*(\d+).*?P\s*(\d+)/i);
            if (dimensionMatch) {
              width = parseInt(dimensionMatch[1]);
              height = parseInt(dimensionMatch[2]);
              depth = parseInt(dimensionMatch[3]);
            } else {
              // Tentar extrair números individuais
              const numbers = dimensionLine.match(/\d+/g);
              if (numbers && numbers.length >= 3) {
                width = parseInt(numbers[0]);
                height = parseInt(numbers[1]);
                depth = parseInt(numbers[2]);
              }
            }
            
            if (width && height && depth) {
              product.sizes = [{
                width: width,
                height: height,
                depth: depth,
                label: "Dimensões (cm)"
              }];
            }
          }
          
          // Extrair materiais
          const materials = [];
          
          // Verificar cada linha por materiais comuns
          descLines.forEach(line => {
            const lineText = line.toLowerCase();
            if (lineText.includes('tecido')) materials.push('Tecido');
            if (lineText.includes('couro')) materials.push('Couro');
            if (lineText.includes('veludo')) materials.push('Veludo');
            if (lineText.includes('algodão') || lineText.includes('algodao')) materials.push('Algodão');
            if (lineText.includes('linho')) materials.push('Linho');
            if (lineText.includes('madeira')) materials.push('Madeira');
            if (lineText.includes('metal')) materials.push('Metal');
            if (lineText.includes('vidro')) materials.push('Vidro');
            if (lineText.includes('mármore') || lineText.includes('marmore')) materials.push('Mármore');
          });
          
          if (materials.length > 0) {
            product.materials = [...new Set(materials)]; // Remover duplicatas
          }
        }
      }
      
      // CÓDIGO DO PRODUTO - Coluna H - ESTE É O CÓDIGO PRINCIPAL
      if (row.H) {
        product.code = row.H.toString().trim();
      } else if (row.F) {
        // Se não tem na coluna H, usar F como fallback
        product.code = row.F.toString().trim();
      } else if (row.A) {
        // Último recurso: usar coluna A
        product.code = row.A.toString().trim();
      } else {
        // Gerar código único
        product.code = `ITEM-${i}-${Date.now()}`;
      }
      
      // Verificar preço na coluna L (principal) ou M (alternativa)
      // Primeiro tentar L
      if (row.L) {
        const priceString = row.L.toString().trim();
        if (priceString) {
          const extractedPrice = extractPOEPrice(priceString);
          console.log(`Extraindo preço de L: "${priceString}": ${extractedPrice}`);
          product.price = !isNaN(extractedPrice) ? extractedPrice : 0;
        }
      }
      
      // Se preço ainda for 0, tentar coluna M
      if (product.price === 0 && row.M) {
        const priceString = row.M.toString().trim();
        if (priceString) {
          const extractedPrice = extractPOEPrice(priceString);
          console.log(`Extraindo preço de M: "${priceString}": ${extractedPrice}`);
          product.price = !isNaN(extractedPrice) ? extractedPrice : 0;
        }
      }
      
      // Verificar se temos um valor em J como último recurso
      if (product.price === 0 && row.J) {
        const priceString = row.J.toString().trim();
        if (priceString) {
          const extractedPrice = extractPOEPrice(priceString);
          console.log(`Extraindo preço de J: "${priceString}": ${extractedPrice}`);
          product.price = !isNaN(extractedPrice) ? extractedPrice : 0;
        }
      }
      
      // Desconto - Coluna K (Promo)
      if (row.K) {
        const discountString = row.K.toString().trim();
        // Tentar extrair apenas os números, remover "%" se presente
        const discountValue = parseFloat(discountString.replace('%', '').replace(',', '.'));
        
        if (!isNaN(discountValue)) {
          product.discount = discountValue;
        }
      }
      
      // Construir nome do produto usando a descrição como base principal
      // A coluna G (description) deve ser a fonte principal do nome
      let productName = "";
      
      // PRIORIDADE 1: Usar a descrição como nome principal se estiver disponível
      if (product.description) {
        // Extrair a primeira linha da descrição como nome
        const firstLine = product.description.split('\n')[0].trim();
        if (firstLine.length > 3) {
          productName = firstLine;
        }
      }
      // PRIORIDADE 2: Usar código do item + local + fabricante
      else if (product.itemCode) {
        productName = product.itemCode;
        
        // Adicionar localização se disponível
        if (product.location) {
          productName += " - " + product.location;
        }
        
        // Adicionar fabricante se disponível
        if (product.manufacturer && 
            !productName.toLowerCase().includes(product.manufacturer.toLowerCase())) {
          productName += " - " + product.manufacturer;
        }
      }
      // PRIORIDADE 3: Usar o código "normal" do produto
      else if (product.code) {
        productName = product.code;
      }
      // FALLBACK: Usar um nome genérico
      else {
        productName = "Item " + (i + 1);
      }
      
      // Garantir que o nome não seja muito curto
      if (productName.length < 5 && product.location) {
        productName += " - " + product.location;
      }
      
      // Caso tenhamos um código de produto e ele não esteja no nome
      if (product.code && 
          !productName.toLowerCase().includes(product.code.toLowerCase()) &&
          product.code.length > 2) {
        // Adicionar código ao final, se não for muito genérico
        if (!['local', 'nome', 'depósito', 'deposito', 'piso'].includes(product.code.toLowerCase())) {
          productName += " (Cód: " + product.code + ")";
        }
      }
      
      product.name = productName.trim();
      
      // Adicionar categoria com base no nome interno
      if (product.internalName) {
        if (product.internalName.toLowerCase().includes("sofá") || 
            product.internalName.toLowerCase().includes("sofa")) {
          product.category = "Sofás";
        } else if (product.internalName.toLowerCase().includes("mesa")) {
          product.category = "Mesas";
        } else if (product.internalName.toLowerCase().includes("cadeira")) {
          product.category = "Cadeiras";
        } else if (product.internalName.toLowerCase().includes("poltrona")) {
          product.category = "Poltronas";
        } else {
          product.category = "Móveis";
        }
      } else {
        product.category = "Móveis";
      }
      
      // Adicionar produto à lista
      products.push(product);
    }
    
    // Filtrar produtos inválidos antes de retornar
    console.log(`Produtos extraídos antes da filtragem: ${products.length}`);
    
    // Remover produtos com preço zero se a flag estiver ativa
    const filteredProducts = products.filter(product => {
      // Se tem preço zero e não é uma observação especial, ignorar
      if (product.price === 0) {
        // Verificar se parece ser uma linha de observação ou separador
        const isObservation = !product.code || 
                             product.code === "LOCAL" || 
                             product.code === "NOME" || 
                             product.name.toLowerCase().includes("total") ||
                             product.name.toLowerCase().includes("obs");
                             
        if (!isObservation) {
          console.log(`Ignorando produto com preço zero: ${product.name}`);
          return false;
        }
      }
      
      return true;
    });
    
    console.log(`Produtos finais após filtragem: ${filteredProducts.length}`);
    return filteredProducts;
  } catch (error) {
    console.error('Erro no processador de catálogo POE:', error);
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
  try {
    console.log(`Associando imagens POE com ${products.length} produtos`);
    
    // Verificar se o diretório de imagens existe
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
    
    console.log(`Encontradas ${files.length} imagens no diretório para produtos POE`);
    
    // Criar diretório para imagens associadas
    const targetDir = path.join('uploads', userId.toString(), catalogId.toString());
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Tentar associar imagens com produtos de forma mais inteligente (baseado no código)
    const updatedProducts = await Promise.all(products.map(async (product, index) => {
      // Índice padrão para o caso de não encontrar correspondência
      let fileIndex = index % files.length;
      let matched = false;
      
      // Tentar encontrar uma imagem que corresponda ao código do produto
      if (product.code) {
        const code = product.code.toString().trim().toLowerCase();
        
        // Verificar se alguma imagem tem o código no nome
        const matchingFile = files.findIndex(file => 
          file.toLowerCase().includes(code)
        );
        
        if (matchingFile >= 0) {
          fileIndex = matchingFile;
          matched = true;
          console.log(`Encontrada correspondência exata de código para ${product.code}: ${files[fileIndex]}`);
        }
      }
      
      // Se não encontrou pela correspondência exata e temos um nome de modelo
      if (!matched && product.model) {
        const model = product.model.toString().trim().toLowerCase();
        
        // Verificar se alguma imagem tem o modelo no nome
        const matchingFile = files.findIndex(file => 
          file.toLowerCase().includes(model)
        );
        
        if (matchingFile >= 0) {
          fileIndex = matchingFile;
          matched = true;
          console.log(`Encontrada correspondência por modelo para ${product.model}: ${files[fileIndex]}`);
        }
      }
      
      // Usar a imagem selecionada
      const file = files[fileIndex];
      const sourceFilePath = path.join(imagesDir, file);
      const targetFileName = `${Date.now()}-${file}`;
      const targetFilePath = path.join(targetDir, targetFileName);
      
      try {
        fs.copyFileSync(sourceFilePath, targetFilePath);
        const imageUrl = `/api/images/${userId}/${catalogId}/${targetFileName}`;
        
        if (matched) {
          console.log(`Associada imagem correspondente ${file} ao produto ${product.code || product.name}`);
        } else {
          console.log(`Associada imagem ${file} (sem correspondência específica) ao produto ${product.code || product.name}`);
        }
        
        return { ...product, imageUrl };
      } catch (copyError) {
        console.error(`Erro ao copiar imagem ${file}:`, copyError);
        return product;
      }
    }));
    
    return updatedProducts;
  } catch (error) {
    console.error('Erro ao associar imagens com produtos POE:', error);
    return products;
  }
}