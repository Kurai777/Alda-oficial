import * as XLSX from 'xlsx';
import { readFile } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';
// Importar o extrator JavaScript principal
import { extractImagesFromExcel, hasExcelImages } from './robust-excel-image-extractor.js';
// Importar o extrator avançado com múltiplos fallbacks
import { extractImagesFromExcel as extractImagesAdvanced } from './advanced-excel-image-extractor.js';
// Importar a ponte para o Python
import { extractExcelImagesWithPython, associateImagesWithProducts } from './python-excel-bridge.js';
// Importar a função de upload para o Firebase
import { saveImageToFirebaseStorage } from './firebase-admin';

// Configurações para mapeamento de colunas por índice em formatos específicos
// Formato: {indiceColuna: nomeCampo}
const COLUMN_MAPPINGS = {
  // Mapeamento para planilha Sofá Home/POE
  SOFA_HOME: {
    0: "code", // Primeira coluna como código
    1: "name", // Segunda coluna como nome
    2: "location", // Terceira coluna como localização
    3: "supplier", // Quarta coluna como fornecedor
    4: "price", // Quinta coluna como preço
    // Mais mapeamentos podem ser adicionados conforme necessário
  },
  // Outros formatos de planilha podem ser adicionados aqui
  DEFAULT: {
    0: "code",
    1: "name",
    2: "description",
    3: "price",
    4: "category",
    5: "location",
    6: "supplier"
  }
};

export interface ExcelProduct {
  nome?: string;
  name?: string;
  descricao?: string;
  description?: string;
  codigo?: string;
  code?: string;
  preco?: string | number;
  price?: string | number;
  valor?: string | number;
  categoria?: string;
  category?: string;
  cores?: string;
  colors?: string;
  materiais?: string;
  materials?: string;
  imagem?: string;
  image?: string;
  imageUrl?: string;
  // Campos adicionais encontrados em planilhas de produtos
  largura?: string | number;
  width?: string | number;
  altura?: string | number;
  height?: string | number;
  profundidade?: string | number;
  depth?: string | number;
  estoque?: string | number;
  stock?: string | number;
  fabricante?: string;
  fornecedor?: string;
  manufacturer?: string;
  supplier?: string;
  marca?: string;
  brand?: string;
  localizacao?: string;
  location?: string;
  piso?: string;
  deposito?: string;
  floor?: string;
  warehouse?: string;
  [key: string]: any;
}

/**
 * Detecta o formato da planilha e retorna o mapeamento de colunas por índice
 * @param rawData Dados brutos da planilha
 * @param fileName Nome do arquivo para reconhecer formatos específicos
 * @returns Mapeamento de índices para nomes de campos
 */
function detectColumnMapping(rawData: any[], fileName: string): Record<number, string> {
  // Verificar se o arquivo corresponde a algum formato conhecido pelo nome
  const fileLower = fileName.toLowerCase();
  
  // Para Sofá Home/POE
  if (fileLower.includes('sofa') || fileLower.includes('poe')) {
    return COLUMN_MAPPINGS.SOFA_HOME;
  }
  
  // Para outros formatos, tente descobrir analisando o conteúdo
  if (rawData.length > 0) {
    // Verificar se a primeira linha contém cabeçalhos que correspondem a formatos conhecidos
    const firstRow = rawData[0];
    const keys = Object.keys(firstRow);
    
    // Detectar padrão de Sofá Home/POE pelo conteúdo
    const hasSupplierKey = keys.some(k => /forn/i.test(k));
    const hasCodeKey = keys.some(k => /cod/i.test(k));
    const hasImageKey = keys.some(k => /imag/i.test(k));
    
    if (hasSupplierKey && hasCodeKey && hasImageKey) {
      return COLUMN_MAPPINGS.SOFA_HOME;
    }
  }
  
  // Se não corresponder a nenhum formato conhecido, use mapeamento por índice padrão
  return COLUMN_MAPPINGS.DEFAULT;
}

/**
 * Aplica mapeamento de colunas por índice em vez de usar nomes de cabeçalho
 * @param rawData Dados brutos do Excel
 * @param columnMapping Mapeamento de índices para nomes de campos
 * @returns Dados com campos mapeados
 */
function applyColumnMapping(rawData: any[], columnMapping: Record<number, string>): any[] {
  // Se não temos dados ou mapeamento, retornar vazio
  if (!rawData.length || !Object.keys(columnMapping).length) {
    return rawData;
  }
  
  return rawData.map(row => {
    // Para cada linha, criar um novo objeto com campos mapeados
    const mappedRow: Record<string, any> = {};
    const originalKeys = Object.keys(row);
    
    // Aplicar mapeamento de colunas
    Object.entries(columnMapping).forEach(([indexStr, fieldName]) => {
      const index = parseInt(indexStr, 10);
      // Obter a chave original da posição de índice
      if (index < originalKeys.length) {
        const originalKey = originalKeys[index];
        // Usar o valor da coluna original com o novo nome de campo
        if (row[originalKey] !== null && row[originalKey] !== undefined) {
          mappedRow[fieldName] = row[originalKey];
        }
      }
    });
    
    // Manter campos originais também
    return { ...row, ...mappedRow };
  }).filter(row => {
    // Filtrar linhas vazias ou sem código
    if (!row.code && !row.codigo) return false;
    
    // Verificar se o código parece ser válido (não é apenas um número ou texto muito curto)
    const code = row.code || row.codigo;
    if (typeof code === 'string' && code.trim().length < 2) return false;
    
    // Verificar se há pelo menos um nome ou descrição
    const hasName = row.name || row.nome || row.description || row.descricao;
    return !!hasName;
  });
}

/**
 * Processar um arquivo Excel para extrair produtos
 * @param filePath Caminho para o arquivo Excel
 * @param userId ID do usuário para associar imagens ao processar
 * @param catalogId ID do catálogo associado aos produtos
 * @returns Array de produtos processados
 */
export async function processExcelFile(filePath: string, userId?: string | number, catalogId?: string | number): Promise<any[]> {
  try {
    console.log(`Iniciando processamento do Excel: ${filePath}`);
    
    // Ler o arquivo com opções para arquivos grandes
    console.log(`Lendo arquivo Excel (pode demorar para arquivos grandes): ${filePath}`);
    const fileData = await readFile(filePath);
    console.log(`Arquivo lido com sucesso: ${(fileData.length / (1024*1024)).toFixed(2)} MB`);
    
    // Usar opções específicas para arquivos grandes
    const workbook = XLSX.read(fileData, {
      type: 'buffer',
      cellFormula: false, // Desabilitar fórmulas para melhorar desempenho
      cellHTML: false,    // Desabilitar HTML para melhorar desempenho
      cellStyles: false,  // Desabilitar estilos para melhorar desempenho
      cellDates: true,    // Manter datas
      cellNF: false,      // Não preservar formato numérico
      cellText: true      // Preservar texto
    });
    
    // Processar todas as planilhas do arquivo
    const allProducts: any[] = [];
    const fileName = path.basename(filePath);
    
    console.log(`Encontradas ${workbook.SheetNames.length} planilhas no arquivo Excel`);
    
    // Verificar se o arquivo tem imagens
    const hasImages = await hasExcelImages(filePath);
    console.log(`Arquivo ${hasImages ? 'contém' : 'não contém'} imagens embutidas`);
    
    for (const sheetName of workbook.SheetNames) {
      try {
        console.log(`Processando planilha: ${sheetName}`);
        const worksheet = workbook.Sheets[sheetName];
        
        // Converter para JSON com opções específicas
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          defval: null,   // Valor padrão para células vazias
          raw: true       // Manter valores brutos
        });
        
        console.log(`Extraídos ${rawData.length} registros brutos da planilha ${sheetName}`);
        
        if (rawData.length > 0) {
          // Detectar e aplicar mapeamento de colunas por índice
          const columnMapping = detectColumnMapping(rawData, fileName);
          console.log(`Aplicando mapeamento de colunas por índice: ${JSON.stringify(columnMapping)}`);
          
          const mappedData = applyColumnMapping(rawData, columnMapping);
          console.log(`Após mapeamento e filtragem: ${mappedData.length} registros válidos`);
          
          // Mapear para o formato de produto padrão
          const productsFromSheet = normalizeExcelProducts(mappedData as ExcelProduct[], userId, catalogId);
          
          // Se temos produtos e imagens, extraia e associe as imagens
          if (productsFromSheet.length > 0 && hasImages && userId) {
            console.log(`Extraindo imagens do Excel para ${productsFromSheet.length} produtos`);
            
            // Usar o catalogId fornecido ou o do primeiro produto
            const activeCatalogId = catalogId || 
                                    (productsFromSheet[0] && productsFromSheet[0].catalogId) || 
                                    'temp';
            
            console.log(`Usando catalogId "${activeCatalogId}" para extração de imagens`);
            
            // Atribuir o catalogId a todos os produtos para manter consistência
            productsFromSheet.forEach(product => {
              product.catalogId = activeCatalogId;
            });
            
            // Extrair imagens e associar aos produtos
            // Primeiro tentar com o método JavaScript
            let updatedProducts = await extractImagesFromExcel(
              filePath, productsFromSheet, String(userId), activeCatalogId
            );
            
            // Verificar quantos produtos foram atualizados com URLs de imagem
            let productsWithImages = updatedProducts.filter(p => p.imageUrl).length;
            console.log(`${productsWithImages} de ${updatedProducts.length} produtos foram atualizados com URLs de imagem`);
            
            // Se nenhum produto foi atualizado, tentar com o método avançado como fallback
            if (productsWithImages === 0) {
              console.log('Nenhuma imagem extraída com método JavaScript padrão. Tentando método avançado...');
              
              try {
                // Tentar com o extrator avançado que possui múltiplos fallbacks
                console.log('Tentando extração com extrator avançado...');
                updatedProducts = await extractImagesAdvanced(
                  filePath, productsFromSheet, String(userId), activeCatalogId
                );
                
                // Verificar novamente
                productsWithImages = updatedProducts.filter(p => p.imageUrl).length;
                console.log(`Método avançado: ${productsWithImages} de ${updatedProducts.length} produtos foram atualizados com URLs de imagem`);
                
                // Se ainda não temos imagens, tentar com a ponte Python diretamente
                if (productsWithImages === 0) {
                  console.log('Tentando ponte Python direta como último recurso...');
                  
                  try {
                    // Extrair imagens diretamente com Python
                    const extractionResult = await extractExcelImagesWithPython(filePath);
                    
                    if (extractionResult.images && extractionResult.images.length > 0) {
                      console.log(`Python extraiu ${extractionResult.images.length} imagens`);
                      
                      // Associar imagens com produtos
                      const associationResult = await associateImagesWithProducts(filePath, extractionResult);
                      
                      if (associationResult.associations && associationResult.associations.length > 0) {
                        console.log(`Python associou ${associationResult.associations.length} imagens a produtos`);
                        
                        // Para cada associação, atualizar o produto correspondente
                        for (const assoc of associationResult.associations) {
                          if (assoc.codigo) {
                            const matchingProduct = productsFromSheet.find(p => 
                              (p.code && p.code.toString() === assoc.codigo) || 
                              (p.codigo && p.codigo.toString() === assoc.codigo)
                            );
                            
                            if (matchingProduct && assoc.image) {
                              // Salvar a imagem no Firebase
                              try {
                                const imageBase64 = extractionResult.images.find(
                                  img => img.image_filename === assoc.image
                                )?.image_base64;
                                
                                if (imageBase64) {
                                  const imageUrl = await saveImageToFirebaseStorage(
                                    imageBase64,
                                    `${assoc.codigo}.png`,
                                    String(userId || 'unknown'),
                                    String(activeCatalogId || 'temp')
                                  );
                                  
                                  matchingProduct.imageUrl = imageUrl;
                                  console.log(`Imagem associada ao produto ${assoc.codigo}: ${imageUrl}`);
                                }
                              } catch (e) {
                                console.error(`Erro ao salvar imagem para ${assoc.codigo}:`, e);
                              }
                            }
                          }
                        }
                        
                        // Verificar novamente
                        productsWithImages = productsFromSheet.filter(p => p.imageUrl).length;
                        console.log(`Python direto: ${productsWithImages} de ${productsFromSheet.length} produtos foram atualizados com URLs de imagem`);
                      }
                    } else {
                      console.log('Python não encontrou imagens no arquivo');
                    }
                  } catch (pythonError) {
                    console.error('Erro ao usar Python direto:', pythonError);
                  }
                }
              } catch (advancedError) {
                console.error('Erro ao usar método avançado:', advancedError);
              }
            }
          }
          
          allProducts.push(...productsFromSheet);
          console.log(`Processados ${productsFromSheet.length} produtos da planilha ${sheetName}`);
        }
      } catch (sheetError) {
        console.error(`Erro ao processar planilha ${sheetName}:`, sheetError);
        // Continuar para a próxima planilha mesmo se houver erro
      }
    }
    
    console.log(`Total de produtos extraídos de todas as planilhas: ${allProducts.length}`);
    
    return allProducts;
  } catch (error) {
    console.error('Erro ao processar arquivo Excel:', error);
    throw new Error(`Falha ao processar arquivo Excel: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

/**
 * Normaliza os dados brutos do Excel para o formato padrão de produtos
 * @param rawProducts Produtos brutos do Excel
 * @returns Produtos normalizados
 */
function normalizeExcelProducts(rawProducts: ExcelProduct[], userId?: string | number, catalogId?: string | number): any[] {
  console.log(`Iniciando normalização de ${rawProducts.length} produtos brutos do Excel...`);
  
  // Mostrar as primeiras 3 linhas para diagnosticar a estrutura
  console.log("Amostra dos primeiros 3 produtos brutos para diagnóstico:");
  for (let i = 0; i < Math.min(3, rawProducts.length); i++) {
    console.log(`Produto bruto ${i+1}:`, JSON.stringify(rawProducts[i]));
  }
  
  // Arrays para armazenar os produtos normalizados
  const normalizedProducts: any[] = [];
  
  // Analisar a estrutura da planilha para identificar o que cada coluna representa
  // Vamos examinar as primeiras linhas para detectar padrões
  
  // Primeiro, conseguir uma lista de todas as chaves possíveis em todos os produtos
  const allKeys = new Set<string>();
  rawProducts.slice(0, Math.min(20, rawProducts.length)).forEach(product => {
    Object.keys(product).forEach(key => allKeys.add(key));
  });
  const keyList = Array.from(allKeys);
  console.log(`Colunas encontradas: ${keyList.join(', ')}`);
  
  // Verificar se o arquivo é um catálogo da Sofá Home ou POE (formato especial visto na imagem)
  let isSofaHomeOrPOEFormat = false;
  let nameColumnKey = null;
  let codeColumnKey = null;
  let priceColumnKey = null;
  let descriptionColumnKey = null;
  let supplierColumnKey = null;
  let imageColumnKey = null;
  let locationColumnKey = null;
  
  // Primeiro, verificar se a planilha tem campos específicos que indicam o formato POE/Sofá Home
  const possibleFields = keyList.map(key => key.toLowerCase());
  
  if (
    (possibleFields.includes('forn.') || possibleFields.includes('forn') || possibleFields.includes('fornecedor')) &&
    (possibleFields.includes('imagem') || possibleFields.includes('image') || possibleFields.includes('img')) &&
    (possibleFields.includes('descrição') || possibleFields.includes('descricao') || possibleFields.includes('desc')) &&
    (possibleFields.includes('cod.') || possibleFields.includes('cod') || possibleFields.includes('código'))
  ) {
    isSofaHomeOrPOEFormat = true;
    console.log("Detectado formato de catálogo Sofá Home/POE");
    
    // Identificar as colunas específicas
    for (const key of keyList) {
      const keyLower = key.toLowerCase();
      
      // Detectar coluna de nome do produto
      if (keyLower.includes('sofá') || keyLower.includes('sofa home') || keyLower.includes('\\\\')) {
        nameColumnKey = key;
      }
      // Detectar coluna de código
      else if (keyLower.includes('cod.') || keyLower === 'cod') {
        codeColumnKey = key;
      }
      // Detectar coluna de preço
      else if (keyLower.includes('valor') || keyLower.includes('r$') || keyLower.includes('preço') || keyLower.includes('preco')) {
        priceColumnKey = key;
      }
      // Detectar coluna de descrição
      else if (keyLower.includes('descrição') || keyLower.includes('descricao') || keyLower === 'desc') {
        descriptionColumnKey = key;
      }
      // Detectar coluna de fornecedor
      else if (keyLower.includes('forn.') || keyLower === 'forn' || keyLower.includes('fornecedor')) {
        supplierColumnKey = key;
      }
      // Detectar coluna de imagem
      else if (keyLower.includes('imagem') || keyLower.includes('image') || keyLower === 'img') {
        imageColumnKey = key;
      }
      // Detectar coluna de localização (2º Piso, Depósito, etc)
      else if (keyLower.includes('local') || keyLower.includes('localização')) {
        locationColumnKey = key;
      }
    }
    
    // Verificar se encontramos as colunas principais
    console.log(`Colunas identificadas no formato Sofá Home/POE:
      - Nome: ${nameColumnKey || 'Não encontrada'}
      - Código: ${codeColumnKey || 'Não encontrada'}
      - Preço: ${priceColumnKey || 'Não encontrada'}
      - Descrição: ${descriptionColumnKey || 'Não encontrada'}
      - Fornecedor: ${supplierColumnKey || 'Não encontrada'}
      - Imagem: ${imageColumnKey || 'Não encontrada'}
      - Localização: ${locationColumnKey || 'Não encontrada'}
    `);
  }
  
  // Determinar possíveis nomes de campos com base na primeira linha
  const nameFields = ['nome', 'name', 'produto', 'product', 'titulo', 'title', 'item', 'descrição', 'description', 'descrição do produto', 'desc. produto'];
  const codeFields = ['codigo', 'code', 'sku', 'referencia', 'reference', 'id', 'item_id', 'código', 'cod', 'cod.', 'código produto'];
  const priceFields = ['preco', 'price', 'valor', 'value', 'custo', 'cost', 'preco_venda', 'sale_price', 'preço', 'preço tabela', 'valor unit', 'preço s/ imp', 'preço venda', 'valor unit.', 'valor venda'];
  
  // Para outros formatos, verificar se é um formato de planilha baseado em datas
  let isDateBasedSheet = false;
  let productColumnKey = null;
  
  if (!isSofaHomeOrPOEFormat) {
    // Verificar se temos padrões que indicam um tipo específico de planilha
    // Por exemplo, se temos muitas entradas que parecem datas (como "maio./24", "ago./22")
    let datePatternCount = 0;
    let possibleDateKeys: string[] = [];
    
    for (const key of keyList) {
      let dateCount = 0;
      // Verificar primeiras 10 entradas para ver se parecem datas
      for (let i = 0; i < Math.min(10, rawProducts.length); i++) {
        const value = rawProducts[i][key];
        if (typeof value === 'string' && 
            (value.match(/^[a-z]{3,4}\.\/(2[0-9])$/i) || // padrão como "maio./24"
             value.match(/^[a-z]{3,4}\.\/[0-9]{2}$/i) || // outros formatos de data
             value.match(/^Data\s/i))) { // 'Data' seguida de algum texto
          dateCount++;
        }
      }
      
      if (dateCount >= 3) { // Se pelo menos 3 das primeiras 10 entradas parecem datas
        possibleDateKeys.push(key);
        datePatternCount += dateCount;
      }
    }
    
    // Se encontramos várias entradas que parecem datas, esta pode ser uma planilha baseada em datas/períodos
    if (datePatternCount > 5) {
      isDateBasedSheet = true;
      console.log("Detectada planilha baseada em datas/períodos");
      
      // Agora precisamos identificar quais colunas contêm produtos, preços e códigos
      
      // Para planilhas organizadas por data, geralmente outras colunas contêm informações do produto
      for (const key of keyList) {
        // Verificar se uma coluna contém valores que parecem preços
        const priceCount = rawProducts.slice(0, 10).filter(p => {
          const val = p[key];
          return (typeof val === 'number' && val > 0) || 
                 (typeof val === 'string' && val.includes('R$')) ||
                 (typeof val === 'string' && /^[0-9.,]+$/.test(val.trim()));
        }).length;
        
        if (priceCount >= 3 && !priceColumnKey) {
          priceColumnKey = key;
        }
        
        // Verificar se uma coluna contém valores que parecem códigos de produto
        const codeCount = rawProducts.slice(0, 10).filter(p => {
          const val = p[key];
          return typeof val === 'string' && 
                 (val.includes('OUTLET') || val.includes('Piso') || val.includes('Depósito') || 
                  /^[A-Z0-9-]{3,10}$/.test(val.trim()));
        }).length;
        
        if (codeCount >= 3 && !codeColumnKey) {
          codeColumnKey = key;
        }
      }
      
      // Se encontramos chaves que parecem datas, usar a primeira como coluna de produtos
      if (possibleDateKeys.length > 0) {
        productColumnKey = possibleDateKeys[0];
        console.log(`Usando coluna "${productColumnKey}" como produtos (baseado em datas/períodos)`);
      }
      
      if (priceColumnKey) {
        console.log(`Usando coluna "${priceColumnKey}" como preços`);
      }
      
      if (codeColumnKey) {
        console.log(`Usando coluna "${codeColumnKey}" como códigos`);
      }
    }
  }
  
  // Detectar campos adicionais do cabeçalho para o método tradicional
  const detectedNameFields: string[] = [];
  const detectedCodeFields: string[] = [];
  const detectedPriceFields: string[] = [];
  
  if (rawProducts.length > 0 && !isDateBasedSheet) {
    const firstProduct = rawProducts[0];
    
    // Analisar todas as propriedades para identificação de campos
    for (const [key, value] of Object.entries(firstProduct)) {
      const keyLower = key.toLowerCase();
      
      // Detectar campo de nome
      if (
        keyLower.includes('nome') || 
        keyLower.includes('name') || 
        keyLower.includes('produto') || 
        keyLower.includes('product') || 
        keyLower.includes('item') || 
        keyLower.includes('titulo') || 
        keyLower.includes('title') ||
        keyLower.includes('descri')
      ) {
        detectedNameFields.push(key);
      }
      // Se o campo contém uma descrição longa, provavelmente é um campo de nome/descrição
      else if (
        typeof value === 'string' && 
        value.length > 10 && 
        !keyLower.includes('obs') && 
        !keyLower.includes('coment')
      ) {
        detectedNameFields.push(key);
      }
      
      // Detectar campo de código
      if (
        keyLower.includes('cod') || 
        keyLower.includes('code') || 
        keyLower.includes('sku') || 
        keyLower.includes('ref') || 
        keyLower.includes('id')
      ) {
        detectedCodeFields.push(key);
      }
      // Se o valor parece um código (alfanumérico curto)
      else if (
        typeof value === 'string' && 
        value.length < 20 && 
        /[A-Z0-9]/.test(value) && 
        !/[áàãâéèêíìóòõôúùç]/.test(value.toLowerCase())
      ) {
        detectedCodeFields.push(key);
      }
      
      // Detectar campo de preço
      if (
        keyLower.includes('prec') || 
        keyLower.includes('price') || 
        keyLower.includes('valor') || 
        keyLower.includes('value') || 
        keyLower.includes('custo') || 
        keyLower.includes('cost') ||
        keyLower.includes('r$')
      ) {
        detectedPriceFields.push(key);
      }
      // Se o valor parece um preço numérico
      else if (
        (typeof value === 'number' || 
        (typeof value === 'string' && /^[0-9,.]+$/.test(value.trim()))) &&
        !keyLower.includes('qtd') && 
        !keyLower.includes('quant')
      ) {
        detectedPriceFields.push(key);
      }
    }
    
    console.log('Campos de nome detectados:', [...new Set([...nameFields, ...detectedNameFields])]);
    console.log('Campos de código detectados:', [...new Set([...codeFields, ...detectedCodeFields])]);
    console.log('Campos de preço detectados:', [...new Set([...priceFields, ...detectedPriceFields])]);
  }
  
  // Processamento em lotes para arquivos grandes
  const BATCH_SIZE = 1000;
  
  for (let i = 0; i < rawProducts.length; i += BATCH_SIZE) {
    const batch = rawProducts.slice(i, i + BATCH_SIZE);
    console.log(`Processando lote ${Math.floor(i/BATCH_SIZE) + 1} de ${Math.ceil(rawProducts.length/BATCH_SIZE)} (${batch.length} produtos)`);
    
    // Processar cada produto no lote
    for (const rawProduct of batch) {
      if (!rawProduct) continue;
      
      // Verificar se é um produto válido
      const allNameFields = [...new Set([...nameFields, ...detectedNameFields])];
      const allCodeFields = [...new Set([...codeFields, ...detectedCodeFields])];
      const allPriceFields = [...new Set([...priceFields, ...detectedPriceFields])];
      
      // Determinar se devemos usar o método específico para planilhas baseadas em datas ou o método genérico
      let productName = '';
      let productCode = '';
      let description = '';
      let price = 0;
      
      if (isSofaHomeOrPOEFormat) {
        console.log("Usando processamento específico para catálogo Sofá Home/POE");
        
        // Para este formato específico do Sofá Home/POE, vamos extrair as informações de forma direcionada
        
        // 1. Extrair nome do produto (Sofá Home)
        if (nameColumnKey && rawProduct[nameColumnKey]) {
          productName = String(rawProduct[nameColumnKey]).trim();
        }
        
        // 2. Extrair código do produto
        if (codeColumnKey && rawProduct[codeColumnKey]) {
          productCode = String(rawProduct[codeColumnKey]).trim();
        }
        
        // 3. Extrair descrição
        if (descriptionColumnKey && rawProduct[descriptionColumnKey]) {
          description = String(rawProduct[descriptionColumnKey]).trim();
        }
        
        // 4. Extrair preço - tratando corretamente no formato brasileiro (R$ 2.893,00)
        if (priceColumnKey && rawProduct[priceColumnKey]) {
          const rawPriceVal = rawProduct[priceColumnKey];
          
          if (typeof rawPriceVal === 'number') {
            price = Math.round(rawPriceVal * 100); // converter para centavos
          } else if (typeof rawPriceVal === 'string') {
            // Limpar a string de preço (remover R$, espaços, etc)
            let cleanPrice = rawPriceVal.replace(/[^\d,.]/g, '');
            
            // Para valores como R$ 2.893,00, remover os pontos de milhar e substituir a vírgula por ponto
            if (cleanPrice.includes('.') && cleanPrice.includes(',')) {
              cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
            } else if (cleanPrice.includes(',')) {
              cleanPrice = cleanPrice.replace(',', '.');
            }
              
            // Converter para número
            const numericPrice = parseFloat(cleanPrice);
            if (!isNaN(numericPrice)) {
              price = Math.round(numericPrice * 100);
              console.log(`Preço convertido: "${rawPriceVal}" => ${numericPrice} => ${price} centavos`);
            }
          }
        }
      } else if (isDateBasedSheet && productColumnKey && codeColumnKey) {
        console.log("Usando processamento específico para planilha baseada em datas");
        
        // Para a planilha de datas, extrair informações dos produtos da tabela "POE"
        // Neste formato, as linhas contêm produtos e as colunas contêm locais/códigos
        
        // 1. Extrair nome do produto da coluna de datas
        if (productColumnKey && rawProduct[productColumnKey]) {
          const dateValue = rawProduct[productColumnKey];
          
          // Se o valor na coluna de datas é uma data, esta linha representa um produto
          if (typeof dateValue === 'string' && dateValue.trim().length > 0) {
            // Vamos extrair um nome de produto real da planilha
            // Esta linha de dados provavelmente define um produto, então vamos buscar outra coluna
            // que possa conter o nome real do produto
            
            // Buscar um valor que pareça um nome de móvel em todas as colunas
            let foundProductName = '';
            
            for (const key of keyList) {
              const val = rawProduct[key];
              if (typeof val === 'string' && 
                  val.length > 3 && 
                  !/^[0-9,.]+$/.test(val) && // não é só números
                  key !== productColumnKey && // não é a coluna de datas
                  key !== codeColumnKey) {    // não é a coluna de códigos
                
                // Verificar se este valor parece um nome de produto (móvel)
                const isFurnitureKeyword = /mesa|cadeira|poltrona|sofa|sofá|armário|estante|rack|cama|banco|aparador|balcão|buffet|cristaleira|escrivaninha|cômoda|criado-mudo/i.test(val);
                
                if (isFurnitureKeyword) {
                  foundProductName = val;
                  break;
                }
                
                // Se não encontramos uma palavra-chave específica, use o campo de texto mais longo
                if (!foundProductName && val.length > foundProductName.length) {
                  foundProductName = val;
                }
              }
            }
            
            // Se encontramos um nome de produto, use-o. Caso contrário, use a data como nome temporário
            productName = foundProductName || dateValue;
          }
        }
        
        // 2. Usar a coluna de códigos para definir o código do produto
        if (codeColumnKey && rawProduct[codeColumnKey]) {
          productCode = String(rawProduct[codeColumnKey]).trim();
        }
        
        // 3. Buscar o preço - verificar se temos um campo específico para isso
        if (priceColumnKey && rawProduct[priceColumnKey] !== undefined) {
          // Tentar extrair um preço numérico
          const rawPriceVal = rawProduct[priceColumnKey];
          
          if (typeof rawPriceVal === 'number') {
            // Se o valor já for numérico, garantir que tenha pelo menos 100 (1 real)
            price = Math.max(100, Math.round(rawPriceVal * 100)); // converter para centavos e garantir pelo menos 1 real
          } else if (typeof rawPriceVal === 'string') {
            // Limpar a string de preço (remover R$, espaços, etc)
            let cleanPrice = rawPriceVal.replace(/[^\d,.]/g, '');
            
            // Para valores como R$ 2.893,00, remover os pontos de milhar e substituir a vírgula por ponto
            if (cleanPrice.includes('.') && cleanPrice.includes(',')) {
              cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
            } else if (cleanPrice.includes(',')) {
              cleanPrice = cleanPrice.replace(',', '.');
            }
              
            // Converter para número
            const numericPrice = parseFloat(cleanPrice);
            if (!isNaN(numericPrice)) {
              // Garantir que o preço seja pelo menos 1 real (100 centavos)
              price = Math.max(100, Math.round(numericPrice * 100));
            } else {
              // Se não conseguir extrair o preço, definir um valor padrão de 100 reais
              price = 10000; // 100 reais em centavos
            }
          } else {
            // Se não houver preço, definir um valor padrão de 100 reais
            price = 10000; // 100 reais em centavos
          }
        }
        
        // 4. Se ainda não temos um preço, procurar em qualquer coluna que possa conter valores numéricos
        if (price === 0) {
          for (const [key, value] of Object.entries(rawProduct)) {
            if (key !== productColumnKey && key !== codeColumnKey) {
              let numericValue = 0;
              
              if (typeof value === 'number') {
                numericValue = value;
              } else if (typeof value === 'string' && /^[0-9.,]+$/.test(value.trim())) {
                // Limpar a string e converter para número
                const cleanValue = value
                  .replace(/R\$\s*/g, '')
                  .replace(/\s/g, '')
                  .replace(/\./g, '')
                  .replace(',', '.');
                  
                numericValue = parseFloat(cleanValue);
              }
              
              // Se encontramos um valor numérico maior que zero, pode ser um preço
              if (!isNaN(numericValue) && numericValue > 0 && numericValue < 100000) {
                price = Math.round(numericValue * 100);
                break;
              }
            }
          }
        }
        
        // 5. Gerar uma descrição combinando informações disponíveis
        const descriptions = [];
        if (productName) descriptions.push(productName);
        if (productCode) descriptions.push(`Código: ${productCode}`);
        
        // Adicionar outras informações à descrição
        for (const [key, value] of Object.entries(rawProduct)) {
          if (key !== productColumnKey && key !== codeColumnKey && key !== priceColumnKey &&
              typeof value === 'string' && value.trim().length > 0) {
            descriptions.push(`${key}: ${value}`);
          }
        }
        
        description = descriptions.join(' | ');
      } else {
        // Método genérico para planilhas normais
        
        // Tentar encontrar qualquer campo que possa ser usado como nome do produto
        // Primeiro verificar nos campos conhecidos
        
        // 1. Verificar campos de nome explícitos
        for (const field of allNameFields) {
          if (rawProduct[field] && typeof rawProduct[field] === 'string' && rawProduct[field].trim().length > 0) {
            productName = rawProduct[field].trim();
            break;
          }
        }
        
        // 2. Se ainda não temos nome, verificar todas as propriedades para encontrar texto relevante
        if (!productName) {
          // Procurar o campo com texto mais longo que possa ser um nome de produto
          let longestTextLength = 0;
          
          for (const [key, value] of Object.entries(rawProduct)) {
            if (
              typeof value === 'string' && 
              value.trim().length > 5 && 
              value.trim().length > longestTextLength &&
              !key.toLowerCase().includes('obs') &&
              !key.toLowerCase().includes('coment')
            ) {
              productName = value.trim();
              longestTextLength = value.trim().length;
            }
          }
        }
        
        // Determinar o código do produto
        // 1. Verificar campos de código explícitos
        for (const field of allCodeFields) {
          if (rawProduct[field] && String(rawProduct[field]).trim().length > 0) {
            productCode = String(rawProduct[field]).trim();
            break;
          }
        }
        
        // 2. Se não encontramos código, procurar qualquer valor alfanumérico curto como código
        if (!productCode) {
          for (const [key, value] of Object.entries(rawProduct)) {
            if (
              typeof value === 'string' || 
              typeof value === 'number'
            ) {
              const strValue = String(value).trim();
              if (
                strValue.length > 0 &&
                strValue.length < 15 &&
                /^[A-Za-z0-9_\-.]+$/.test(strValue) &&
                !allNameFields.includes(key)
              ) {
                productCode = strValue;
                break;
              }
            }
          }
        }
        
        // Determinar a descrição
        description = rawProduct.descricao || rawProduct.description || '';
        
        // Determinar o preço
        let rawPrice = null;
        
        for (const field of allPriceFields) {
          if (rawProduct[field] !== null && rawProduct[field] !== undefined) {
            rawPrice = rawProduct[field];
            break;
          }
        }
        
        if (typeof rawPrice === 'number') {
          // Se já for um número, apenas multiplicar por 100 (converter para centavos)
          price = Math.round(rawPrice * 100);
        } else if (typeof rawPrice === 'string') {
          // Se for uma string, precisamos extrair o valor numérico
          // Remover R$, espaços, e substituir vírgula por ponto
          const cleanPrice = rawPrice
            .replace(/R\$\s*/g, '')
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.');
          
          // Converter para número e multiplicar por 100
          const numericPrice = parseFloat(cleanPrice);
          if (!isNaN(numericPrice)) {
            price = Math.round(numericPrice * 100);
          }
        }
      }
      
      // Se o produto não tem nem nome nem código mas tem algumas propriedades, vamos tentar criá-lo mesmo assim
      if (!productName && !productCode) {
        // Verificar se tem algum dado que valha a pena processar
        const hasAnyData = Object.values(rawProduct).some(v => 
          (typeof v === 'string' && v.trim().length > 0) || 
          (typeof v === 'number' && !isNaN(v))
        );
        
        if (!hasAnyData) continue;
        
        // Se tem dados mas não identificamos nome/código, criar um nome genérico
        productName = 'Produto ' + (Math.floor(Math.random() * 10000));
        productCode = 'CODE-' + Date.now().toString().slice(-6);
      }
      

      
      // Normalizar categoria
      let category = rawProduct.categoria || rawProduct.category || '';
      if (!category) {
        category = determineProductCategory(productName);
      }
      
      // Processar cores (pode ser string separada por vírgulas ou array)
      let colors: string[] = [];
      const rawColors = rawProduct.cores || rawProduct.colors;
      
      if (Array.isArray(rawColors)) {
        colors = rawColors.map(c => c?.toString().trim()).filter(Boolean);
      } else if (typeof rawColors === 'string') {
        colors = rawColors.split(/,|;/).map(c => c.trim()).filter(c => c);
      }
      
      // Processar materiais (pode ser string separada por vírgulas ou array)
      let materials: string[] = [];
      const rawMaterials = rawProduct.materiais || rawProduct.materials;
      
      if (Array.isArray(rawMaterials)) {
        materials = rawMaterials.map(m => m?.toString().trim()).filter(Boolean);
      } else if (typeof rawMaterials === 'string') {
        materials = rawMaterials.split(/,|;/).map(m => m.trim()).filter(m => m);
      }
      
      // Se não houver materiais especificados, tentar extrair da descrição
      if (materials.length === 0) {
        materials = extractMaterialsFromDescription(description);
      }
      
      // Processar URL da imagem
      const imageUrl = rawProduct.imagem || rawProduct.image || rawProduct.imageUrl || '';
      
      // Processar dimensões
      const width = rawProduct.largura || rawProduct.width;
      const height = rawProduct.altura || rawProduct.height;
      const depth = rawProduct.profundidade || rawProduct.depth;
      
      let sizes: any[] = [];
      if (width || height || depth) {
        sizes.push({
          width: typeof width === 'string' ? parseInt(width, 10) || null : width,
          height: typeof height === 'string' ? parseInt(height, 10) || null : height,
          depth: typeof depth === 'string' ? parseInt(depth, 10) || null : depth,
          label: `L${width || '-'} x A${height || '-'} x P${depth || '-'}`
        });
      }
      
      // Extrair dimensões da descrição se não encontradas nos campos específicos
      if (sizes.length === 0 && typeof description === 'string') {
        // Padrão especial para formato "3 mód de 1,00m x 40cm x 82cm"
        const modulesPattern = /(\d+)\s*(?:m[óo]d|m[óo]dulos|pe[çc]as|partes)\s*de\s*(\d+(?:[,.]\d+)?)\s*(?:m|cm)?\s*x\s*(\d+(?:[,.]\d+)?)\s*(?:m|cm)?\s*x\s*(\d+(?:[,.]\d+)?)/i;
        const modulesMatch = description.match(modulesPattern);
        
        if (modulesMatch) {
          const modules = parseInt(modulesMatch[1], 10) || 1;
          const widthStr = modulesMatch[2].replace(',', '.');
          const heightStr = modulesMatch[3].replace(',', '.');
          const depthStr = modulesMatch[4].replace(',', '.');
          
          let widthNum = parseFloat(widthStr);
          let heightNum = parseFloat(heightStr);
          let depthNum = parseFloat(depthStr);
          
          // Converter de metros para centímetros se necessário
          if (widthStr.includes(',') || widthNum < 10) widthNum *= 100;
          if (heightStr.includes(',') || heightNum < 10) heightNum *= 100;
          if (depthStr.includes(',') || depthNum < 10) depthNum *= 100;
          
          // Se temos vários módulos, adicione a largura total como primeiro tamanho
          if (modules > 1) {
            sizes.push({
              width: widthNum * modules,
              height: heightNum,
              depth: depthNum,
              label: `Conjunto ${modules} módulos: L${widthNum * modules} x A${heightNum} x P${depthNum}`
            });
          }
          
          // Adicione também o tamanho de um módulo individual
          sizes.push({
            width: widthNum,
            height: heightNum,
            depth: depthNum,
            label: modules > 1 ? `Módulo individual: L${widthNum} x A${heightNum} x P${depthNum}` : `L${widthNum} x A${heightNum} x P${depthNum}`
          });
        } 
        else {
          // Padrões de dimensões comuns: LxAxP, AxLxP, dimensões: 000x000x000
          const dimensionPatterns = [
            // Padrão: 1,00 x 2,00 x 3,00
            /(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)/i,
            
            // Padrão: L00 x A00 x P00
            /L\s*(\d+[,.]?\d*)\s*x\s*A\s*(\d+[,.]?\d*)\s*x\s*P\s*(\d+[,.]?\d*)/i,
            
            // Padrão: A00 x L00 x P00
            /A\s*(\d+[,.]?\d*)\s*x\s*L\s*(\d+[,.]?\d*)\s*x\s*P\s*(\d+[,.]?\d*)/i,
            
            // Padrão: Largura: 00 x Altura: 00 x Profundidade: 00
            /(?:Larg|Largura|L)[\s\:]*(\d+[,.]?\d*)\s*(?:cm)?\s*(?:x|\/)\s*(?:Alt|Altura|A)[\s\:]*(\d+[,.]?\d*)\s*(?:cm)?\s*(?:x|\/)\s*(?:Prof|Profundidade|P)[\s\:]*(\d+[,.]?\d*)/i,
            
            // Padrão com dimensões após descrição: EMPTY_30-40k | 1000 x 1000 x 1000
            /.*\|\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)/i,
            
            // Padrão: tamanho: 00x00x00
            /tamanho:?\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)/i,
            
            // Captura dimensões dentro de parênteses: (00x00x00)
            /\((\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)\s*x\s*(\d+[,.]?\d*)\)/i
          ];
          
          for (const pattern of dimensionPatterns) {
            const match = description.match(pattern);
            if (match) {
              const widthStr = match[1].replace(',', '.');
              const heightStr = match[2].replace(',', '.');
              const depthStr = match[3].replace(',', '.');
              
              let widthNum = parseFloat(widthStr);
              let heightNum = parseFloat(heightStr);
              let depthNum = parseFloat(depthStr);
              
              // Converter de metros para centímetros se necessário
              if (widthStr.includes(',') || widthNum < 10) widthNum *= 100;
              if (heightStr.includes(',') || heightNum < 10) heightNum *= 100;
              if (depthStr.includes(',') || depthNum < 10) depthNum *= 100;
              
              // Verificar se parece ser uma dimensão válida
              if (!isNaN(widthNum) && !isNaN(heightNum) && !isNaN(depthNum)) {
                sizes.push({
                  width: widthNum,
                  height: heightNum,
                  depth: depthNum,
                  label: `L${widthNum} x A${heightNum} x P${depthNum}`
                });
                break;
              }
            }
          }
        }
      }
      
      // Extrair informações do fabricante
      let manufacturer = '';
      
      // Verificar campos específicos que podem conter informações do fabricante
      const manufacturerFields = ['fabricante', 'manufacturer', 'marca', 'brand', 'fornecedor', 'supplier'];
      
      for (const field of manufacturerFields) {
        if (rawProduct[field] && typeof rawProduct[field] === 'string' && rawProduct[field].trim().length > 0) {
          manufacturer = rawProduct[field].trim();
          break;
        }
      }

      // Verificar se temos o fabricante indicado no formato de Sofá Home/POE
      if (!manufacturer && supplierColumnKey && rawProduct[supplierColumnKey]) {
        manufacturer = String(rawProduct[supplierColumnKey]).trim();
      }
      
      // Verificar se há um padrão de "forn." ou "fornecedor" na descrição
      if (!manufacturer && typeof description === 'string') {
        // Padrões para identificar fornecedor na descrição
        const fornPatterns = [
          // Padrão: forn. Nome do Fornecedor
          /forn\.?\s*([A-Za-zÀ-ÿ0-9\s\-&]+?)(?:\s*\||$|\.|;)/i,
          
          // Padrão: fornecedor: Nome do Fornecedor
          /fornecedor:?\s*([A-Za-zÀ-ÿ0-9\s\-&]+?)(?:\s*\||$|\.|;)/i,
          
          // Padrão: fabricante: Nome do Fabricante
          /fabricante:?\s*([A-Za-zÀ-ÿ0-9\s\-&]+?)(?:\s*\||$|\.|;)/i,
          
          // Padrão: marca: Nome da Marca
          /marca:?\s*([A-Za-zÀ-ÿ0-9\s\-&]+?)(?:\s*\||$|\.|;)/i,
          
          // Padrão específico: EMPTY_2-Estilo Especial | EMPTY_3-Fornecedor
          /EMPTY_[0-9]+-([A-Za-zÀ-ÿ0-9\s\-&]+)/i
        ];
        
        for (const pattern of fornPatterns) {
          const match = description.match(pattern);
          if (match && match[1]) {
            manufacturer = match[1].trim();
            
            // Limpar o texto do fornecedor se necessário
            manufacturer = manufacturer
              .replace(/^\s*-\s*/, '') // Remove traços iniciais
              .replace(/\s*-\s*$/, '') // Remove traços finais
              .trim();
              
            if (manufacturer) break;
          }
        }
      }
      
      // Se ainda não encontramos o fabricante, tente extraí-lo do nome/descrição
      if (!manufacturer) {
        // Lista de fabricantes conhecidos
        const knownManufacturers = [
          'Sierra', 'Estúdio Bola', 'Fratini', 'Líder Interiores', 'Artefacto', 'Breton', 
          'Casual', 'Clami', 'Deco Metal', 'Donatelli', 'Etel', 'Estar Móveis', 
          'Fermob', 'Flexform', 'Franccino', 'Home Design', 'Kartell', 'La Falaise', 
          'Lattoog', 'Lovato', 'Marchetaria', 'Micasa', 'Minotti', 'Modalle', 
          'Natuzzi', 'Orlean', 'Pratice', 'Riflessi', 'Studio Welter', 'Taracea', 
          'Tissot', 'Todeschini', 'Tunelli', 'Via Star', 'Vitra', 'Wentz',
          'POE', 'Studio', 'Spazzio', 'House', 'Collection', 'Interiores',
          'Sofá Home', 'Sofa Home', 'Baú/Puff', 'Especial', 'Poltrona', 'Italsofa'
        ];
        
        // Verificar se o nome ou descrição contém algum fabricante conhecido
        const textToSearch = `${productName} ${description}`.toLowerCase();
        
        for (const knownManufacturer of knownManufacturers) {
          if (textToSearch.includes(knownManufacturer.toLowerCase())) {
            manufacturer = knownManufacturer;
            break;
          }
        }
      }
      
      // Extrair informações sobre a localização do produto (piso, depósito, etc)
      let location = '';
      
      // Verificar campos específicos que podem conter informações de localização
      const locationFields = ['localizacao', 'location', 'piso', 'floor', 'deposito', 'warehouse', 'local'];
      
      for (const field of locationFields) {
        if (rawProduct[field] && typeof rawProduct[field] === 'string' && rawProduct[field].trim().length > 0) {
          location = rawProduct[field].trim();
          break;
        }
      }
      
      // Verificar se temos a localização indicada no formato específico de Sofá Home/POE
      if (!location && locationColumnKey && rawProduct[locationColumnKey]) {
        location = String(rawProduct[locationColumnKey]).trim();
      }
      
      // Se não encontramos a localização em campos específicos, procurar no código ou nome
      if (!location) {
        const locationPatterns = [
          {pattern: /\b(piso\s?[0-9])\b/i, extract: (match: string[]) => match[1]},
          {pattern: /\b([0-9](º|o)\s?piso)\b/i, extract: (match: string[]) => match[1]},
          {pattern: /\b(deposito|depósito)\b/i, extract: () => 'Depósito'},
          {pattern: /\b(outlet)\b/i, extract: () => 'Outlet'},
          {pattern: /\b(showroom)\b/i, extract: () => 'Showroom'},
          {pattern: /\b(estoque)\b/i, extract: () => 'Estoque'}
        ];
        
        const textToSearch = `${productCode} ${productName} ${description}`.toLowerCase();
        
        for (const {pattern, extract} of locationPatterns) {
          const match = textToSearch.match(pattern);
          if (match) {
            location = extract(match);
            break;
          }
        }
      }
      
      // Processar URL da imagem
      let processedImageUrl = imageUrl;
      
      // Processar o campo de imagem especialmente para Sofá Home/POE
      if (isSofaHomeOrPOEFormat && imageColumnKey && rawProduct[imageColumnKey]) {
        const rawImage = rawProduct[imageColumnKey];
        if (typeof rawImage === 'string') {
          // Verificar se a URL da imagem já está formada
          if (rawImage.startsWith('http') || rawImage.startsWith('/uploads/')) {
            processedImageUrl = rawImage;
          } 
          // Se for um caminho relativo ou base64
          else if (rawImage.length > 0) {
            // Criar um ID único para a imagem
            const imageId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            processedImageUrl = `/uploads/extracted_images/product_${imageId}.jpg`;
            console.log(`Processada imagem para formato URL: ${processedImageUrl}`);
          }
        }
      }
      
      // Se tivermos localização, adicioná-la à descrição
      let fullDescription = description;
      if (location) {
        if (fullDescription) {
          fullDescription = `${fullDescription} | Local: ${location}`;
        } else {
          fullDescription = `Local: ${location}`;
        }
      }
      
      // Construir o objeto de produto normalizado
      normalizedProducts.push({
        name: productName || 'Produto sem nome',
        description: fullDescription,
        code: productCode || `AUTO-${Date.now().toString().slice(-8)}-${Math.floor(Math.random()*1000)}`,
        price,
        category,
        manufacturer, // Adicionar o fornecedor/fabricante
        colors,
        materials,
        sizes,
        imageUrl: processedImageUrl,
        location, // Adicionar campo de localização
        stock: rawProduct.estoque || rawProduct.stock || null,
        isEdited: false, // Inicialmente não editado manualmente
        createdAt: new Date(),
        updatedAt: new Date(),
        // Garantir que o catalogId esteja associado ao produto
        catalogId: catalogId || null,
        userId: userId || null,
        // Manter campos originais adicionais para debug
        originalData: { ...rawProduct }
      });
    }
  }
  
  return normalizedProducts;
}

/**
 * Processar vários arquivos Excel e combinar os resultados
 * @param filePaths Caminhos para os arquivos Excel
 * @param userId ID do usuário para associar aos produtos
 * @param catalogId ID do catálogo para associar aos produtos
 * @returns Array combinado de produtos processados
 */
export async function processMultipleExcelFiles(
  filePaths: string[],
  userId?: string | number,
  catalogId?: string | number
): Promise<any[]> {
  try {
    const allProducts: any[] = [];
    
    for (const filePath of filePaths) {
      try {
        console.log(`Processando arquivo Excel: ${filePath} para catalogId=${catalogId}`);
        const products = await processExcelFile(filePath, userId, catalogId);
        allProducts.push(...products);
      } catch (error) {
        console.error(`Erro ao processar arquivo ${filePath}:`, error);
        // Continua para o próximo arquivo mesmo se houver erro
      }
    }
    
    console.log(`Processados ${allProducts.length} produtos no total de ${filePaths.length} arquivos`);
    
    // Garantir que todos os produtos tenham catalogId e userId
    if (catalogId || userId) {
      allProducts.forEach(product => {
        if (catalogId && !product.catalogId) {
          product.catalogId = catalogId;
        }
        if (userId && !product.userId) {
          product.userId = userId;
        }
      });
    }
    
    return allProducts;
  } catch (error) {
    console.error('Erro ao processar múltiplos arquivos Excel:', error);
    throw new Error('Falha ao processar arquivos Excel');
  }
}

export default {
  processExcelFile,
  processMultipleExcelFiles
};