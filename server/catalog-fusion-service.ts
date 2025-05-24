import { storage } from './storage.js';
import { Product } from '@shared/schema'; // Tipo para produtos do DB (artístico)
import { ExtractedPriceItem } from './pricing-file-processor.js'; // Tipo para itens do arquivo de preço
import OpenAI from "openai";

// Inicializar OpenAI se for usar para fallback de mesclagem
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const TEXT_EMBEDDING_MODEL = 'text-embedding-3-small'; // Modelo de embedding

interface FusionResult {
  processedArtisticProducts: number;
  matchedPricingItems: number;
  productsUpdatedWithPrice: number;
  matchDetails: Array<{
    productId: number;
    productName?: string | null;
    productCode?: string | null;
    matchedBy: 'code' | 'name_category_ai' | 'none';
    priceFound?: number | null;
    priceUpdated: boolean;
    notes?: string;
  }>;
}

/**
 * Mescla os dados de produtos artísticos com itens de preço e atualiza o banco.
 * @param catalogId ID do catálogo sendo processado.
 * @param artisticProducts Lista de produtos já salvos (do arquivo artístico).
 * @param pricingItems Lista de itens extraídos do arquivo de preços.
 * @returns Um objeto com o resultado da fusão.
 */
export async function fuseCatalogData(
  catalogId: number,
  artisticProducts: Product[],
  pricingItems: ExtractedPriceItem[] | null
): Promise<FusionResult> {
  console.log(`[FusionService] Iniciando fusão de dados para o catálogo ID: ${catalogId}. Produtos artísticos: ${artisticProducts.length}, Itens de preço: ${pricingItems?.length || 0}`);

  const result: FusionResult = {
    processedArtisticProducts: artisticProducts.length,
    matchedPricingItems: 0,
    productsUpdatedWithPrice: 0,
    matchDetails: [],
  };

  if (!pricingItems || pricingItems.length === 0) {
    console.log(`[FusionService] Nenhum item de preço fornecido para o catálogo ID: ${catalogId}. Nenhuma fusão será realizada.`);
    result.matchDetails = artisticProducts.map(p => ({
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        matchedBy: 'none', 
        priceUpdated: false,
        notes: 'Nenhum dado de preço para comparar.'
    }));
    return result;
  }

  const priceItemsByCode = new Map<string, ExtractedPriceItem>();
  pricingItems.forEach(item => {
    if (item.code) {
      priceItemsByCode.set(String(item.code).trim().toLowerCase(), item);
    }
  });
  console.log(`[FusionService] Mapa de itens de preço por código criado com ${priceItemsByCode.size} entradas únicas de código.`);

  for (const product of artisticProducts) {
    let matchedPriceItem: ExtractedPriceItem | null = null;
    let matchType: 'code' | 'name_category_ai' | 'none' = 'none';
    let matchNotes = "";

    // 1. Tentar correspondência por CÓDIGO
    if (product.code) {
      const productCodeClean = String(product.code).trim().toLowerCase();
      if (priceItemsByCode.has(productCodeClean)) {
        matchedPriceItem = priceItemsByCode.get(productCodeClean) || null;
        if (matchedPriceItem) {
            matchType = 'code';
            result.matchedPricingItems++;
            matchNotes = `Correspondência por código: ${product.code}`;
            console.log(`[FusionService] Produto ID ${product.id} (${product.name}) teve MATCH por código '${product.code}' com item de preço.`);
        }
      }
    }

    // 2. Tentar correspondência por NOME/CATEGORIA + IA (Fallback)
    // TODO: Implementar a lógica de fallback com IA
    if (!matchedPriceItem) {
      matchNotes = "Nenhuma correspondência por código. Fallback por IA ainda não implementado.";
    }

    // 3. Atualizar produto no banco se um preço foi encontrado
    let priceWasUpdated = false;
    if (matchedPriceItem && typeof matchedPriceItem.price === 'number' && !isNaN(matchedPriceItem.price)) {
      try {
        const priceInCents = Math.round(matchedPriceItem.price * 100);
        await storage.updateProductPrice(product.id, priceInCents);
        result.productsUpdatedWithPrice++;
        priceWasUpdated = true;
        matchNotes += ` | Preço atualizado para: ${priceInCents / 100}.`;
        console.log(`[FusionService] Produto ID ${product.id} (${product.name}) atualizado com preço: ${priceInCents / 100}.`);
      } catch (error) {
        console.error(`[FusionService] Erro ao atualizar preço para o produto ID ${product.id}:`, error);
        matchNotes += ` | Erro ao atualizar preço: ${error instanceof Error ? error.message : String(error)}.`;
      }
    }

    result.matchDetails.push({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      matchedBy: matchType,
      priceFound: matchedPriceItem?.price,
      priceUpdated: priceWasUpdated,
      notes: matchNotes,
    });
  }

  console.log(`[FusionService] Fusão concluída para o catálogo ID: ${catalogId}. Produtos atualizados com preço: ${result.productsUpdatedWithPrice}`);
  return result;
}

// Exemplo de como a função de update no storage.ts poderia ser (precisa ser criada):
/*
async updateProductPrice(productId: number, priceInCents: number): Promise<Product | null> {
  try {
    const updatedProducts = await db
      .update(productsSchema) // Ensure productsSchema is imported from '@shared/schema'
      .set({ price: priceInCents, updatedAt: new Date(), isEdited: true }) // Mark as edited when price is updated by fusion
      .where(eq(productsSchema.id, productId)) // Ensure eq is imported from 'drizzle-orm'
      .returning();
    return updatedProducts[0] || null;
  } catch (error) {
    console.error(`Erro ao atualizar preço do produto ID ${productId}:`, error);
    throw error;
  }
}
*/ 