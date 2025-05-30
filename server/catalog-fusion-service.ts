import { storage } from './storage.js';
import { Product, InsertProductVariation } from '@shared/schema'; // Adicionar InsertProductVariation
import { ExtractedPriceItem } from './pricing-file-processor.js'; // Tipo para itens do arquivo de preço
import OpenAI from "openai";

// Inicializar OpenAI se for usar para fallback de mesclagem
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const TEXT_EMBEDDING_MODEL = 'text-embedding-3-small'; // Modelo de embedding

interface FusionResult {
  processedArtisticProducts: number;
  matchedPricingItems: number;
  productsUpdatedWithPrice: number; // Agora representa produtos que tiveram pelo menos uma variação criada/associada
  matchDetails: Array<{
    productId: number;
    productName?: string | null;
    productCode?: string | null;
    matchedBy: string; // Alterado para string genérica
    priceFound?: number | null; // Este campo se torna menos relevante, pois os preços estão nas variações
    priceUpdated: boolean; // Indica se alguma variação de preço foi associada
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

  // Função auxiliar para normalizar nomes para comparação
  const normalizeName = (name: string | null | undefined): string => {
    if (!name) return '';
    return name.trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .replace(/[^a-z0-9\s]/gi, '') // Remove caracteres não alfanuméricos (exceto espaço)
      .replace(/\s+/g, ' '); // Normaliza múltiplos espaços para um único
  };

  // Função auxiliar para calcular a similaridade de Dice entre duas strings
  const calculateDiceSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1.0;

    const getBigrams = (s: string): Set<string> => {
      const bigrams = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.substring(i, i + 2));
      }
      return bigrams;
    };

    const bigrams1 = getBigrams(s1);
    const bigrams2 = getBigrams(s2);

    if (bigrams1.size === 0 && bigrams2.size === 0) return 1.0; // Ambas vazias após processamento, considerar iguais
    if (bigrams1.size === 0 || bigrams2.size === 0) return 0;   // Uma vazia, outra não

    let intersectionSize = 0;
    bigrams1.forEach(bigram => {
      if (bigrams2.has(bigram)) {
        intersectionSize++;
      }
    });
    return (2 * intersectionSize) / (bigrams1.size + bigrams2.size);
  };

  const SIMILARITY_THRESHOLD = 0.80; // Limiar para considerar um match por nome

  for (const product of artisticProducts) {
    let matchOccurredForProduct = false; // Flag para saber se este produto do PDF teve algum match
    let notesForThisProduct = "";

    // Tentativa de match por CÓDIGO do produto artístico com CÓDIGO do item de preço
    // Esta lógica é mais para quando o CÓDIGO é do MODELO BASE e esperamos apenas UMA entrada de preço por ele.
    // Para o modelo um-para-muitos, a principal lógica de match será por nome/model_base.
    if (product.code) {
      const productCodeClean = String(product.code).trim().toLowerCase();
      const priceItemForThisCode = priceItemsByCode.get(productCodeClean);

      if (priceItemForThisCode && priceItemForThisCode.prices && priceItemForThisCode.prices.length > 0) {
        matchOccurredForProduct = true;
        result.matchedPricingItems++; // Contamos como um item de preço principal correspondido
        notesForThisProduct += `Match por código direto do produto (${product.code}). `;

        // Criar uma variação para este match por código
        try {
          const variationToCreate: InsertProductVariation = {
            productId: product.id,
            name: priceItemForThisCode.name || product.name, 
            variationDescription: priceItemForThisCode.variation_description || null,
            dimensionsLabel: priceItemForThisCode.dimensions || null,
            priceClasses: priceItemForThisCode.prices.map(p => ({className: p.className, value: p.value})),
            sku: priceItemForThisCode.code || product.code || null,
          };
          await storage.createProductVariation(variationToCreate);
          result.productsUpdatedWithPrice++; // Consideramos "atualizado" se pelo menos uma variação for criada
          notesForThisProduct += `Variação (por código) criada. Preços: ${JSON.stringify(variationToCreate.priceClasses)}. `;
          console.log(`[FusionService CODE MATCH] Variação criada para Prod ID ${product.id} (${product.name}) via código ${product.code}.`);
        } catch (e) {
          console.error(`[FusionService CODE MATCH] Erro ao criar variação para Prod ID ${product.id} via código:`, e);
          notesForThisProduct += `Erro ao criar variação por código. `;
        }
      }
    }

    // Se não houve match por código direto, ou mesmo que tenha havido, 
    // ainda procuramos por correspondências de model_base para capturar todas as variações.
    // Isto é importante porque o código no produto artístico pode ser genérico (do modelo base),
    // enquanto a planilha de preços tem múltiplas variações desse modelo.
    const normalizedProductNamePdf = normalizeName(product.name);

    if (normalizedProductNamePdf) {
      // Encontrar TODOS os priceItems cujo model_base corresponde ao nome do produto do PDF
      const matchingPriceItemsByModelBase = pricingItems.filter(pi => normalizeName(pi.model_base) === normalizedProductNamePdf);
      
      let foundMatchViaModelBaseName = false;
      if (matchingPriceItemsByModelBase.length > 0) {
        foundMatchViaModelBaseName = true;
        notesForThisProduct += `Match por NOME do PDF com MODEL_BASE da planilha ('${product.name}'). `;
        result.matchedPricingItems += matchingPriceItemsByModelBase.length; // Contar todos os itens de variação correspondentes

        for (const priceItem of matchingPriceItemsByModelBase) {
          if (priceItem.prices && priceItem.prices.length > 0) {
            try {
              const variationToCreate: InsertProductVariation = {
                productId: product.id,
                name: priceItem.name || `${product.name} - ${priceItem.variation_description || 'Variação'}`,
                variationDescription: priceItem.variation_description || null,
                dimensionsLabel: priceItem.dimensions || null,
                priceClasses: priceItem.prices.map(p => ({className: p.className, value: p.value})),
                sku: priceItem.code || null,
              };
              await storage.createProductVariation(variationToCreate);
              if (!matchOccurredForProduct) result.productsUpdatedWithPrice++; // Incrementar apenas uma vez por produto do PDF
              matchOccurredForProduct = true; 
              notesForThisProduct += `Variação '${priceItem.name}' criada. Preços: ${JSON.stringify(variationToCreate.priceClasses)}. `;
              console.log(`[FusionService NAME->MODEL_BASE MATCH] Variação '${priceItem.name}' criada para Prod ID ${product.id} (${product.name}).`);

              // ATUALIZAR O PREÇO DO PRODUTO PRINCIPAL (product.price) com o primeiro preço da primeira variação encontrada para este model_base
              if (result.productsUpdatedWithPrice <= artisticProducts.length && variationToCreate.priceClasses && variationToCreate.priceClasses.length > 0) {
                const existingDetail = result.matchDetails.find(md => md.productId === product.id);
                if (!existingDetail || !existingDetail.priceUpdated) { 
                  const firstPriceOfVariation = variationToCreate.priceClasses[0].value;
                  product.price = firstPriceOfVariation; // Salvar em Reais
                  await storage.updateProductPrice(product.id, product.price); // Assumindo que product.price é Reais
                  console.log(`[FusionService] Produto principal ID ${product.id} (${product.name}) atualizado com preço base: ${firstPriceOfVariation / 100} (da variação '${variationToCreate.name}').`);
                }
              }
            } catch (e) {
              console.error(`[FusionService NAME->MODEL_BASE MATCH] Erro ao criar variação '${priceItem.name}' para Prod ID ${product.id}:`, e);
              notesForThisProduct += `Erro ao criar variação '${priceItem.name}'. `;
            }
          } else {
             console.log(`[FusionService NAME->MODEL_BASE MATCH] PriceItem '${priceItem.name}' para Prod ID ${product.id} não tinha preços válidos.`);
             notesForThisProduct += `Variação '${priceItem.name}' encontrada mas sem preços válidos. `;
          }
        }
      }

      // Fallback para Similaridade de Dice se NENHUM match por model_base foi encontrado
      if (!foundMatchViaModelBaseName) {
        let bestDiceMatch: { item: ExtractedPriceItem, score: number } | null = null;
        for (const priceItem of pricingItems) {
            // Não reutilizar priceItems que já foram parte de um model_base match para este produto do PDF
            // (Esta verificação pode ser complexa, por ora, vamos permitir que Dice funcione como um fallback mais amplo)
            
            const normalizedPriceItemFullName = normalizeName(priceItem.name);
            const similarity = calculateDiceSimilarity(normalizedProductNamePdf, normalizedPriceItemFullName);
            
            if (similarity >= SIMILARITY_THRESHOLD) {
                if (!bestDiceMatch || similarity > bestDiceMatch.score) {
                    bestDiceMatch = { item: priceItem, score: similarity };
                }
            }
        }

        if (bestDiceMatch) {
            const priceItem = bestDiceMatch.item;
            matchOccurredForProduct = true;
              result.matchedPricingItems++; 
            notesForThisProduct += `Match por Similaridade Dice (${bestDiceMatch.score.toFixed(2)}) com '${priceItem.name}'. `;
            console.log(`[FusionService DICE MATCH] Produto ID ${product.id} (${product.name}) teve MATCH por Similaridade Dice (${bestDiceMatch.score.toFixed(2)}) com item de preço '${priceItem.name}'.`);
            
            if (priceItem.prices && priceItem.prices.length > 0) {
                try {
                    const variationToCreate: InsertProductVariation = {
                        productId: product.id,
                        name: priceItem.name || product.name,
                        variationDescription: priceItem.variation_description || null,
                        dimensionsLabel: priceItem.dimensions || null,
                        priceClasses: priceItem.prices.map(p => ({className: p.className, value: p.value})),
                        sku: priceItem.code || null,
                    };
                    await storage.createProductVariation(variationToCreate);
                    if (!matchOccurredForProduct) result.productsUpdatedWithPrice++; 
                    matchOccurredForProduct = true; 
                    notesForThisProduct += `Variação (Dice) '${priceItem.name}' criada. Preços: ${JSON.stringify(variationToCreate.priceClasses)}. `;

                    // ATUALIZAR O PREÇO DO PRODUTO PRINCIPAL (product.price) com o primeiro preço desta variação (Dice)
                    if (result.productsUpdatedWithPrice <= artisticProducts.length && variationToCreate.priceClasses && variationToCreate.priceClasses.length > 0) {
                      const existingDetail = result.matchDetails.find(md => md.productId === product.id);
                      if (!existingDetail || !existingDetail.priceUpdated) { 
                        const firstPriceOfVariation = variationToCreate.priceClasses[0].value;
                        product.price = firstPriceOfVariation; // Salvar em Reais
                        await storage.updateProductPrice(product.id, product.price); // Assumindo que product.price é Reais
                        console.log(`[FusionService DICE MATCH] Produto principal ID ${product.id} (${product.name}) atualizado com preço base: ${firstPriceOfVariation / 100} (da variação '${variationToCreate.name}').`);
                      }
                    }
                } catch (e) {
                    console.error(`[FusionService DICE MATCH] Erro ao criar variação '${priceItem.name}' para Prod ID ${product.id}:`, e);
                    notesForThisProduct += `Erro ao criar variação (Dice) '${priceItem.name}'. `;
                }
            } else {
                console.log(`[FusionService DICE MATCH] PriceItem '${priceItem.name}' para Prod ID ${product.id} não tinha preços válidos.`);
                notesForThisProduct += `Variação (Dice) '${priceItem.name}' encontrada mas sem preços válidos. `;
            }
        }
      }
    }

    if (!matchOccurredForProduct) {
      notesForThisProduct = "Nenhuma correspondência de preço encontrada na planilha.";
      console.log(`[FusionService] Produto ID ${product.id} (${product.name}) não encontrou correspondência na planilha de preços.`);
    }

    result.matchDetails.push({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      matchedBy: matchOccurredForProduct ? 'code/name_model_base/dice' : 'none', // Simplificado, a nota terá mais detalhes
      priceFound: null, // Não aplicável diretamente, pois agora temos variações
      priceUpdated: matchOccurredForProduct, // Consideramos atualizado se alguma variação foi criada
      notes: notesForThisProduct.trim(),
    });
  }

  console.log(`[FusionService] Fusão concluída para o catálogo ID: ${catalogId}. Produtos que tiveram variações de preço criadas/associadas: ${result.productsUpdatedWithPrice}`);
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