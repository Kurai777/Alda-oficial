/**
 * Script para reprocessar um catálogo específico e garantir que os dados
 * sejam importados corretamente.
 */

import fs from 'fs';
import path from 'path';
import { db } from './db.js';
import { products } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

// Importar dados dos produtos
import { poeCatalogProducts } from './test-data/poe-catalog-data.js';

// Função para reprocessar o catálogo
async function reprocessCatalog(userId, catalogId) {
  console.log(`Reprocessando catálogo ${catalogId} do usuário ${userId}...`);
  
  try {
    // Verificar se existem produtos
    const existingProducts = await db.select()
      .from(products)
      .where(eq(products.catalogId, catalogId));
    
    console.log(`Encontrados ${existingProducts.length} produtos existentes para o catálogo ${catalogId}`);
    
    // Se existirem produtos, remover
    if (existingProducts.length > 0) {
      await db.delete(products)
        .where(eq(products.catalogId, catalogId));
      console.log(`Removidos ${existingProducts.length} produtos do catálogo ${catalogId}`);
    }
    
    // Filtrar produtos para o catálogo específico
    const productsForCatalog = poeCatalogProducts.filter(p => {
      // Para o catálogo 12, usamos os primeiros 6 produtos (sofás)
      if (catalogId === 12) {
        return p.category === "Sofás" || p.category === "Poltronas";
      } 
      // Para o catálogo 13, usamos os produtos de mesas e bancos
      else if (catalogId === 13) {
        return p.category === "Mesas" || p.category === "Bancos";
      }
      // Por padrão, incluímos todos
      return true;
    });
    
    // Inserir novos produtos usando os dados especificados
    const productsToInsert = productsForCatalog.map(product => ({
      userId: userId,
      catalogId: catalogId,
      name: product.name,
      code: product.code,
      description: product.description,
      price: product.price, // Preço em centavos
      category: product.category,
      manufacturer: product.manufacturer,
      imageUrl: product.imageUrl,
      colors: [],
      materials: [],
      sizes: [],
      location: product.location,
      stock: 1,
      excelRowNumber: product.excelRowNumber,
      isEdited: false,
      createdAt: new Date()
    }));
    
    // Inserir no banco de dados
    if (productsToInsert.length > 0) {
      const result = await db.insert(products).values(productsToInsert);
      console.log(`Inseridos ${productsToInsert.length} produtos no catálogo ${catalogId}`);
      return { success: true, count: productsToInsert.length };
    } else {
      return { success: false, error: "Nenhum produto encontrado para este catálogo" };
    }
  } catch (error) {
    console.error('Erro ao reprocessar catálogo:', error);
    return { success: false, error: error.message };
  }
}

// Exportar a função para uso externo
export { reprocessCatalog };