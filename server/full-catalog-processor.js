/**
 * Processador completo de catálogos
 * 
 * Este módulo processa catálogos completos, extraindo todas as informações
 * incluindo preços, categorias, códigos de produto, etc.
 */

import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { db } from './db.js';
import { products } from '../shared/schema.js';
import { eq } from 'drizzle-orm';
// Vamos importar as funções de processamento diretamente do arquivo
import * as excelProcessor from './excel-processor-improved.js';

/**
 * Converte uma string de preço no formato brasileiro para centavos
 * @param {string} priceStr - String de preço (ex: "R$ 1.234,56")
 * @returns {number} - Preço em centavos
 */
function convertPriceToCents(priceStr) {
  if (!priceStr || priceStr === '#########' || priceStr === '') return 0;
  
  // Remove R$, pontos e espaços
  const cleanStr = String(priceStr).replace(/R\$|\s|\./g, '');
  
  // Substitui vírgula por ponto e converte para número
  const price = parseFloat(cleanStr.replace(',', '.'));
  
  // Converte para centavos (multiplica por 100) e arredonda
  return isNaN(price) ? 0 : Math.round(price * 100);
}

/**
 * Extrai a categoria do produto com base em informações do Excel
 * @param {Object} row - Linha do Excel
 * @returns {string} - Categoria do produto
 */
function extractCategory(row) {
  // Possíveis campos que indicam categoria
  const possibleFields = [
    'Categoria', 'Linha', 'Tipo', 'DESCRIÇÃO', 'PRODUTO'
  ];
  
  // Verifica os campos conhecidos
  for (const field of possibleFields) {
    if (row[field]) {
      return row[field];
    }
  }
  
  // Tenta inferir a categoria com base no texto de outros campos
  const description = row['DESCRIÇÃO'] || row['Descrição'] || '';
  if (/colch[ãa]o/i.test(description)) return 'Colchões';
  if (/sof[áa]/i.test(description)) return 'Sofás';
  if (/mesa/i.test(description)) return 'Mesas';
  if (/poltrona/i.test(description)) return 'Poltronas';
  if (/banco/i.test(description)) return 'Bancos';
  if (/cadeira/i.test(description)) return 'Cadeiras';
  if (/cama/i.test(description)) return 'Camas';
  
  // Se não encontrar, usa o default
  return 'Outros';
}

/**
 * Extrai a localização do produto no showroom
 * @param {Object} row - Linha do Excel
 * @returns {string} - Localização do produto
 */
function extractLocation(row) {
  const locationFields = ['LOCAL', 'Depósito', 'Localização', 'Local'];
  
  for (const field of locationFields) {
    if (row[field]) {
      return row[field];
    }
  }
  
  return 'Showroom';
}

/**
 * Extrai o nome do produto
 * @param {Object} row - Linha do Excel
 * @returns {string} - Nome do produto
 */
function extractProductName(row) {
  // Verifica campos comuns para nome do produto
  const nameFields = [
    'DESCRIÇÃO', 'Descrição', 'Produto', 'PRODUTO', 'NOME', 'Nome'
  ];
  
  for (const field of nameFields) {
    if (row[field]) {
      return row[field];
    }
  }
  
  // Se não encontrar um campo específico, tenta construir um nome a partir de outros campos
  const brand = row['MARCA'] || row['Marca'] || '';
  const model = row['MODELO'] || row['Modelo'] || '';
  const dimension = row['DIMENSÕES'] || row['Dimensões'] || '';
  
  if (brand || model) {
    return [brand, model, dimension].filter(Boolean).join(' ');
  }
  
  // Default se não encontrar nada
  return 'Produto sem nome';
}

/**
 * Processa um arquivo Excel completo extraindo todos os produtos
 * @param {string} filePath - Caminho para o arquivo Excel
 * @param {number} userId - ID do usuário
 * @param {number} catalogId - ID do catálogo
 * @returns {Promise<Array>} - Lista de produtos extraídos
 */
async function processFullCatalog(filePath, userId, catalogId) {
  console.log(`Processando catálogo completo: ${filePath}`);
  
  try {
    // Ler o arquivo Excel
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    const rows = xlsx.utils.sheet_to_json(worksheet);
    console.log(`Encontradas ${rows.length} linhas no Excel`);
    
    // Extrair produtos
    const products = [];
    
    rows.forEach((row, index) => {
      // Pular linhas sem informações essenciais (cabeçalhos, linhas vazias, etc)
      if (index === 0 || !Object.keys(row).length) return;
      
      // Extrair informações do produto
      const code = row['CÓDIGO'] || row['Código'] || row['COD'] || 
                  row['REFERÊNCIA'] || row['REF'] || `ITEM-${index}`;
      
      const price = convertPriceToCents(row['PREÇO'] || row['Preço'] || row['VALOR'] || 
                                        row['Valor'] || row['PREÇO TABELA'] || 0);
      
      const name = extractProductName(row);
      const category = extractCategory(row);
      const location = extractLocation(row);
      const manufacturer = row['FABRICANTE'] || row['Fabricante'] || row['MARCA'] || row['Marca'] || '';
      
      // Juntar todas as informações disponíveis para a descrição
      const descriptionParts = [];
      if (row['DESCRIÇÃO COMPLETA'] || row['Descrição Completa']) 
        descriptionParts.push(row['DESCRIÇÃO COMPLETA'] || row['Descrição Completa']);
      if (row['MATERIAL'] || row['Material']) 
        descriptionParts.push(`Material: ${row['MATERIAL'] || row['Material']}`);
      if (row['DIMENSÕES'] || row['Dimensões']) 
        descriptionParts.push(`Dimensões: ${row['DIMENSÕES'] || row['Dimensões']}`);
      if (row['ACABAMENTO'] || row['Acabamento']) 
        descriptionParts.push(`Acabamento: ${row['ACABAMENTO'] || row['Acabamento']}`);
      
      const description = descriptionParts.join('\n');
      
      const imageFilename = `image-${index}`;
      
      // Criar objeto do produto
      products.push({
        userId,
        catalogId,
        name,
        code,
        description,
        price,
        category,
        manufacturer,
        location,
        imageUrl: `/api/images/${userId}/${catalogId}/${Date.now()}-${imageFilename}.jpg`,
        colors: [],
        materials: [],
        sizes: [],
        stock: 1,
        excelRowNumber: index,
        isEdited: false,
        createdAt: new Date()
      });
    });
    
    console.log(`Extraídos ${products.length} produtos do Excel`);
    
    // Processar imagens do Excel (usando a função existente)
    const imagesDir = path.join(process.cwd(), 'uploads', `${userId}`, `${catalogId}`);
    fs.mkdirSync(imagesDir, { recursive: true });
    
    try {
      // Criar uma função simples para extrair imagens basada no excel-processor-improved
      // Não depender de importações que podem não estar disponíveis
      const JSZip = (await import('jszip')).default;
      const readFile = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(readFile);
      
      let imageCount = 0;
      
      // Procurar imagens na pasta 'xl/media'
      zip.forEach((relativePath, zipEntry) => {
        if (relativePath.startsWith('xl/media/') && 
            !zipEntry.dir && 
            /\.(png|jpg|jpeg|gif|emf)$/i.test(relativePath)) {
          
          // Extrair a imagem
          zipEntry.async('nodebuffer').then(content => {
            const filename = `image-${imageCount+1}${path.extname(relativePath)}`;
            const outputPath = path.join(imagesDir, filename);
            fs.writeFileSync(outputPath, content);
            imageCount++;
          }).catch(err => {
            console.error(`Erro ao extrair imagem ${relativePath}:`, err);
          });
        }
      });
      
      console.log(`Processadas ${imageCount} imagens do Excel para: ${imagesDir}`);
    } catch (imageError) {
      console.error('Erro ao extrair imagens:', imageError);
    }
    
    return products;
  } catch (error) {
    console.error('Erro ao processar catálogo completo:', error);
    throw error;
  }
}

/**
 * Importa todos os produtos de um catálogo para o banco de dados
 * @param {string} filePath - Caminho para o arquivo Excel
 * @param {number} userId - ID do usuário
 * @param {number} catalogId - ID do catálogo
 * @returns {Promise<{success: boolean, count: number}>} - Resultado da importação
 */
async function importFullCatalog(filePath, userId, catalogId) {
  console.log(`Importando catálogo completo: ${filePath}`);
  
  try {
    // Processar o catálogo
    const products = await processFullCatalog(filePath, userId, catalogId);
    
    if (!products || products.length === 0) {
      return { success: false, error: 'Nenhum produto encontrado no Excel' };
    }
    
    // Limpar produtos existentes
    await db.delete(products).where(eq(products.catalogId, catalogId));
    
    // Inserir no banco de dados em lotes para evitar problemas com catálogos muito grandes
    const batchSize = 100;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      await db.insert(products).values(batch);
      console.log(`Inserido lote ${i/batchSize + 1} com ${batch.length} produtos`);
    }
    
    return { success: true, count: products.length };
  } catch (error) {
    console.error('Erro ao importar catálogo completo:', error);
    return { success: false, error: error.message };
  }
}

export { processFullCatalog, importFullCatalog };