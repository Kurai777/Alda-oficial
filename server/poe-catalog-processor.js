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
    
    // Remover símbolos de moeda (R$, $, etc.)
    let sanitized = priceString.replace(/R\$|\$|\€|\£/g, "").trim();
    
    // Remover espaços e caracteres não numéricos (exceto ponto e vírgula)
    sanitized = sanitized.replace(/\s/g, "").replace(/[^\d.,]/g, "");
    
    console.log(`Após limpeza básica: "${sanitized}"`);
    
    // Substituir pontos de milhar, preservando a vírgula decimal
    // Formato brasileiro: 1.234,56 -> 1234.56
    if (sanitized.includes(',')) {
      // Se tem vírgula, assumimos formato brasileiro
      sanitized = sanitized.replace(/\./g, ""); // Remove pontos de milhar
      sanitized = sanitized.replace(',', '.'); // Substitui vírgula por ponto para cálculo
    }
    
    console.log(`Após tratamento formato: "${sanitized}"`);
    
    // Tentar converter para número
    const value = parseFloat(sanitized);
    
    if (isNaN(value)) {
      console.log(`Não foi possível extrair um valor numérico de "${priceString}"`);
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
    
    // Mapeamento exato baseado no arquivo Excel POE real
    // Este mapeamento é baseado na estrutura mostrada na imagem do Excel POE
    const columnMapping = {
      // COLUNAS DO EXCEL POE
      A: 'internalName',  // Coluna A: Nome interno como "Sofá Home"
      B: 'location',      // Coluna B: "Local" - como "2°Piso", "Depósito/OUTLET", etc.
      C: 'form',          // Coluna C: "Form." - como "Enobli", "LL", "AC"
      D: 'imageRef',      // Coluna D: "Imagem" - referência/imagem embutida
      E: 'quantity',      // Coluna E: "Qtd" - quantidade
      F: 'code',          // Coluna F: "Cód." - código do produto como "SLEEP2313"
      G: 'description',   // Coluna G: "Descrição" - descrição completa com detalhes técnicos
      H: 'date',          // Coluna H: "Data Showroom" - como "maio/24"
      I: 'unitPrice',     // Coluna I: "Valor Unitário" - preço unitário
      J: 'totalPrice',    // Coluna J: "Valor Total" - preço total (principal)
      K: 'discount'       // Coluna K: "Promo" - desconto como "0,00%"
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
      
      // Verificar se é uma linha de produto (deve ter código ou nome)
      if (!row.F && !row.A) continue;
      
      // Inicializar produto
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        excelRowNumber: i + 1,
        isEdited: false,
        
        // Valores padrão
        price: 0,
        quantity: 1
      };
      
      // Extrair dados baseado no mapeamento de colunas
      // Logging para analisar cada linha de produto
      console.log(`Processando linha ${i+1} do catálogo POE:`, JSON.stringify(row));

      // Nome interno do produto (Sofá Home, etc) - Coluna A
      if (row.A) {
        product.internalName = row.A.toString().trim();
      }
      
      // Localização do produto (2°Piso, Depósito/OUTLET, etc) - Coluna B
      if (row.B) {
        product.location = row.B.toString().trim();
      }
      
      // Forma/material (Enobli, LL, AC, etc) - Coluna C
      if (row.C) {
        product.form = row.C.toString().trim();
      }
      
      // Quantidade - Coluna E
      if (row.E && !isNaN(parseInt(row.E))) {
        product.quantity = parseInt(row.E);
      }
      
      // Código do produto (SLEEP2313, etc) - Coluna F
      if (row.F) {
        product.code = row.F.toString().trim();
      }
      
      // Descrição completa - Coluna G
      if (row.G) {
        product.description = row.G.toString().trim();
        
        // Extrair mais informações da descrição para detalhamento
        const descLines = product.description.split('\\n').join('\n').split('\n');
        
        if (descLines.length > 0) {
          // O primeiro item da descrição geralmente é o modelo/tipo específico
          product.model = descLines[0].trim();
          
          // Verificar profundidade em uma das linhas
          const depthLine = descLines.find(line => 
            line.toLowerCase().includes('profundidade') || 
            line.toLowerCase().includes('aberto')
          );
          
          if (depthLine) {
            product.dimensions = depthLine.trim();
          }
          
          // Verificar material/tecido em uma das linhas
          const materialLine = descLines.find(line => 
            line.toLowerCase().includes('tecido') || 
            line.toLowerCase().includes('couro')
          );
          
          if (materialLine) {
            product.material = materialLine.trim();
          }
        }
      }
      
      // Data do showroom
      if (row.I) {
        product.date = row.I.toString().trim();
      }
      
      // Preço - Coluna J (Valor Total)
      if (row.J) {
        const priceString = row.J.toString().trim();
        const extractedPrice = extractPOEPrice(priceString);
        
        // Fazer log do processo de extração do preço para debugging
        console.log(`Extraindo preço de "${priceString}": ${extractedPrice}`);
        
        product.price = !isNaN(extractedPrice) ? extractedPrice : 0;
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
      // Formato prioritário: [descrição] ou [model] ou [internalName + code]
      // Exemplo ideal: "Sleep Tecido 262" ou "Sofá Home Sleep - 2°Piso - Enobli" 
      let productName = "";
      
      // Prioridade 1: Usar a primeira linha da descrição como nome principal
      if (product.model) {
        productName = product.model;
      } 
      // Prioridade 2: Usar o nome interno
      else if (product.internalName) {
        productName = product.internalName;
        
        // Adicionar código se disponível e não incluso
        if (product.code && !productName.toLowerCase().includes(product.code.toLowerCase())) {
          productName += " " + product.code;
        }
      } 
      // Prioridade 3: Usar apenas o código
      else if (product.code) {
        productName = "Produto " + product.code;
      } 
      // Fallback
      else {
        productName = "Item linha " + (i + 1);
      }
      
      // Adicionar localização e forma se relevantes e não inclusos
      // Apenas se não forem genéricos demais
      if (product.location && 
          !productName.toLowerCase().includes(product.location.toLowerCase()) &&
          product.location.length > 2 && // Evitar adicionar locais muito curtos/genéricos
          !["ac", "ll"].includes(product.location.toLowerCase())) { // Evitar locais não descritivos
        productName += " - " + product.location;
      }
      
      if (product.form && 
          !productName.toLowerCase().includes(product.form.toLowerCase()) &&
          !["ac", "ll"].includes(product.form.toLowerCase()) && // Evitar formas não descritivas
          product.form.length > 2) { // Evitar adicionar formas muito curtas/genéricas
        productName += " - " + product.form;
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
    
    console.log(`Extraídos ${products.length} produtos do catálogo POE`);
    return products;
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