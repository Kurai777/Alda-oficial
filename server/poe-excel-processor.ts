/**
 * Processador especializado para arquivos Excel no formato POE
 * 
 * Este módulo implementa lógica específica para o formato POE que utiliza
 * cabeçalhos alfabéticos (A, B, C...) para identificar colunas.
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface POEProduct {
  name: string;
  code: string;
  price: number;
  description?: string;
  excelRowNumber: number;
  imageCell?: string; // Valor da célula que contém a imagem (coluna F geralmente)
  [key: string]: any;
}

/**
 * Processa um arquivo Excel no formato POE e extrai produtos
 * @param filePath Caminho para o arquivo Excel
 * @param userId ID do usuário para associar ao produto
 * @param catalogId ID do catálogo
 */
export async function processPOEExcelFile(
  filePath: string,
  userId?: string | number,
  catalogId?: string | number
): Promise<any[]> {
  console.log(`Processando arquivo Excel POE: ${filePath}`);
  console.log(`Usuário ID: ${userId}, Catálogo ID: ${catalogId}`);
  
  // Verificar se o arquivo existe
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  
  // Carregar o arquivo Excel
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0]; // Usar primeira aba
  const worksheet = workbook.Sheets[sheetName];
  
  // Obter os dados como array de objetos com cabeçalhos
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: "A" });
  console.log(`Planilha contém ${rawData.length} linhas`);
  
  // Array para armazenar os produtos extraídos
  const products: POEProduct[] = [];
  
  // Extrair informações da planilha (formato POE tem cabeçalhos alfabéticos A, B, C...)
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] as any;
    
    // Verificar se a linha tem informações de produto
    if (row.B && row.C) {
      // No formato POE:
      // - Coluna B: Código do produto
      // - Coluna C: Nome do produto
      // - Coluna D: Descrição (opcional)
      // - Coluna E: Preço
      // - Coluna F: Geralmente contém referência à imagem
      
      const product: POEProduct = {
        name: row.C?.toString() || "Produto sem nome",
        code: row.B?.toString() || "UNKNOWN-CODE",
        price: typeof row.E === 'number' ? row.E : 
               typeof row.E === 'string' ? 
               parseFloat(row.E.replace('R$', '').replace('.', '').replace(',', '.')) : 0,
        description: row.D?.toString() || "",
        excelRowNumber: i,
        imageCell: row.F?.toString() || "",
        userId: userId,
        catalogId: catalogId,
        createdAt: new Date(),
        updatedAt: new Date(),
        imageUrl: null
      };
      
      // Adicionar o produto ao array de produtos
      products.push(product);
    }
  }
  
  console.log(`Extraídos ${products.length} produtos do Excel POE`);
  
  // Extrair e associar imagens
  const productsWithImages = await extractAndMapPOEImages(filePath, products, userId, catalogId);
  
  return productsWithImages;
}

/**
 * Extrai imagens do Excel POE e as associa aos produtos
 * @param excelPath Caminho para o arquivo Excel
 * @param products Lista de produtos extraídos
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 */
async function extractAndMapPOEImages(
  excelPath: string,
  products: POEProduct[],
  userId?: string | number,
  catalogId?: string | number
): Promise<POEProduct[]> {
  console.log(`Extraindo imagens do Excel POE: ${excelPath}`);
  
  try {
    // Criar diretório para salvar as imagens
    const outputDir = path.join('uploads', 'extracted_images', `${Date.now()}_${path.basename(excelPath, path.extname(excelPath))}`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Importar os módulos de extração
    const robustExtractor = require('./robust-excel-image-extractor');
    const pythonBridge = require('./python-excel-bridge');
    
    // Tentar extrair imagens com método JavaScript robusto
    console.log(`Tentando extrair imagens com método JavaScript robusto...`);
    const jsResult = await robustExtractor.extractImages(excelPath, outputDir);
    
    // Se falhar, tentar com Python como fallback
    if (!jsResult.success || jsResult.count === 0) {
      console.log(`Método JavaScript falhou, tentando com Python...`);
      await pythonBridge.extractExcelImages(excelPath, outputDir);
    }
    
    // Listar todas as imagens extraídas
    console.log(`Verificando imagens extraídas em: ${outputDir}`);
    const extractedImages = fs.existsSync(outputDir) ? 
      fs.readdirSync(outputDir).filter(file => /\.(png|jpg|jpeg|gif|emf)$/i.test(file)) : [];
    
    console.log(`${extractedImages.length} imagens extraídas do Excel POE`);
    
    // Array para armazenar o resultado final
    const processedProducts = [...products];
    
    // Se não houver imagens extraídas, retornar os produtos sem imagens
    if (extractedImages.length === 0) {
      console.log(`Nenhuma imagem extraída do Excel POE`);
      return processedProducts;
    }
    
    // Associar imagens aos produtos
    // No formato POE, a coluna F geralmente contém uma referência à imagem
    const productsWithImages = processedProducts.map((product, index) => {
      // Procurar pela imagem - várias estratégias
      let imageFile;
      
      // Estratégia 1: Usar código do produto para encontrar a imagem
      if (product.code) {
        imageFile = extractedImages.find(img => 
          img.toLowerCase().includes(product.code.toLowerCase()) ||
          // Também verificar com código sem traços/espaços
          img.toLowerCase().includes(product.code.toLowerCase().replace(/[\s-_]/g, ''))
        );
      }
      
      // Estratégia 2: Usar nome do produto para encontrar a imagem
      if (!imageFile && product.name) {
        const productNameSimplified = product.name.toLowerCase().replace(/[\s-_]/g, '');
        imageFile = extractedImages.find(img => 
          img.toLowerCase().includes(productNameSimplified)
        );
      }
      
      // Estratégia 3: Usar valor da célula de imagem
      if (!imageFile && product.imageCell) {
        imageFile = extractedImages.find(img => 
          img.toLowerCase().includes(product.imageCell.toLowerCase())
        );
      }
      
      // Estratégia 4: Usar índice como distribuição sequencial
      if (!imageFile && index < extractedImages.length) {
        imageFile = extractedImages[index];
      }
      
      // Se encontrou uma imagem, associá-la ao produto
      if (imageFile) {
        // Caminhos para imagem
        const imagePath = path.join(outputDir, imageFile);
        const uniqueFilename = `${uuidv4()}_${imageFile}`;
        const uniqueImageDir = path.join('uploads', 'unique_product_images');
        
        // Criar diretório para imagens únicas
        if (!fs.existsSync(uniqueImageDir)) {
          fs.mkdirSync(uniqueImageDir, { recursive: true });
        }
        
        // Caminho para imagem única
        const uniqueImagePath = path.join(uniqueImageDir, uniqueFilename);
        
        // Copiar imagem para o diretório de imagens únicas
        try {
          fs.copyFileSync(imagePath, uniqueImagePath);
          console.log(`Imagem copiada para: ${uniqueImagePath}`);
        } catch (copyError) {
          console.error(`Erro ao copiar imagem para: ${uniqueImagePath}`, copyError);
        }
        
        // Associar URL da imagem ao produto (usando caminho relativo)
        product.imageUrl = `/uploads/unique_product_images/${uniqueFilename}`;
        product.originalImageFile = imageFile;
      }
      
      return product;
    });
    
    // Contar produtos com imagens
    const productsWithImagesCount = productsWithImages.filter(p => p.imageUrl).length;
    console.log(`${productsWithImagesCount} de ${productsWithImages.length} produtos possuem imagens associadas`);
    
    return productsWithImages;
  } catch (error) {
    console.error('Erro ao extrair e mapear imagens POE:', error);
    // Retornar produtos sem imagens em caso de erro
    return products;
  }
}