/**
 * Analisador de Excel Baseado em IA
 * 
 * Este módulo usa a IA para analisar a estrutura completa de um arquivo Excel
 * e determinar dinamicamente o mapeamento correto das colunas para os campos de produto,
 * sem depender de posições fixas.
 */

import XLSX from 'xlsx';
import fs from 'fs';
import OpenAI from 'openai';

// Inicializar cliente OpenAI
// o modelo mais recente do OpenAI é "gpt-4o" que foi lançado em 13 de maio de 2024. não altere isso a menos que seja explicitamente solicitado pelo usuário
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analisa a estrutura do Excel e determina o mapeamento de colunas usando IA
 * 
 * @param {string} filePath Caminho do arquivo Excel
 * @returns {Promise<Object>} Mapeamento de colunas (ex: { nome: 'G', codigo: 'H', preco: 'M', ... })
 */
export async function analyzeExcelStructure(filePath) {
  try {
    console.log(`\n=== INICIANDO ANÁLISE DE ESTRUTURA DO EXCEL COM IA ===`);
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
    
    // Obter primeiras linhas para análise (até 30 linhas)
    const sampleRows = rawData.slice(0, Math.min(30, rawData.length));
    
    // Obter todas as colunas disponíveis
    const allColumns = new Set();
    sampleRows.forEach(row => {
      Object.keys(row).forEach(col => allColumns.add(col));
    });
    
    // Criar amostra para enviar à IA
    const columnSamples = {};
    Array.from(allColumns).forEach(column => {
      columnSamples[column] = sampleRows
        .filter(row => row[column] !== undefined)
        .map(row => String(row[column]))
        .slice(0, 10); // Limite de 10 exemplos por coluna
    });
    
    // Criar prompt para OpenAI
    const prompt = `Analise a estrutura deste arquivo Excel que contém um catálogo de produtos.
Estas são as primeiras linhas do Excel, organizadas por coluna:

${JSON.stringify(columnSamples, null, 2)}

Baseado nos dados acima, identifique qual coluna contém cada uma das seguintes informações:
1. Nome do produto
2. Código do produto
3. Preço
4. Descrição
5. Categoria
6. Fornecedor/Fabricante
7. Localização/Posição
8. Materiais
9. Dimensões

Forneça sua resposta em formato JSON contendo o mapeamento de colunas para esses campos.
Use o formato { "campo": "coluna_letra" }, onde "coluna_letra" é a letra da coluna (A, B, C, etc.).
Se algum campo não for encontrado, defina o valor como null.

Exemplos de resposta:
{
  "nome": "G",
  "codigo": "H",
  "preco": "M",
  "descricao": null,
  "categoria": "C",
  "fornecedor": "D",
  "localizacao": "B",
  "materiais": null,
  "dimensoes": null
}`;

    // Chamar a API da OpenAI
    console.log("Enviando amostra do Excel para análise com IA...");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" }
    });
    
    // Extrair e processar a resposta
    const result = response.choices[0].message.content;
    
    try {
      // Parse da resposta JSON
      const mapping = JSON.parse(result);
      
      console.log("Mapeamento determinado pela IA:");
      console.log(JSON.stringify(mapping, null, 2));
      
      // Verificar se pelo menos os campos essenciais foram mapeados (nome, código)
      if (!mapping.nome && !mapping.codigo) {
        console.log("AVISO: IA não conseguiu identificar campos essenciais. Usando mapeamento padrão.");
        return {
          nome: "G",
          codigo: "H",
          preco: "M",
          descricao: null,
          categoria: null,
          fornecedor: "C",
          localizacao: "B",
          materiais: null,
          dimensoes: null
        };
      }
      
      return mapping;
      
    } catch (parseError) {
      console.error("Erro ao fazer parse da resposta da IA:", parseError);
      console.log("Usando mapeamento padrão como fallback...");
      
      // Mapeamento padrão em caso de erro
      return {
        nome: "G",
        codigo: "H",
        preco: "M",
        descricao: null,
        categoria: null,
        fornecedor: "C",
        localizacao: "B",
        materiais: null,
        dimensoes: null
      };
    }
    
  } catch (error) {
    console.error("Erro ao analisar estrutura do Excel:", error);
    
    // Em caso de erro, retornar mapeamento padrão
    return {
      nome: "G",
      codigo: "H",
      preco: "M",
      descricao: null,
      categoria: null,
      fornecedor: "C",
      localizacao: "B",
      materiais: null,
      dimensoes: null
    };
  }
}

/**
 * Processa um arquivo Excel com mapeamento dinâmico determinado pela IA
 * 
 * @param {string} filePath Caminho do arquivo Excel
 * @param {Object} mapping Mapeamento de colunas determinado pela AI
 * @param {any} userId ID do usuário
 * @param {any} catalogId ID do catálogo
 * @returns {Promise<Array>} Lista de produtos processados
 */
export async function processExcelWithAIMapping(filePath, mapping, userId, catalogId) {
  try {
    console.log(`\n=== INICIANDO PROCESSAMENTO COM MAPEAMENTO DINÂMICO ===`);
    console.log(`Arquivo: ${filePath}`);
    console.log(`Mapeamento determinado pela IA:`);
    console.log(JSON.stringify(mapping, null, 2));
    
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
    
    // Função para verificar se uma linha deve ser ignorada
    function isIgnorableLine(row) {
      // Verificar se é uma linha de cabeçalho
      const headerKeywords = ['descrição', 'código', 'qtd', 'valor', 'local', 'fornecedor'];
      
      // Verificar por textos comuns de cabeçalho em qualquer coluna
      for (const key in row) {
        if (row[key]) {
          const cellValue = row[key].toString().toLowerCase().trim();
          if (headerKeywords.some(keyword => cellValue === keyword || cellValue.includes(keyword))) {
            return true;
          }
        }
      }
      
      // Verificar se é uma linha de faixa de preço ou localização
      const locationColumn = mapping.localizacao;
      if (locationColumn && row[locationColumn]) {
        const locationValue = row[locationColumn].toString().toLowerCase().trim();
        if (/^\d+k$/i.test(locationValue) || 
            /^\d+\s*-\s*\d+k$/i.test(locationValue) ||
            locationValue.includes('piso') || 
            locationValue.includes('andar')) {
          return true; 
        }
      }
      
      // Verificar também no código se é uma localização
      const codeColumn = mapping.codigo;
      if (codeColumn && row[codeColumn]) {
        const codeValue = row[codeColumn].toString().toLowerCase().trim();
        if (codeValue.includes('piso') || 
            codeValue.includes('andar') ||
            /^\d+º/i.test(codeValue)) {
          return true;
        }
      }
      
      return false;
    }
    
    // Função para extrair preço
    function extractPrice(priceStr) {
      if (!priceStr) return 0;
      
      try {
        // Converter para string se não for
        const priceString = priceStr.toString().trim();
        
        // Se a string contém apenas 0, 0.00, ou algo similar, retornar 0 imediatamente
        if (/^0([.,]0{1,2})?$/.test(priceString) || 
            priceString === "" || 
            priceString === "-" ||
            priceString.toLowerCase() === "r$0,00" ||
            priceString.toLowerCase() === "r$0.00") {
          return 0;
        }
        
        // Remover símbolos de moeda (R$, $, etc.) e espaços
        let sanitized = priceString.replace(/R\$|\$|\€|\£/g, "").trim();
        
        // Remover caracteres não numéricos (exceto ponto e vírgula)
        sanitized = sanitized.replace(/\s/g, "").replace(/[^\d.,]/g, "");
        
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
        
        // Tentar converter para número
        const value = parseFloat(sanitized);
        
        if (isNaN(value)) {
          return 0;
        }
        
        // Se o valor é zero, retornar zero diretamente
        if (value === 0) {
          return 0;
        }
        
        // Converter para centavos (multiplicar por 100)
        const cents = Math.round(value * 100);
        
        return cents;
      } catch (error) {
        console.error(`Erro ao processar preço "${priceStr}":`, error);
        return 0;
      }
    }
    
    // Função para inferir categoria
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
    
    // Função para extrair materiais do nome do produto
    function extractMaterials(productName) {
      const materials = [];
      if (!productName) return materials;
      
      const nameLower = productName.toLowerCase();
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
        'linho': 'Linho',
        'alumínio': 'Alumínio'
      };
      
      for (const [keyword, material] of Object.entries(materialKeywords)) {
        if (nameLower.includes(keyword)) {
          materials.push(material);
        }
      }
      
      return materials;
    }
    
    // Ignorar linhas que parecem ser cabeçalho
    let startRow = 0;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (isIgnorableLine(row)) {
        startRow = i + 1;
        console.log(`Detectado cabeçalho na linha ${i+1}, começando a partir da linha ${startRow+1}`);
      }
    }
    
    // Lista para armazenar produtos processados
    const products = [];
    
    // Processar cada linha
    for (let i = startRow; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;
      
      // Verificar se a linha é válida (não é cabeçalho, faixa de preço, etc)
      if (isIgnorableLine(row)) {
        continue;
      }
      
      // Extrair dados com base no mapeamento da IA
      const nameCol = mapping.nome;
      const codeCol = mapping.codigo;
      const priceCol = mapping.preco;
      const descCol = mapping.descricao;
      const categoryCol = mapping.categoria;
      const supplierCol = mapping.fornecedor;
      const locationCol = mapping.localizacao;
      const materialsCol = mapping.materiais;
      const dimensionsCol = mapping.dimensoes;
      
      // NOME DO PRODUTO
      let productName = "";
      if (nameCol && row[nameCol]) {
        productName = row[nameCol].toString().trim();
      } else {
        // Se não encontrou nome, tentar primeira coluna não vazia
        for (const col of Object.keys(row)) {
          if (row[col] && typeof row[col] === 'string' && row[col].length > 3) {
            productName = row[col].toString().trim();
            break;
          }
        }
      }
      
      if (!productName || productName.length < 3) {
        console.log(`Linha ${rowNum} sem nome de produto válido. IGNORANDO`);
        continue;
      }
      
      // CÓDIGO DO PRODUTO
      let productCode = "";
      if (codeCol && row[codeCol]) {
        productCode = row[codeCol].toString().trim();
        
        // Verificar se o código parece ser uma localização ou faixa de preço
        if (productCode.toLowerCase().includes('piso') || 
            /^\d+º/i.test(productCode) || 
            /^\d+-\d+k$/i.test(productCode)) {
          // Gerar código alternativo se o código parece inválido
          productCode = `PROD-${rowNum}`;
        }
      } else {
        // Se não existe código explícito, criar um baseado no nome
        productCode = `PROD-${rowNum}`;
      }
      
      // PREÇO DO PRODUTO
      let productPrice = 0;
      if (priceCol && row[priceCol]) {
        productPrice = extractPrice(row[priceCol]);
      }
      
      // FORNECEDOR/FABRICANTE
      let manufacturer = '';
      if (supplierCol && row[supplierCol]) {
        manufacturer = row[supplierCol].toString().trim();
      }
      
      // LOCALIZAÇÃO
      let location = '';
      if (locationCol && row[locationCol]) {
        location = row[locationCol].toString().trim();
      }
      
      // DESCRIÇÃO
      let description = '';
      if (descCol && row[descCol]) {
        description = row[descCol].toString().trim();
      } else {
        description = productName; // Usar o nome como descrição se não tiver descrição
      }
      
      // CATEGORIA
      let category = '';
      if (categoryCol && row[categoryCol]) {
        category = row[categoryCol].toString().trim();
      } else {
        // Inferir categoria do nome e fabricante
        category = inferCategory(productName, manufacturer);
      }
      
      // MATERIAIS
      let materials = [];
      if (materialsCol && row[materialsCol]) {
        const materialsStr = row[materialsCol].toString().trim();
        materials = materialsStr.split(',').map(m => m.trim()).filter(Boolean);
      } else {
        // Extrair materiais do nome do produto
        materials = extractMaterials(productName);
      }
      
      // DIMENSÕES
      let dimensions = '';
      if (dimensionsCol && row[dimensionsCol]) {
        dimensions = row[dimensionsCol].toString().trim();
      }
      
      // CRIAR OBJETO DO PRODUTO
      const product = {
        userId: userId,
        catalogId: parseInt(catalogId),
        name: productName,
        code: productCode,
        description: description,
        price: productPrice,
        category: category,
        manufacturer: manufacturer,
        materials: materials,
        dimensions: dimensions,
        colors: [],
        location: location,
        excelRowNumber: rowNum,
        isEdited: false
      };
      
      // Adicionar produto à lista
      products.push(product);
      console.log(`✅ Produto extraído com sucesso da linha ${rowNum}: ${product.name} (${product.code}) - R$ ${(product.price/100).toFixed(2)}`);
    }
    
    console.log(`\n=== PROCESSAMENTO COM MAPEAMENTO DINÂMICO CONCLUÍDO ===`);
    console.log(`Total de produtos extraídos: ${products.length}`);
    
    return products;
    
  } catch (error) {
    console.error("Erro ao processar Excel com mapeamento dinâmico:", error);
    throw error;
  }
}