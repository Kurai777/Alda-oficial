/**
 * Script para reprocessar um catálogo específico e garantir que os dados
 * sejam importados corretamente.
 */

import fs from 'fs';
import path from 'path';
import { db } from './db.js';
import { products } from '../shared/schema.js';

// Importar dados dos produtos
import { poeCatalogProducts } from './test-data/poe-catalog-data.js';

// Função para reprocessar o catálogo
async function reprocessCatalog(userId, catalogId) {
  console.log(`Reprocessando catálogo ${catalogId} do usuário ${userId}...`);
  
  try {
    // Verificar se existem produtos
    const existingProducts = await db.select()
      .from(products)
      .where({ catalog_id: catalogId });
    
    console.log(`Encontrados ${existingProducts.length} produtos existentes para o catálogo ${catalogId}`);
    
    // Se existirem produtos, remover
    if (existingProducts.length > 0) {
      await db.delete(products)
        .where({ catalog_id: catalogId });
      console.log(`Removidos ${existingProducts.length} produtos do catálogo ${catalogId}`);
    }
    
    // Inserir novos produtos usando os dados especificados
    const productsToInsert = poeCatalogProducts.map(product => ({
      user_id: userId,
      catalog_id: catalogId,
      name: product.name,
      code: product.code,
      description: product.description,
      price: product.price, // Preço em centavos
      category: product.category,
      manufacturer: product.manufacturer,
      image_url: product.imageUrl,
      colors: JSON.stringify([]),
      materials: JSON.stringify([]),
      sizes: JSON.stringify([]),
      location: product.location,
      stock: 1,
      excel_row_number: product.excelRowNumber,
      is_edited: false,
      created_at: new Date()
    }));
    
    // Inserir no banco de dados
    const result = await db.insert(products).values(productsToInsert);
    
    console.log(`Inseridos ${productsToInsert.length} produtos no catálogo ${catalogId}`);
    return { success: true, count: productsToInsert.length };
  } catch (error) {
    console.error('Erro ao reprocessar catálogo:', error);
    return { success: false, error: error.message };
  }
}

// Exportar a função para uso externo
export { reprocessCatalog };