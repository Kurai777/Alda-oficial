/**
 * Processador específico para catálogos POE
 * 
 * Este processador é otimizado para o formato específico dos catálogos POE,
 * extraindo corretamente nomes, descrições, preços e outros atributos.
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { extractPrice } from './excel-format-detector.js';

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
    
    // Determinar linha de cabeçalho (normalmente 1 para POE)
    let headerRow = 1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (row.C === 'Nome' && row.B === 'Local' && row.F === 'Cód.') {
        headerRow = i;
        console.log(`Linha de cabeçalho encontrada na posição ${headerRow + 1}`);
        break;
      }
    }
    
    // Mapeamento de colunas para o formato POE
    // Este mapeamento é baseado na estrutura mostrada na imagem do Excel
    const columnMapping = {
      A: 'internalName',  // Coluna A: "Sofá Home" 
      B: 'location',      // Coluna B: "2°Piso", "Depósito/OUTLET", etc
      C: 'form',          // Coluna C: Forma/tipo como "Enobli", "LL", "AC"
      D: 'imageRef',      // Coluna D: Referência para imagem
      E: 'quantity',      // Coluna E: Quantidade
      F: 'code',          // Coluna F: Código do produto
      G: 'description',   // Coluna G: Descrição detalhada do produto
      H: 'date',          // Coluna H: Data
      I: 'price',         // Coluna I: Preço
      J: 'totalPrice',    // Coluna J: Preço total
      K: 'discount',      // Coluna K: Desconto
      L: 'barcode',       // Coluna L: Código de barras
      M: 'extraInfo'      // Coluna M: Informação extra
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
      // Nome do produto: combinar colunas A (tipo) + descrição (Sleep, Boheme, etc)
      if (row.A) product.internalName = row.A.toString().trim();
      
      // Localização do produto
      if (row.B) product.location = row.B.toString().trim();
      
      // Forma/material
      if (row.C) product.form = row.C.toString().trim();
      
      // Quantidade
      if (row.E && !isNaN(parseInt(row.E))) {
        product.quantity = parseInt(row.E);
      }
      
      // Código do produto
      if (row.F) product.code = row.F.toString().trim();
      
      // Descrição completa
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
      
      // Data
      if (row.H) product.date = row.H.toString().trim();
      
      // Preço
      if (row.I) {
        const extractedPrice = extractPrice(row.I);
        product.price = !isNaN(extractedPrice) ? extractedPrice : 0;
      }
      
      // Preço total
      if (row.J) {
        const extractedTotal = extractPrice(row.J);
        product.totalPrice = !isNaN(extractedTotal) ? extractedTotal : 0;
      }
      
      // Desconto
      if (row.K && !isNaN(parseFloat(row.K))) {
        product.discount = parseFloat(row.K);
      }
      
      // Construir nome do produto
      // Formato: [internalName + model] + [location] + [form]
      // Exemplo: "Sofá Home Sleep - 2°Piso - Enobli"
      let productName = "";
      
      if (product.internalName) {
        productName += product.internalName;
        if (product.model && !productName.includes(product.model)) {
          productName += " " + product.model;
        }
      } else if (product.code) {
        productName = "Produto " + product.code;
      } else {
        productName = "Item linha " + (i + 1);
      }
      
      // Adicionar localização e forma se diferentes
      if (product.location && !productName.includes(product.location)) {
        productName += " - " + product.location;
      }
      
      if (product.form && !productName.includes(product.form)) {
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