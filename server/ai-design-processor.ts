/**
 * Módulo de processamento de design com IA
 * 
 * Este módulo é responsável por analisar imagens de plantas baixas e renders,
 * identificar móveis e sugerir substituições do catálogo real da empresa.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { db } from './db'; // Instância do Drizzle
import { sql, and, isNotNull, eq } from 'drizzle-orm'; // Funções do Drizzle ORM
import { products, type Product, type DesignProject, type NewDesignProjectItem, type DesignProjectItem, type AiDesignChatMessage } from '@shared/schema';
import { getClipEmbeddingFromImageUrl, getClipEmbeddingFromImageBuffer } from './clip-service'; // Adicionada getClipEmbeddingFromImageBuffer
import { broadcastToProject } from './index';
import sharp from 'sharp';
import { getSegmentationMaskSAM } from './replicate-service'; // Importar getSegmentationMaskSAM

// Inicializar clientes de IA
// Use o mais recente modelo do OpenAI: gpt-4o que foi lançado em 13 de maio de 2024
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Use o mais recente modelo do Anthropic: claude-3-7-sonnet-20250219 que foi lançado em 24 de fevereiro de 2025
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

// Mover FURNITURE_KEYWORDS para cá ou para um arquivo compartilhado se for usado em mais lugares.
// Por enquanto, duplicando para simplificar, mas idealmente seria compartilhado.
const FURNITURE_KEYWORDS = [
    'sofa', 'cadeira', 'poltrona', 'mesa', 'banco', 'banqueta', 'puff', 
    'buffet', 'aparador', 'rack', 'estante', 'cama', 'colchao', 
    'cabeceira', 'escrivaninha', 'criado', 'mudo', 'comoda', 'armario', 'roupeiro', 'espelho' 
];

/**
 * Interface para armazenar resultados da análise de imagem
 */
interface ImageAnalysisResult {
  detectedFurniture: {
    name: string;
    description: string;
    position: string; // ex: "centro da sala", "canto superior esquerdo"
    dimensions?: {
      width?: number;
      height?: number;
      depth?: number;
    };
    style?: string;
    colors?: string[];
    materials?: string[];
  }[];
  roomType: string; // ex: "sala de estar", "quarto", "cozinha"
  roomDimensions?: {
    width?: number;
    height?: number;
    area?: number;
  };
  generalObservations: string;
}

// Esta é a função findSuggestionsForItem que prioriza o visual e tenta usar SAM.
async function findSuggestionsForItem(
    item: DesignProjectItem, 
    userId: number, 
    imageUrlToProcess: string, // Imagem original do projeto/chat 
    segmentationMaskUrl?: string | null // URL da máscara de segmentação (do SAM), se disponível
): Promise<{product: Product, source: string, matchScore: number, visualSimilarity?: number, textSimilarity?: number, combinedScore?: number}[]> {
    console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Iniciando para item: "${item.detectedObjectName || 'sem nome'}", Mask URL: ${segmentationMaskUrl ? segmentationMaskUrl.substring(0,60)+"..." : "Nenhuma"}`);

    const detectedText = (`${item.detectedObjectName || ''} ${item.detectedObjectDescription || ''}`).trim();
    if (!detectedText && !item.detectedObjectBoundingBox) {
        console.log("[findSuggestionsForItem V3.1-SAM_CLIP] Texto detectado e BBox estão vazios. Retornando nenhuma sugestão.");
        return [];
    }

    let textualSearchResults: (Product & { relevance?: number })[] = [];
    if (detectedText) {
        try {
            textualSearchResults = await storage.searchProducts(userId, detectedText);
            // Filtrar produtos sem imagem JÁ AQUI para FTS
            textualSearchResults = textualSearchResults.filter(p => p.imageUrl);
            console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] FTS encontrou ${textualSearchResults.length} resultados (com imagem) para "${detectedText}".`);
        } catch (error) { console.error("[findSuggestionsForItem V3.1-SAM_CLIP] Erro FTS:", error); }
    } else {
        console.log("[findSuggestionsForItem V3.1-SAM_CLIP] Texto detectado vazio, pulando FTS.");
    }

    let targetRoiClipEmbedding: number[] | null = null;
    let roiExtractionMethod = "none";
    let originalImageBuffer: Buffer | null = null;
    let imageMetadata: sharp.Metadata | null = null;

    if (imageUrlToProcess) {
        try {
            originalImageBuffer = await fetchImageAsBuffer(imageUrlToProcess);
            imageMetadata = await sharp(originalImageBuffer).metadata();
        } catch (e) {
            console.error(`[findSuggestionsForItem V3.1-SAM_CLIP] Erro ao carregar imagem original ${imageUrlToProcess}:`, e);
            originalImageBuffer = null; 
        }
    }

    if (originalImageBuffer && imageMetadata && imageMetadata.width && imageMetadata.height) {
        if (segmentationMaskUrl) {
            try {
                console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Tentando usar MÁSCARA SAM para ROI: "${item.detectedObjectName || 'sem nome'}"`);
                const maskImageBuffer = await fetchImageAsBuffer(segmentationMaskUrl);
                
                const maskedRoiBuffer = await sharp(originalImageBuffer)
                    .composite([{ input: maskImageBuffer, blend: 'in' }]) 
                    .png()
                    .toBuffer();
                
                const pixelBbox = await calculatePixelBbox(item.detectedObjectBoundingBox, imageMetadata.width, imageMetadata.height);
                if (pixelBbox && pixelBbox.w > 0 && pixelBbox.h > 0) {
                    targetRoiClipEmbedding = await getClipEmbeddingFromImageBuffer( // Assumindo que esta função existe no clip-service
                        maskedRoiBuffer, 
                        pixelBbox.w, 
                        pixelBbox.h,
                        `roi_sam_${item.id}_${item.detectedObjectName || 'sem_nome'}`
                    );
                    if (targetRoiClipEmbedding) {
                        console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Embedding CLIP da ROI MASCARADA (SAM) gerado.`);
                        roiExtractionMethod = "sam_mask";
                    } else {
                        console.warn(`[findSuggestionsForItem V3.1-SAM_CLIP] Falha ao gerar embedding CLIP da ROI MASCARADA (SAM).`);
                    }
                } else {
                     console.warn(`[findSuggestionsForItem V3.1-SAM_CLIP] BBox inválida para item ao tentar usar máscara SAM.`);
                }
            } catch (samProcessingError) {
                console.error(`[findSuggestionsForItem V3.1-SAM_CLIP] Erro ao processar ROI com MÁSCARA SAM:`, samProcessingError);
            }
        }

        if (!targetRoiClipEmbedding && item.detectedObjectBoundingBox) {
            try {
                console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Usando FALLBACK para BBOX para ROI: "${item.detectedObjectName || 'sem nome'}"`);
                const pixelBbox = await calculatePixelBbox(item.detectedObjectBoundingBox, imageMetadata.width, imageMetadata.height);
                if (pixelBbox && pixelBbox.w > 0 && pixelBbox.h > 0) {
                    const roiBuffer = await sharp(originalImageBuffer)
                        .extract({ left: pixelBbox.x, top: pixelBbox.y, width: pixelBbox.w, height: pixelBbox.h })
                        .png()
                        .toBuffer();
                    targetRoiClipEmbedding = await getClipEmbeddingFromImageBuffer( // Assumindo que esta função existe no clip-service
                        roiBuffer, pixelBbox.w, pixelBbox.h, `roi_bbox_${item.id}_${item.detectedObjectName || 'sem_nome'}`
                    );
                    if (targetRoiClipEmbedding) {
                        console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Embedding CLIP da ROI por BBOX (fallback) gerado.`);
                        roiExtractionMethod = "bbox_fallback";
                    } else {
                        console.warn(`[findSuggestionsForItem V3.1-SAM_CLIP] Falha ao gerar embedding CLIP da ROI por BBOX (fallback).`);
                    }
                } else {
                    console.warn(`[findSuggestionsForItem V3.1-SAM_CLIP] BBox inválida ou com dimensões zero (fallback).`);
                }
            } catch (bboxError) {
                console.error(`[findSuggestionsForItem V3.1-SAM_CLIP] Erro ao processar ROI por BBOX (fallback):`, bboxError);
            }
        }
    } else if (imageUrlToProcess) {
        console.warn(`[findSuggestionsForItem V3.1-SAM_CLIP] Não foi possível carregar imagem original ou seus metadados. Pulando toda a extração de ROI CLIP.`);
    }
    
    const combinedSuggestions: Map<number, {product: Product, textScore: number, visualScore: number, sourceDetails: string[]}> = new Map();
    const maxFtsRelevance = textualSearchResults.reduce((max, p) => Math.max(max, p.relevance || 0), 0);
    
    for (const product of textualSearchResults) { // textualSearchResults já filtrado por imageUrl
        let ftsScore = 0;
        if (maxFtsRelevance > 0) ftsScore = (product.relevance || 0) / maxFtsRelevance;
        ftsScore = Math.max(0, Math.min(ftsScore, 1));
        if (ftsScore > 0.01) { // Limiar FTS
            combinedSuggestions.set(product.id, { product, textScore: ftsScore, visualScore: 0, sourceDetails: ['text_fts'] });
        }
    }

    if (targetRoiClipEmbedding) {
        console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Buscando produtos no DB com clipEmbedding para similaridade visual (ROI extraída via: ${roiExtractionMethod}).`);
        let visuallySimilarProductsDb: (Product & { distance?: number })[] = [];
        try {
            const embeddingStringForDb = `[${targetRoiClipEmbedding.join(',')}]`;
            // Certifique-se que 'db' e 'products' e 'sql' estão corretamente importados e disponíveis.
            // Presume-se que db seja uma instância do Drizzle e products o schema da tabela.
            // import { db, products, sql, and, isNotNull } from \'./db\'; // Ou de onde vierem
            visuallySimilarProductsDb = await db
                .select({
                    id: products.id, userId: products.userId, catalogId: products.catalogId, name: products.name,
                    code: products.code, description: products.description, price: products.price, category: products.category,
                    manufacturer: products.manufacturer, imageUrl: products.imageUrl, colors: products.colors, materials: products.materials,
                    sizes: products.sizes, location: products.location, stock: products.stock, excelRowNumber: products.excelRowNumber,
                    embedding: products.embedding, clipEmbedding: products.clipEmbedding, search_tsv: products.search_tsv, // Colunas do schema Product
                    createdAt: products.createdAt, firestoreId: products.firestoreId, firebaseUserId: products.firebaseUserId, isEdited: products.isEdited, // Mais colunas
                    distance: sql<number>`${products.clipEmbedding} <-> ${embeddingStringForDb}`.mapWith(Number)
                })
                .from(products)
                .where(and(isNotNull(products.clipEmbedding), isNotNull(products.imageUrl))) // Apenas com clipEmbedding e imagem
                .orderBy(sql`${products.clipEmbedding} <-> ${embeddingStringForDb}`)
                .limit(40); 

            console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Busca vetorial CLIP no DB retornou ${visuallySimilarProductsDb.length} produtos.`);

        } catch (dbVectorError) {
            console.error("[findSuggestionsForItem V3.1-SAM_CLIP] Erro na busca vetorial CLIP no DB:", dbVectorError);
        }
        
        const visualClipThreshold = 0.135; 

        for (const product of visuallySimilarProductsDb) {
            let currentVisualClipScore = 0;
            if (typeof product.distance === 'number') {
                // console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Produto ID ${product.id} ("${product.name}") - Distância L2 do DB: ${product.distance.toFixed(4)}`);
                currentVisualClipScore = 1 / (1 + product.distance); 
                currentVisualClipScore = Math.max(0, Math.min(currentVisualClipScore, 1));
                // console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Produto ID ${product.id} - Score Visual CLIP Calculado: ${currentVisualClipScore.toFixed(4)}`);
            }

            if (currentVisualClipScore >= visualClipThreshold) { // Usar >= para incluir o limiar
                const existing = combinedSuggestions.get(product.id);
                if (existing) {
                    existing.visualScore = Math.max(existing.visualScore, currentVisualClipScore);
                    if (!existing.sourceDetails.includes('visual_clip_db')) existing.sourceDetails.push('visual_clip_db');
                } else {
                    combinedSuggestions.set(product.id, { product, textScore: 0, visualScore: currentVisualClipScore, sourceDetails: ['visual_clip_db'] });
                }
            }
        }
    }
    
    let processedSuggestions = Array.from(combinedSuggestions.values()).map(sugg => {
        const textWeight = 0.01; 
        const visualWeight = 0.99; 
        
        let combinedScore = 0;
        if (sugg.visualScore > 0 && sugg.textScore > 0) {
            combinedScore = (sugg.textScore * textWeight) + (sugg.visualScore * visualWeight);
        } else if (sugg.visualScore > 0) {
            combinedScore = sugg.visualScore * visualWeight; // Aplicar peso mesmo se for só visual
        } else if (sugg.textScore > 0) { 
            combinedScore = sugg.textScore * textWeight; // Aplicar peso mesmo se for só textual
        }
        
        return {
            product: sugg.product,
            source: sugg.sourceDetails.join('+') || 'none',
            matchScore: combinedScore,
            textSimilarity: sugg.textScore, 
            visualSimilarity: sugg.visualScore, 
            combinedScore: combinedScore 
        };
    });
    
    // Filtrar sugestões com score combinado muito baixo (considerando os novos pesos)
    processedSuggestions = processedSuggestions.filter(s => s.combinedScore > 0.10); 

    processedSuggestions.sort((a, b) => b.combinedScore - a.combinedScore);

    console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Sugestões ANTES do filtro de categoria para "${item.detectedObjectName || 'sem nome'}": ${processedSuggestions.length}`);
    processedSuggestions.slice(0, 10).forEach(s_log => { 
        console.log(`  -> PRE-FILTER V3.1: ID: ${s_log.product.id}, Cat: ${s_log.product.category}, Nome: ${s_log.product.name.substring(0,30)}, Score: ${s_log.combinedScore.toFixed(4)} (T_FTS: ${s_log.textSimilarity?.toFixed(4)}, V_CLIP: ${s_log.visualSimilarity?.toFixed(4)}) Src: ${s_log.source}`);
    });

    const itemDetectedObjectNameNormalized = normalizeText(item.detectedObjectName);
    const categoryFilteredSuggestions = processedSuggestions.filter(sugg => {
        if (!sugg.product.imageUrl) { // Dupla checagem, mas importante.
             console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Filtrando: Produto \"${sugg.product.name}\" (ID: ${sugg.product.id}) sem imagem -> REJEITADO`);
            return false;
        }

        if (!item.detectedObjectName) return true; 
        
        if (!sugg.product.category || sugg.product.category.trim() === '') {
            console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Filtrando: Produto \"${sugg.product.name}\" (ID: ${sugg.product.id}) categoria NULA -> REJEITADO para \"${itemDetectedObjectNameNormalized}\"`);
            return false;
        }
        const productCategoryNormalized = normalizeText(sugg.product.category);

        if (itemDetectedObjectNameNormalized === productCategoryNormalized) return true;

        const mappings: Record<string, string[]> = {
            'sofa': ['sofa', 'estofado'], 
            'poltrona': ['poltrona', 'cadeira', 'cadeira de jantar'],
            'cadeira': ['cadeira', 'cadeira de jantar', 'poltrona', 'banqueta', 'banco'],
            'cadeira de jantar': ['cadeira de jantar', 'cadeira'],
            'mesa': ['mesa', 'mesa de centro', 'mesa lateral', 'mesa de apoio', 'mesa de jantar', 'escrivaninha'],
            'mesa de jantar': ['mesa de jantar', 'mesa'],
            'mesa de centro': ['mesa de centro', 'mesa'],
            'mesa lateral': ['mesa lateral', 'mesa de apoio', 'mesa'],
            'mesa de apoio': ['mesa de apoio', 'mesa lateral', 'mesa'], 
            'rack': ['rack', 'movel para tv', 'móvel para tv'],
            'estante': ['estante', 'livreiro'], 
            'luminaria': ['luminaria', 'luminaria de chao', 'luminaria de mesa', 'abajur'],
            'luminaria de chao': ['luminaria de chao', 'luminaria'], 
            'armario': ['armario', 'roupeiro', 'guarda-roupa'],
            'buffet': ['buffet', 'aparador', 'balcao'], 
            'aparador': ['aparador', 'buffet', 'console', 'balcao']
        };

        if (mappings[itemDetectedObjectNameNormalized] && mappings[itemDetectedObjectNameNormalized].includes(productCategoryNormalized)) {
            return true;
        }
        if (mappings[productCategoryNormalized] && mappings[productCategoryNormalized].includes(itemDetectedObjectNameNormalized)) {
            return true;
        }
        
        // Fallback mais permissivo (usar com cautela)
        // if (productCategoryNormalized.includes(itemDetectedObjectNameNormalized)) return true;
        // if (itemDetectedObjectNameNormalized.includes(productCategoryNormalized)) return true; 

        console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Filtrando por categoria: Item \"${itemDetectedObjectNameNormalized}\" vs ProdCat \"${productCategoryNormalized}\" -> REJEITADO`);
        return false;
    });

    console.log(`[findSuggestionsForItem V3.1-SAM_CLIP] Top sugestões PÓS-FILTRO de categoria para \"${item.detectedObjectName || 'sem nome'}\": ${categoryFilteredSuggestions.length}`);
    categoryFilteredSuggestions.slice(0, 5).forEach(s_log => { 
        console.log(`  - V3.1 FINAL: ID: ${s_log.product.id}, Cat: ${s_log.product.category}, Nome: ${s_log.product.name.substring(0,30)}, Score Final: ${s_log.combinedScore.toFixed(4)}, T_FTS: ${s_log.textSimilarity?.toFixed(4)}, V_CLIP: ${s_log.visualSimilarity?.toFixed(4)}, Source: ${s_log.source}`);
    });

    return categoryFilteredSuggestions.slice(0, 5);
}

// Ajustar formatSuggestionsForChatItem para usar os scores corretos e garantir que product exista
interface SuggestionForChat {
    product: Product; // product é obrigatório aqui após a filtragem interna
    matchScore: number;
    source: string;
    combinedScore: number;
    textSimilarity?: number;
    visualSimilarity?: number;
}

function formatSuggestionsForChatItem(item: DesignProjectItem, suggestions: SuggestionForChat[]): string {
    if (!item.detectedObjectName) {
        console.warn("[formatSuggestions V3.2] Item sem detectedObjectName, retornando string vazia.");
        return '';
    }
    // Não precisa mais de validSuggestions.filter aqui se o tipo de entrada já for o correto.
    if (!suggestions || suggestions.length === 0) {
      return `  - **${item.detectedObjectName}** (Original: *${item.detectedObjectDescription || 'N/A'}*): Nenhuma sugestão encontrada com os critérios atuais.\\n`;
    }
    let response = `  - **${item.detectedObjectName}** (Original: *${item.detectedObjectDescription || 'N/A'}*):\\n`;
    
    suggestions.slice(0, 3).forEach((sugg, index) => {
        // Agora 'sugg.product' e 'sugg.combinedScore' são garantidos pelo tipo SuggestionForChat
        response += `    ${index + 1}. **${sugg.product.name}** (Relevância: ${(sugg.combinedScore * 100).toFixed(0)}%, Cat: ${sugg.product.category || 'N/A'})\\n`;
        if (sugg.product.imageUrl) {
            response += `       ![Produto](${sugg.product.imageUrl}?w=100&h=100)\\n`;
        }
        response += `       (Detalhes: Cód: ${sugg.product.code || 'N/A'}, Preço: R$ ${sugg.product.price ? (sugg.product.price / 100).toFixed(2) : 'N/A' })\\n`;
    });
    return response;
}

/**
 * Analisa uma imagem de planta baixa para identificar cômodos e móveis
 * @param imageUrl URL da imagem da planta baixa
 * @returns Resultado da análise
 */
export async function analyzeFloorPlanImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Obter imagem como base64
    const imageBuffer = await fetchImageAsBuffer(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    
    // Analisar imagem com GPT-4o
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Você é um assistente especializado em análise de plantas baixas. Analise a planta baixa fornecida 
          e identifique todos os cômodos e móveis presentes. Para cada móvel, forneça uma descrição detalhada, 
          dimensões aproximadas, estilo e posição no ambiente.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analise esta planta baixa e identifique todos os cômodos e móveis. Forneça o resultado em JSON com a seguinte estrutura: { detectedFurniture: [{ name: string, description: string, position: string, dimensions?: {width?: number, height?: number, depth?: number}, style?: string, colors?: string[], materials?: string[] }], roomType: string, roomDimensions?: {width?: number, height?: number, area?: number}, generalObservations: string }"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    const messageContent = response.choices[0]?.message?.content;
    if (!messageContent) {
        throw new Error("OpenAI response content is null.");
    }
    const result = JSON.parse(messageContent);
    return result as ImageAnalysisResult;
  } catch (error) {
    console.error("Erro ao analisar planta baixa com OpenAI:", error);
    return analyzeFloorPlanImageWithClaude(imageUrl);
  }
}

/**
 * Analisa uma imagem de render para identificar móveis e características do ambiente
 * @param imageUrl URL da imagem do render
 * @returns Resultado da análise
 */
export async function analyzeRenderImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Obter imagem como base64
    const imageBuffer = await fetchImageAsBuffer(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    
    // Analisar imagem com GPT-4o
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Você é um assistente especializado em análise de renders de ambientes internos.
          Analise o render fornecido e identifique todos os móveis e elementos presentes. Para cada móvel,
          forneça uma descrição detalhada, dimensões aproximadas, estilo, cores, materiais e posição no ambiente.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analise este render e identifique todos os móveis e elementos decorativos. Forneça o resultado em JSON com a seguinte estrutura: { detectedFurniture: [{ name: string, description: string, position: string, dimensions?: {width?: number, height?: number, depth?: number}, style?: string, colors?: string[], materials?: string[] }], roomType: string, roomDimensions?: {width?: number, height?: number, area?: number}, generalObservations: string }"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    const messageContent = response.choices[0]?.message?.content;
    if (!messageContent) {
        throw new Error("OpenAI response content is null.");
    }
    const result = JSON.parse(messageContent);
    return result as ImageAnalysisResult;
  } catch (error) {
    console.error("Erro ao analisar render com OpenAI:", error);
    return analyzeRenderImageWithClaude(imageUrl);
  }
}

/**
 * Fallback para análise de planta baixa usando Claude
 */
async function analyzeFloorPlanImageWithClaude(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Obter imagem como base64
    const imageBuffer = await fetchImageAsBuffer(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 2000,
      system: `Você é um assistente especializado em análise de plantas baixas. Analise a planta baixa fornecida 
      e identifique todos os cômodos e móveis presentes. Para cada móvel, forneça uma descrição detalhada, 
      dimensões aproximadas, estilo e posição no ambiente. Responda sempre em formato JSON.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analise esta planta baixa e identifique todos os cômodos e móveis. Forneça o resultado em JSON com a seguinte estrutura: { detectedFurniture: [{ name: string, description: string, position: string, dimensions?: {width?: number, height?: number, depth?: number}, style?: string, colors?: string[], materials?: string[] }], roomType: string, roomDimensions?: {width?: number, height?: number, area?: number}, generalObservations: string }"
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    let textContent = '';
    if (response.content && response.content[0] && response.content[0].type === 'text') {
      textContent = response.content[0].text;
    }
    
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    
    if (jsonMatch && jsonMatch[0]) {
       try {
         const result = JSON.parse(jsonMatch[0]);
         return result as ImageAnalysisResult;
       } catch (parseError) {
         console.error("Erro ao parsear JSON do Claude (FloorPlan):", parseError, "Conteúdo:", textContent);
       }
    }
    console.warn("Não foi possível extrair JSON da resposta do Claude (FloorPlan).");
    return {
      detectedFurniture: [],
      roomType: "Não identificado",
      generalObservations: "Não foi possível analisar a planta baixa."
    };
  } catch (error) {
    console.error("Erro no fallback para análise de planta baixa com Claude:", error);
    return {
      detectedFurniture: [],
      roomType: "Não identificado",
      generalObservations: "Não foi possível analisar a planta baixa."
    };
  }
}

/**
 * Fallback para análise de render usando Claude
 */
async function analyzeRenderImageWithClaude(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Obter imagem como base64
    const imageBuffer = await fetchImageAsBuffer(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 2000,
      system: `Você é um assistente especializado em análise de renders de ambientes internos.
      Analise o render fornecido e identifique todos os móveis e elementos presentes. Para cada móvel,
      forneça uma descrição detalhada, dimensões aproximadas, estilo, cores, materiais e posição no ambiente.
      Responda sempre em formato JSON.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analise este render e identifique todos os móveis e elementos decorativos. Forneça o resultado em JSON com a seguinte estrutura: { detectedFurniture: [{ name: string, description: string, position: string, dimensions?: {width?: number, height?: number, depth?: number}, style?: string, colors?: string[], materials?: string[] }], roomType: string, roomDimensions?: {width?: number, height?: number, area?: number}, generalObservations: string }"
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    let textContent = '';
    if (response.content && response.content[0] && response.content[0].type === 'text') {
      textContent = response.content[0].text;
    }

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    
    if (jsonMatch && jsonMatch[0]) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return result as ImageAnalysisResult;
      } catch (parseError) {
         console.error("Erro ao parsear JSON do Claude (Render):", parseError, "Conteúdo:", textContent);
      }
    }
    console.warn("Não foi possível extrair JSON da resposta do Claude (Render).");
    return {
      detectedFurniture: [],
      roomType: "Não identificado",
      generalObservations: "Não foi possível analisar o render."
    };
  } catch (error) {
    console.error("Erro no fallback para análise de render com Claude:", error);
    return {
      detectedFurniture: [],
      roomType: "Não identificado",
      generalObservations: "Não foi possível analisar o render."
    };
  }
}

/**
 * Encontra produtos similares no catálogo da empresa
 * @param detectedFurniture Móveis detectados na análise
 * @param userId ID do usuário para buscar seus produtos
 * @returns Lista de produtos similares
 */
export async function findSimilarProducts(detectedFurniture: ImageAnalysisResult['detectedFurniture'], userId: number) {
  const allProducts = await storage.getProductsByUserId(userId);
  const similarProducts = [];
  
  for (const furniture of detectedFurniture) {
    // Filtrar produtos por categoria ou nome similar
    const relevantProducts = allProducts.filter(product => {
      const category = product.category?.toLowerCase() || '';
      const productName = product.name.toLowerCase();
      const furnitureName = furniture.name.toLowerCase();
      
      return category.includes(furnitureName) || 
             productName.includes(furnitureName) ||
             furnitureName.includes(category) ||
             productName.includes(furnitureName);
    });
    
    if (relevantProducts.length > 0) {
      // Adicionar até 3 produtos similares
      similarProducts.push({
        detectedFurniture: furniture,
        similarProducts: relevantProducts.slice(0, 3)
      });
    }
  }
  
  return similarProducts;
}

/**
 * Gera uma resposta baseada na análise das imagens e produtos similares
 * @param floorPlanAnalysis Resultado da análise da planta baixa
 * @param renderAnalysis Resultado da análise do render
 * @param similarProducts Produtos similares encontrados
 * @returns Texto da resposta
 */
export async function generateAiResponse(
  floorPlanAnalysis: ImageAnalysisResult,
  renderAnalysis: ImageAnalysisResult,
  similarProducts: any[]
): Promise<string> {
  try {
    // Criar prompt com todas as informações
    const prompt = `
      Análise da planta baixa: ${JSON.stringify(floorPlanAnalysis)}
      
      Análise do render: ${JSON.stringify(renderAnalysis)}
      
      Produtos similares encontrados: ${JSON.stringify(similarProducts)}
      
      Com base nas análises acima, crie uma resposta detalhada explicando:
      1. O tipo de ambiente identificado
      2. Os móveis detectados no ambiente
      3. As sugestões de produtos do catálogo para substituir os móveis fictícios
      4. Recomendações de design e organização do espaço
      
      Seja cordial, profissional e detalhado. Explique porque cada produto sugerido é adequado para substituir o móvel fictício.
    `;
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é um assistente especializado em design de interiores e mobiliário. Sua função é analisar plantas baixas e renders, e sugerir produtos reais do catálogo para substituir móveis fictícios."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,
    });
    
    return response.choices[0].message.content || "Não foi possível gerar uma resposta.";
  } catch (error) {
    console.error("Erro ao gerar resposta:", error);
    return "Não foi possível gerar uma resposta devido a um erro no processamento. Por favor, tente novamente.";
  }
}

/**
 * Processa um projeto completo, analisando imagens e gerando resposta
 * ATUALIZADO para usar o tipo DesignProject e seus campos corretos.
 * @param projectId ID do projeto a ser processado
 */
export async function processAiDesignProject(projectId: number): Promise<DesignProject | null> {
  try {
    const project = await storage.getDesignProject(projectId);
    if (!project) {
      console.error(`Projeto ID ${projectId} não encontrado`);
      return null;
    }
    
    await storage.updateDesignProject(projectId, { status: "processing", updatedAt: new Date() });
    
    if (!project.clientFloorPlanImageUrl || !project.clientRenderImageUrl) {
      const errorMessage = "Projeto incompleto: necessário fornecer uma planta baixa e um render";
      await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: errorMessage });
      await storage.updateDesignProject(projectId, { status: "error", updatedAt: new Date() });
      return project;
    }
    
    const floorPlanAnalysis = await analyzeFloorPlanImage(project.clientFloorPlanImageUrl);
    const renderAnalysis = await analyzeRenderImage(project.clientRenderImageUrl);
    
    const similarProducts = await findSimilarProducts(renderAnalysis.detectedFurniture, project.userId);
    const response = await generateAiResponse(floorPlanAnalysis, renderAnalysis, similarProducts);
    await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: response });
    const updatedProject = await storage.updateDesignProject(projectId, { status: "completed", updatedAt: new Date() });
    
    if (!updatedProject) { throw new Error(`Não foi possível atualizar o projeto ${projectId}`); }
    return updatedProject;
  } catch (error) {
    console.error(`Erro ao processar projeto ${projectId}:`, error);
    try {
       await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: "Ocorreu um erro ao processar seu projeto. Nossa equipe foi notificada e estamos trabalhando para resolver o problema." });
       await storage.updateDesignProject(projectId, { status: "error", updatedAt: new Date() });
    } catch (updateErr) { console.error("Erro ao atualizar status para falha:", updateErr); }
    return null;
  }
}

/**
 * Função utilitária para buscar uma imagem e converter em buffer
 */
async function fetchImageAsBuffer(imageUrl: string): Promise<Buffer> {
  // Se a imagem for local (começa com /)
  if (imageUrl.startsWith('/')) {
    const localPath = path.join(process.cwd(), imageUrl);
    return fs.promises.readFile(localPath);
  }
  
  // Se for uma URL externa
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Função auxiliar para calcular BBox em pixels (adaptada de performSingleInpaintingStep)
async function calculatePixelBbox(bboxInput: any, baseImageWidth: number, baseImageHeight: number): Promise<{ x: number, y: number, w: number, h: number } | null> {
  let rectX: number, rectY: number, rectWidth: number, rectHeight: number;
  if (!bboxInput) return null;

  const isPercent = bboxInput.x_min !== undefined && bboxInput.x_max !== undefined && 
                    bboxInput.y_min !== undefined && bboxInput.y_max !== undefined &&
                    (Math.max(bboxInput.x_min, bboxInput.y_min, bboxInput.x_max, bboxInput.y_max) <= 1.5 &&
                     Math.min(bboxInput.x_min, bboxInput.y_min, bboxInput.x_max, bboxInput.y_max) >= 0);

  if (isPercent) { 
      rectX = Math.round(bboxInput.x_min * baseImageWidth);
      rectY = Math.round(bboxInput.y_min * baseImageHeight);
      rectWidth = Math.round((bboxInput.x_max - bboxInput.x_min) * baseImageWidth);
      rectHeight = Math.round((bboxInput.y_max - bboxInput.y_min) * baseImageHeight);
  } else if (bboxInput.x_min !== undefined && bboxInput.x_max !== undefined && bboxInput.y_min !== undefined && bboxInput.y_max !== undefined) { 
      rectX = Math.round(bboxInput.x_min);
      rectY = Math.round(bboxInput.y_min);
      rectWidth = Math.round(bboxInput.x_max - bboxInput.x_min);
      rectHeight = Math.round(bboxInput.y_max - bboxInput.y_min);
  } else if (bboxInput.x !== undefined && bboxInput.y !== undefined && bboxInput.width !== undefined && bboxInput.height !== undefined) { 
      rectX = Math.round(bboxInput.x);
      rectY = Math.round(bboxInput.y);
      rectWidth = Math.round(bboxInput.width);
      rectHeight = Math.round(bboxInput.height);
  } else {
      console.warn(`[BBox Calc] Formato de bounding box não reconhecido para item: ${JSON.stringify(bboxInput)}`);
      return null;
  }
  rectX = Math.max(0, rectX);
  rectY = Math.max(0, rectY);
  rectWidth = Math.max(1, Math.min(rectWidth, baseImageWidth - rectX)); 
  rectHeight = Math.max(1, Math.min(rectHeight, baseImageHeight - rectY));

  if (rectWidth <= 0 || rectHeight <= 0) {
      console.warn(`[BBox Calc] Bounding box resultou em dimensões inválidas: w=${rectWidth}, h=${rectHeight}`);
      return null;
  }
  return { x: rectX, y: rectY, w: rectWidth, h: rectHeight };
}

/**
 * Analisa UMA imagem específica (seja um render do projeto ou um anexo de chat),
 * identifica móveis, busca produtos similares no catálogo e salva os resultados como DesignProjectItems.
 * ATENÇÃO: Esta função agora recebe a URL da imagem e o texto da mensagem do usuário (opcional).
 */
export async function processDesignProjectImage(projectId: number, imageUrlToProcess: string, userMessageText?: string): Promise<void> {
  console.log(`[AI Design Processor] Iniciando processamento para projeto ${projectId}, imagem: ${imageUrlToProcess}, mensagem: "${userMessageText}"`);
  
  const initialUserMessageForChat = userMessageText ? 
    `Analisando a imagem que você enviou com a mensagem: "${userMessageText}"...` :
    `Analisando a imagem que você enviou...`;
  
  await storage.createAiDesignChatMessage({
    projectId,
    role: 'assistant',
    content: initialUserMessageForChat,
  });
  broadcastToProject(projectId.toString(), { type: 'ai_processing_started' });

  let detectedObjects: { name: string; description: string; bbox: any; originalName?: string; embedding?: number[] }[] = [];
  let visionAnalysisFailed = false;
  let project: DesignProject | undefined | null = null; 

  try {
    project = await storage.getDesignProject(projectId); 
    if (!project) {
      console.error(`[AI Design Processor] Projeto ${projectId} não encontrado.`);
      await storage.createAiDesignChatMessage({
        projectId,
        role: 'assistant',
        content: `Erro: Não consegui encontrar os detalhes do projeto (ID: ${projectId}). Por favor, tente novamente ou contate o suporte.`,
      });
      broadcastToProject(projectId.toString(), { type: 'ai_processing_error', error: 'Project not found' });
      return; 
    }

    if (imageUrlToProcess === project.clientRenderImageUrl) {
        await storage.updateDesignProject(projectId, { status: 'processing', updatedAt: new Date() });
        console.log(`[AI Design Processor] Status do projeto ${projectId} (imagem principal) atualizado para processing.`);
    }

    console.log(`[AI Design Processor] Enviando imagem para análise de visão GPT-4o...`);
    let visionResponse;
    let visionContent: string | null | undefined = null;

    try {
      visionResponse = await openai.chat.completions.create({
      model: "gpt-4o", 
      messages: [
          {
            role: "system",
            content: `Você é um especialista em design de interiores com formação avançada (nível doutorado) e ampla experiência na análise de renders de ambientes. Sua tarefa é analisar a imagem fornecida e identificar APENAS OS MÓVEIS PRINCIPAIS presentes no ambiente (excluindo itens decorativos, plantas, cortinas, objetos pequenos e estruturas fixas).\n\nPara CADA MÓVEL INDIVIDUALMENTE IDENTIFICADO (liste cada instância separadamente, mesmo que sejam do mesmo tipo, como múltiplas cadeiras idênticas), responda com:\n\n1.  **NOME DO MÓVEL:** Forneça o nome mais preciso e técnico possível (ex: "Cadeira de jantar Estilo Eames", "Sofá Chesterfield 3 lugares", "Mesa lateral redonda tripé").\n    *   **CADEIRA vs. POLTRONA:**\n        *   **Poltrona:** Estofada, com braços, aspecto robusto, geralmente voltada ao conforto.\n        *   **Cadeira de jantar:** Usada com mesa de jantar. Pode ser estofada, mas mais leve.\n        *   **Cadeira de escritório:** Com rodízios e ajuste de altura.\n        *   **Cadeira (genérica):** Assento simples individual, sem características claras das anteriores.\n        *   ⚠️ **Nunca confunda** uma poltrona com uma cadeira estofada leve.\n    *   Use nomes técnicos como: "mesa lateral", "rack baixo", "estante alta", "banco", "banqueta", "mesa de cabeceira", "sofá modular", etc.\n\n2.  **DESCRIÇÃO CURTA:** Máximo 20 palavras, descrevendo estilo, cor principal, material predominante e uma característica marcante.\n    *   Exemplo:\n        *   "Sofá de 3 lugares, veludo verde-escuro, encosto baixo, pés dourados, estilo moderno."\n        *   "Mesa lateral redonda, madeira clara, estilo escandinavo, base de três pés."\n\n3.  **BOUNDING BOX (bbox):** Forneça as coordenadas da bounding box para CADA móvel, em formato JSON: { "x_min": %, "y_min": %, "x_max": %, "y_max": % } (valores de 0.0 a 1.0 relativos à dimensão da imagem). **A BBOX DEVE SER PRECISA E ENVOLVER COMPLETAMENTE APENAS O MÓVEL VISÍVEL, sem ser excessivamente pequena nem incluir muitos elementos ao redor. Certifique-se que a BBox cubra a maior parte do objeto.**\n\nRESPONDA SEMPRE em formato JSON válido. O JSON deve ser um objeto contendo uma chave "furniture" que é um array de objetos. Cada objeto representa um móvel. Se NENHUM MÓVEL for identificável, retorne { "furniture": [] }. Evite frases como "não foram encontrados móveis", apenas retorne o JSON especificado.`
          },
        {
          role: "user",
          content: [
            {
              type: "text",
                text: `Analise a imagem e identifique os móveis conforme as instruções. Mensagem do usuário (pode estar vazia): "${userMessageText || ''}"`
            },
            {
              type: "image_url",
                image_url: {
                  url: imageUrlToProcess,
                }
              }
            ]
          }
        ],
      response_format: { type: "json_object" }, 
        max_tokens: 3000,
      });

      // Log da estrutura da resposta para depuração
      console.log("[AI Design Processor] Resposta bruta da API Vision (choices[0]):", JSON.stringify(visionResponse.choices[0], null, 2));

      visionContent = visionResponse.choices[0]?.message?.content;

    } catch (openaiError: any) {
      console.error("[AI Design Processor] Erro DIRETO na chamada da API OpenAI Vision:", openaiError);
      if (openaiError.response) {
        console.error("[AI Design Processor] OpenAI Error Response Status:", openaiError.response.status);
        console.error("[AI Design Processor] OpenAI Error Response Data:", openaiError.response.data);
      }
      visionAnalysisFailed = true;
    }
    
    if (!visionAnalysisFailed && !visionContent) { // Checa se não falhou na chamada, mas o conteúdo ainda é nulo/vazio
      console.error("[AI Design Processor] Resposta da API Vision bem-sucedida, mas o conteúdo da mensagem está vazio ou nulo.");
      visionAnalysisFailed = true; 
    } else if (!visionAnalysisFailed && visionContent) {
      console.log("[AI Design Processor] Conteúdo da API Vision recebido para parse:", visionContent.substring(0, 500) + "...");
      try {
        const parsedJsonResponse = JSON.parse(visionContent);

        if (Array.isArray(parsedJsonResponse)) {
          detectedObjects = parsedJsonResponse.map((item: any) => ({
              name: item.nome || item.name,
              description: item.descrição || item.description,
              bbox: item.bbox || item.bounding_box,
              originalName: item.nome || item.name 
          }));
          console.log(`[AI Design Processor] ${detectedObjects.length} objetos detectados (formato array).`);
        } else if (typeof parsedJsonResponse === 'object' && parsedJsonResponse !== null && parsedJsonResponse.furniture && Array.isArray(parsedJsonResponse.furniture)) {
          console.log("[AI Design Processor] Detectado formato objeto com chave 'furniture' contendo array.");
          detectedObjects = parsedJsonResponse.furniture.map((item: any) => ({
              name: item.nome || item.name,
              description: item.descrição || item.description,
              bbox: item.bbox || item.bounding_box,
              originalName: item.nome || item.name 
          }));
          console.log(`[AI Design Processor] ${detectedObjects.length} objetos detectados (formato objeto com chave 'furniture').`);
        } else if (typeof parsedJsonResponse === 'object' && parsedJsonResponse !== null && (parsedJsonResponse.nome || parsedJsonResponse.name) && (parsedJsonResponse.bbox || parsedJsonResponse.bounding_box)) {
          console.log("[AI Design Processor] Detectado formato objeto único, envolvendo em array.");
          detectedObjects = [{
              name: parsedJsonResponse.nome || parsedJsonResponse.name,
              description: parsedJsonResponse.descrição || parsedJsonResponse.description,
              bbox: parsedJsonResponse.bbox || parsedJsonResponse.bounding_box,
              originalName: parsedJsonResponse.nome || parsedJsonResponse.name 
          }];
          console.log(`[AI Design Processor] 1 objeto detectado (formato objeto único).`);
        } else if (parsedJsonResponse && parsedJsonResponse.identified_furniture && Array.isArray(parsedJsonResponse.identified_furniture)) {
          console.warn("[AI Design Processor] Tentando parse legado com 'identified_furniture':");
          detectedObjects = parsedJsonResponse.identified_furniture.map((item: any) => ({
              name: item.nome || item.name,
              description: item.descrição || item.description,
              bbox: item.bounding_box || item.bbox, 
              originalName: item.nome || item.name
          }));
          console.log(`[AI Design Processor] ${detectedObjects.length} objetos detectados (formato legado).`);
      } else {
          visionAnalysisFailed = true;
          console.warn("[AI Design Processor] Falha no parse. Formato JSON inesperado. Conteúdo:", visionContent.substring(0,500) + "...");
      }
    } catch (parseError) {
        console.error("[AI Design Processor] Erro CRÍTICO ao parsear JSON da API Vision:", parseError, "Conteúdo:", visionContent.substring(0,500) + "...");
        visionAnalysisFailed = true;
      }
    }

    if (visionAnalysisFailed || detectedObjects.length === 0) {
        if (detectedObjects.length === 0) { 
            console.log("[AI Design Processor] Nenhum objeto detectado pela IA de Visão.");
            await storage.createAiDesignChatMessage({
                projectId,
                role: 'assistant',
                content: "Não consegui identificar móveis principais na imagem fornecida. Você poderia tentar uma imagem diferente ou com os objetos mais em destaque?",
            });
            if (project && imageUrlToProcess === project.clientRenderImageUrl) {
                await storage.updateDesignProject(projectId, { status: 'error_vision', updatedAt: new Date() });
            }
            broadcastToProject(projectId.toString(), { type: 'ai_processing_complete_no_objects' });
            return; 
        }
    }
    
    const createdDesignProjectItems: DesignProjectItem[] = [];
    for (const obj of detectedObjects) {
        // Garantindo que apenas campos válidos de NewDesignProjectItem (conforme schema) são usados.
        const newItemData: NewDesignProjectItem = {
            designProjectId: projectId, 
            detectedObjectName: obj.name,
            detectedObjectDescription: obj.description,
            detectedObjectBoundingBox: obj.bbox, 
            // Os campos 'originalImageUrl' e 'status' foram intencionalmente removidos 
            // pois não existem no schema de NewDesignProjectItem (DesignProjectItemsTable.$inferInsert)
        };
        const createdItem = await storage.createDesignProjectItem(newItemData);
        if (createdItem) {
            createdDesignProjectItems.push(createdItem as DesignProjectItem); 
        }
    }
    console.log(`[AI Design Processor] ${createdDesignProjectItems.length} DesignProjectItems criados para os objetos detectados.`);
    
    let chatResponseContent = "";
    let focusedProcessing = false; 
    let mainKeyword: string | null = null;
    let normalizedMainKeyword: string | null = null;

    if (userMessageText && project) { 
        const keywords = FURNITURE_KEYWORDS;
        const localNormalizedUserMessage = normalizeText(userMessageText);
        for (const kw of keywords) {
            const normalizedKw = normalizeText(kw);
            if (localNormalizedUserMessage.includes(normalizedKw)) {
                mainKeyword = kw; 
                normalizedMainKeyword = normalizedKw;
                console.log(`[AI Design Processor] Keyword de foco detectada: "${mainKeyword}"`);
                break;
            }
        }
    }
    
    if (mainKeyword && normalizedMainKeyword && createdDesignProjectItems.length > 0 && project) {
        const itemsToFocus = createdDesignProjectItems.filter(item => 
            item.detectedObjectName && normalizeText(item.detectedObjectName).includes(normalizedMainKeyword!) 
        );

        if (itemsToFocus.length > 0) {
            focusedProcessing = true;
            chatResponseContent += `Entendido! Focando em sugestões para **${mainKeyword}** que identifiquei na imagem:\n\n`;
            for (const item of itemsToFocus) {
                const suggestions = await findSuggestionsForItem(item, project.userId, imageUrlToProcess);
                
                const updatePayload: Partial<Omit<DesignProjectItem, 'id' | 'designProjectId' | 'createdAt' | 'updatedAt'>> = {};
                if(suggestions.length > 0 && suggestions[0]?.product?.id) {
                    updatePayload.suggestedProductId1 = suggestions[0].product.id;
                    updatePayload.matchScore1 = suggestions[0].matchScore;
                }
                if(suggestions.length > 1 && suggestions[1]?.product?.id) {
                    updatePayload.suggestedProductId2 = suggestions[1].product.id;
                    updatePayload.matchScore2 = suggestions[1].matchScore;
                }
                if(suggestions.length > 2 && suggestions[2]?.product?.id) {
                    updatePayload.suggestedProductId3 = suggestions[2].product.id;
                    updatePayload.matchScore3 = suggestions[2].matchScore;
                }
                if (Object.keys(updatePayload).length > 0) {
                    await storage.updateDesignProjectItem(item.id, updatePayload);
                }
                chatResponseContent += formatSuggestionsForChatItem(item, suggestions.map(s => s.product));
            }
             const otherItems = createdDesignProjectItems.filter(item => !itemsToFocus.some(focusedItem => focusedItem.id === item.id));
             if (otherItems.length > 0) {
                 chatResponseContent += `\nTambém identifiquei outros itens (${otherItems.map(i => i.detectedObjectName).join(', ')}). Se quiser sugestões para eles, me diga!`;
             }
            } else {
             chatResponseContent += `Não encontrei especificamente um "${mainKeyword}" claro na imagem. `;
             focusedProcessing = false; 
        }
    }

    if (!focusedProcessing && project) { 
        if (createdDesignProjectItems.length > 0) {
            chatResponseContent += chatResponseContent.length > 0 ? "\n\n" : ""; 
            chatResponseContent += "Aqui estão os móveis que identifiquei na imagem e algumas sugestões do nosso catálogo:\n\n";
            for (const item of createdDesignProjectItems) {
                const suggestions = await findSuggestionsForItem(item, project.userId, imageUrlToProcess);
                const updatePayload: Partial<Omit<DesignProjectItem, 'id' | 'designProjectId' | 'createdAt' | 'updatedAt'>> = {};
                if(suggestions.length > 0 && suggestions[0]?.product?.id) {
                    updatePayload.suggestedProductId1 = suggestions[0].product.id;
                    updatePayload.matchScore1 = suggestions[0].matchScore;
                }
                if(suggestions.length > 1 && suggestions[1]?.product?.id) {
                    updatePayload.suggestedProductId2 = suggestions[1].product.id;
                    updatePayload.matchScore2 = suggestions[1].matchScore;
                }
                if(suggestions.length > 2 && suggestions[2]?.product?.id) {
                    updatePayload.suggestedProductId3 = suggestions[2].product.id;
                    updatePayload.matchScore3 = suggestions[2].matchScore;
                }
                if (Object.keys(updatePayload).length > 0) {
                    await storage.updateDesignProjectItem(item.id, updatePayload);
                }
                chatResponseContent += formatSuggestionsForChatItem(item, suggestions.map(s => s.product));
            }
        } else if (!visionAnalysisFailed) {  
             chatResponseContent = "Não identifiquei móveis claros nesta imagem. Poderia tentar outra imagem ou descrever o que você procura?";
        }
    }
    
    if (chatResponseContent.trim() !== "") {
        await storage.createAiDesignChatMessage({ projectId, role: 'assistant', content: chatResponseContent });
    } else if (visionAnalysisFailed) { // Somente envia mensagem de falha se nenhuma outra resposta foi construída
         await storage.createAiDesignChatMessage({ projectId, role: 'assistant', content: "Houve uma falha na análise da imagem. Por favor, tente novamente." });
        } else {
        console.log("[AI Design Processor] Nenhuma nova mensagem de chat para enviar.");
    }
    
    if (project && project.clientRenderImageUrl === imageUrlToProcess) {
        const allItems = await storage.getDesignProjectItems(projectId);
        // Inferir status com base nos campos preenchidos, já que não há campo status
        const allProcessed = allItems.every(item => 
            item.selectedProductId || // Se está selecionado, está processado
            (item.suggestedProductId1 && item.userFeedback === 'user_rejected') || // Se tem sugestão e foi rejeitado
            (item.suggestedProductId1 && !item.selectedProductId && !item.userFeedback) // Se tem sugestão, não selecionado, sem feedback (aguardando)
            // Adicione mais condições conforme sua lógica de "processado"
        );
        
        if (allProcessed && allItems.length > 0) {
            await storage.updateDesignProject(projectId, { status: 'suggestions_provided', updatedAt: new Date() });
        } else if (allItems.length === 0 && !visionAnalysisFailed) {
            // Status 'error_vision' já foi setado para o projeto
        }
    }
    
    broadcastToProject(projectId.toString(), { type: 'ai_processing_complete', projectId });
    console.log(`[AI Design Processor] Processamento da imagem para projeto ${projectId} concluído.`);

  } catch (error: any) {
    console.error(`[AI Design Processor] Erro GERAL no processamento do projeto ${projectId} para imagem ${imageUrlToProcess}:`, error);
    let errorMessage = "Ocorreu um erro inesperado ao processar sua imagem. ";
    if (error.message) {
        errorMessage += `Detalhe: ${error.message}`;
    }
    
    try {
      await storage.createAiDesignChatMessage({
            projectId,
            role: 'assistant',
            content: errorMessage,
        });
        
        if (project && project.clientRenderImageUrl === imageUrlToProcess) {
            await storage.updateDesignProject(projectId, { status: 'error', updatedAt: new Date() });
        }
        broadcastToProject(projectId.toString(), { type: 'ai_processing_error', error: error.message || 'Unknown error' });
    } catch (dbError) {
        console.error(`[AI Design Processor] Erro ao registrar erro no chat/projeto ${projectId}:`, dbError);
    }
  }
}

/**
 * Dispara o processo de inpainting para um DesignProjectItem específico
 * se um produto tiver sido selecionado.
 */
export async function triggerInpaintingForItem(itemId: number, projectId: number, originalImageUrl: string): Promise<void> {
  console.log(`[Inpainting Trigger] Iniciando para itemId: ${itemId}, projectId: ${projectId}`);
  try {
    const projectItems = await storage.getDesignProjectItems(projectId);
    const item = projectItems.find(pItem => pItem.id === itemId);

    if (!item) {
      console.error(`[Inpainting Trigger] DesignProjectItem ${itemId} não encontrado no projeto ${projectId}.`);
      return;
    }

    if (item.selectedProductId) {
      const product = await storage.getProduct(item.selectedProductId);
      if (!product || !product.imageUrl) {
        console.error(`[Inpainting Trigger] Produto selecionado ${item.selectedProductId} não encontrado ou não possui imagem (necessária para performSingleInpaintingStep).`);
        return;
      }
      if (!item.detectedObjectBoundingBox) {
        console.error(`[Inpainting Trigger] Bounding box não definida para o item ${item.id}. Não é possível gerar máscara via performSingleInpaintingStep.`);
        return;
      }

      console.log(`[Inpainting Trigger] Produto selecionado para inpainting: ${product.name} (ID: ${product.id})`);
      console.log(`[Inpainting Trigger] Chamando performSingleInpaintingStep com originalImageUrl: ${originalImageUrl.substring(0,60)}...`);

      // Chamar performSingleInpaintingStep para fazer o trabalho pesado
      const generatedImageUrl = await performSingleInpaintingStep(originalImageUrl, item, product);

      if (generatedImageUrl) {
        console.log(`[Inpainting Trigger] Imagem gerada via performSingleInpaintingStep: ${generatedImageUrl.substring(0,70)}...`);
        await storage.updateDesignProjectItem(item.id, { generatedInpaintedImageUrl: generatedImageUrl });
        console.log(`[Inpainting Trigger] URL da imagem de inpainting salva para o item ${item.id}`);
        
        // Opcional: Notificar o frontend sobre a atualização, se necessário. Exemplo:
        // broadcastToProject(projectId.toString(), {
        //   type: 'ITEM_INPAINTING_COMPLETE',
        //   payload: { itemId: item.id, generatedInpaintedImageUrl: generatedImageUrl, projectId: projectId }
        // });

      } else {
        console.error(`[Inpainting Trigger] Falha ao gerar imagem com performSingleInpaintingStep para o item ${item.id}. A função performSingleInpaintingStep retornou null.`);
        // Aqui você pode adicionar lógica para tratar a falha, como atualizar o status do item ou enviar uma mensagem.
      }
    } else {
      console.log(`[Inpainting Trigger] Nenhum produto selecionado para o item ${item.id}. Inpainting não acionado.`);
    }
  } catch (error) {
    console.error(`[Inpainting Trigger] Erro GERAL ao tentar acionar inpainting para item ${itemId}:`, error);
    // Adicionar tratamento de erro mais robusto se necessário, como atualizar o status do projeto/item.
  }
}

async function performSingleInpaintingStep(baseImageUrl: string, item: DesignProjectItem, product: Product): Promise<string | null> {
  console.log(`[Inpainting Step] Iniciando para item ID: ${item.id} sobre imagem base: ${baseImageUrl.substring(0, 60)}...`);

  let imageWidth: number;
  let imageHeight: number;
  let rectX: number, rectY: number, rectWidth: number, rectHeight: number;
  let maskBuffer: Buffer;
  let primedImageBase64: string;
  let inpaintingPrompt: string;

  if (!product.imageUrl) {
    console.error(`[Inpainting Step] Produto ${product.id} não possui imagem.`);
    return null;
  }
  if (!item.detectedObjectBoundingBox) {
    console.error(`[Inpainting Step] Bounding box não definida para o item ${item.id}.`);
    return null;
  }

  try {
    const baseImageBufferForMetadata = await fetchImageAsBuffer(baseImageUrl);
    const metadata = await sharp(baseImageBufferForMetadata).metadata();
    imageWidth = metadata.width ?? 0;
    imageHeight = metadata.height ?? 0;
    if (imageWidth === 0 || imageHeight === 0) throw new Error("Dimensões da imagem base inválidas.");

    const bboxInput = item.detectedObjectBoundingBox as any;
    if (bboxInput.x_min !== undefined && bboxInput.x_max !== undefined && Math.max(bboxInput.x_min, bboxInput.y_min, bboxInput.x_max, bboxInput.y_max) <= 1.5 && Math.max(bboxInput.x_min, bboxInput.y_min, bboxInput.x_max, bboxInput.y_max) > 0) { 
        rectX = Math.round(bboxInput.x_min * imageWidth);
        rectY = Math.round(bboxInput.y_min * imageHeight);
        rectWidth = Math.round((bboxInput.x_max - bboxInput.x_min) * imageWidth);
        rectHeight = Math.round((bboxInput.y_max - bboxInput.y_min) * imageHeight);
    } else if (bboxInput.x_min !== undefined && bboxInput.x_max !== undefined) { 
        rectX = Math.round(bboxInput.x_min);
        rectY = Math.round(bboxInput.y_min);
        rectWidth = Math.round(bboxInput.x_max - bboxInput.x_min);
        rectHeight = Math.round(bboxInput.y_max - bboxInput.y_min);
    } else if (bboxInput.x !== undefined && bboxInput.y !== undefined && bboxInput.width !== undefined && bboxInput.height !== undefined) { 
        rectX = Math.round(bboxInput.x);
        rectY = Math.round(bboxInput.y);
        rectWidth = Math.round(bboxInput.width);
        rectHeight = Math.round(bboxInput.height);
    } else {
        console.error("[Inpainting Step] Formato de bounding box não reconhecido:", bboxInput);
        throw new Error("Formato de bounding box não reconhecido.");
    }
    rectX = Math.max(0, rectX);
    rectY = Math.max(0, rectY);
    rectWidth = Math.max(1, Math.min(rectWidth, imageWidth - rectX));
    rectHeight = Math.max(1, Math.min(rectHeight, imageHeight - rectY));
    if (rectWidth <= 0 || rectHeight <= 0) {
        throw new Error(`Bounding box resultou em dimensões inválidas: w=${rectWidth}, h=${rectHeight}`);
    }
    console.log(`[Inpainting Step] BBox calculada para item ${item.id}: ${rectWidth}x${rectHeight} em ${rectX},${rectY} (Base: ${imageWidth}x${imageHeight})`);

    // Etapa 2: Preparar Máscara
    const blackBackground = await sharp({ create: { width: imageWidth, height: imageHeight, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const whiteRectangle = await sharp({ create: { width: rectWidth, height: rectHeight, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    maskBuffer = await sharp(blackBackground)
      .composite([{ input: whiteRectangle, left: rectX, top: rectY }])
      .grayscale()
      .png()
      .toBuffer();
    console.log(`[Inpainting Step] Máscara preparada para item ${item.id}.`);

    // Etapa 3: Preparar Imagem Primed
    const baseImageBufferForPriming = await fetchImageAsBuffer(baseImageUrl);
    const productSelectionImageBuffer = await fetchImageAsBuffer(product.imageUrl!); 
    
    const resizedProductImageOutput = await sharp(productSelectionImageBuffer)
      .resize(rectWidth, rectHeight, {
        fit: sharp.fit.inside, 
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 1, effort: 1 }) 
      .toBuffer({ resolveWithObject: true });
    
    const { data: resizedProductBuffer, info: resizedInfo } = resizedProductImageOutput;
    
    const offsetX = rectX + Math.floor((rectWidth - resizedInfo.width) / 2);
    const offsetY = rectY + Math.floor((rectHeight - resizedInfo.height) / 2);

    const primedBuffer = await sharp(baseImageBufferForPriming)
      .composite([{
        input: resizedProductBuffer, 
        left: offsetX,
        top: offsetY
      }])
      .png() 
      .toBuffer();
    primedImageBase64 = `data:image/png;base64,${primedBuffer.toString('base64')}`; 
    console.log(`[Inpainting Step] Imagem Primed preparada para item ${item.id}. Produto redimensionado para ${resizedInfo.width}x${resizedInfo.height}, posicionado em ${offsetX},${offsetY}.`);

    inpaintingPrompt = `A photo of a ${product.name}, ${product.description || 'high quality'}.`;
    console.log(`[Inpainting Step] Prompt para Replicate item ${item.id}: "${inpaintingPrompt}"`);
    console.log(`[Inpainting Step] Primed image base64 (length) para item ${item.id}: ${primedImageBase64?.length || 'N/A'}`);

  } catch (imagePrepError) {
    console.error(`[Inpainting Step] Erro durante preparação de imagem/máscara para item ${item.id}:`, imagePrepError);
    return null;
  }
  
  // Etapa 4: Chamar Replicate 
  try {
    const replicateApiKey = process.env.REPLICATE_API_TOKEN;
    if (!replicateApiKey) {
      console.error("[Inpainting Step] REPLICATE_API_TOKEN não configurado.");
      return null;
    }
    const inpaintingResult = await runReplicateModel<string[] | string>(
      "stability-ai/stable-diffusion-inpainting",
      "95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3",
      {
        image: primedImageBase64, 
        mask: `data:image/png;base64,${maskBuffer.toString('base64')}`,
        prompt: inpaintingPrompt,
      },
      replicateApiKey
    );
    let generatedImageUrl: string | null = null;
    if (inpaintingResult && Array.isArray(inpaintingResult) && inpaintingResult.length > 0 && typeof inpaintingResult[0] === 'string') {
      generatedImageUrl = inpaintingResult[0];
    } else if (inpaintingResult && typeof inpaintingResult === 'string') { 
      generatedImageUrl = inpaintingResult;
    }
    if (generatedImageUrl) {
      console.log(`[Inpainting Step] Imagem de inpainting gerada para item ${item.id}: ${generatedImageUrl.substring(0, 70)}...`);
      return generatedImageUrl;
    } else {
      console.error(`[Inpainting Step] Falha no Replicate para item ${item.id}:`, inpaintingResult);
      return null;
    }
  } catch (replicateError) {
    console.error(`[Inpainting Step] Erro ao chamar Replicate para item ${item.id}:`, replicateError);
    return null;
  }
}

/**
 * Gera o render final para um projeto, aplicando inpainting iterativamente
 * para os itens confirmados.
 */
export async function generateFinalRenderForProject(projectId: number): Promise<void> {
  console.log(`[Render Final] Iniciando para projeto ID: ${projectId}`);
  try {
    const project = await storage.getDesignProject(projectId);
    if (!project || !project.clientRenderImageUrl) {
      console.error(`[Render Final] Projeto ${projectId} não encontrado ou não possui imagem base (clientRenderImageUrl).`);
      await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
      return;
    }

    await storage.updateDesignProject(projectId, { status: 'rendering_final', updatedAt: new Date() });

    const items = await storage.getDesignProjectItems(projectId);
    // Ajustar o filtro para userFeedback se necessário, ou apenas selectedProductId
    const confirmedItems = items.filter(item => item.selectedProductId); 

    if (confirmedItems.length === 0) {
      console.log(`[Render Final] Nenhum item com produto selecionado encontrado para o projeto ${projectId}.`);
      await storage.updateDesignProject(projectId, { status: 'completed', updatedAt: new Date() }); 
      return;
    }

    console.log(`[Render Final] Encontrados ${confirmedItems.length} itens com produtos selecionados para processar.`);
    
    let currentImageUrl = project.clientRenderImageUrl;
    let iteration = 1;

    for (const item of confirmedItems) {
      console.log(`[Render Final] Processando item ${iteration}/${confirmedItems.length}: Item ID ${item.id}, Produto ID ${item.selectedProductId}`);
      
      const product = await storage.getProduct(item.selectedProductId!); // selectedProductId já foi verificado no filter
      if (product) {
        const nextImageUrl = await performSingleInpaintingStep(currentImageUrl, item, product);
        if (nextImageUrl) {
          currentImageUrl = nextImageUrl;
          console.log(`[Render Final] Item ${item.id} processado. Nova imagem base: ${currentImageUrl.substring(0,100)}...`);
          // Opcional: salvar a imagem intermediária gerada para o item no próprio item.
          // await storage.updateDesignProjectItem(item.id, { generatedInpaintedImageUrl: currentImageUrl });
        } else {
          console.warn(`[Render Final] Falha no inpainting do item ${item.id}. Continuando com a imagem anterior: ${currentImageUrl.substring(0,100)}...`);
        }
      } else {
         console.warn(`[Render Final] Produto ID ${item.selectedProductId} não encontrado para o item ${item.id}. Pulando.`);
      }
      iteration++;
    }

    console.log(`[Render Final] Processamento iterativo concluído. Imagem final: ${currentImageUrl.substring(0,100)}...`);
    
    await storage.updateDesignProject(projectId, { 
      generatedRenderUrl: currentImageUrl, 
      status: 'completed', 
      updatedAt: new Date() 
    });

    console.log(`[Render Final] Render final para projeto ${projectId} concluído e URL salva.`);

  } catch (error) {
    console.error(`[Render Final] Erro ao gerar render final para projeto ${projectId}:`, error);
    try {
      await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
    } catch (statusError) {
      console.error(`[Render Final] Erro ao tentar atualizar status do projeto ${projectId} para falha:`, statusError);
    }
  }
} 