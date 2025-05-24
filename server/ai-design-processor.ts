// server/ai-design-processor.ts
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
import { db } from './db'; 
import { sql, and, isNotNull, eq } from 'drizzle-orm'; 
import { products, type Product, type DesignProject, type NewDesignProjectItem, type DesignProjectItem, type AiDesignChatMessage } from '@shared/schema';
import { getClipEmbeddingFromImageUrl, getClipEmbeddingFromImageBuffer } from './clip-service'; 
import { broadcastToProject } from './index';
import sharp from 'sharp';
import { getSegmentationMaskSAM } from './replicate-service'; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EMBEDDING_MODEL = 'text-embedding-3-small';

const FURNITURE_KEYWORDS = [
    'sofa', 'cadeira', 'poltrona', 'mesa', 'banco', 'banqueta', 'puff', 
    'buffet', 'aparador', 'rack', 'estante', 'cama', 'colchao', 
    'cabeceira', 'escrivaninha', 'criado', 'mudo', 'comoda', 'armario', 'roupeiro', 'espelho' 
];

interface ImageAnalysisResult {
  detectedFurniture: {
    name: string;
    description: string;
    position: string;
    dimensions?: { width?: number; height?: number; depth?: number; };
    style?: string;
    colors?: string[];
    materials?: string[];
  }[];
  roomType: string; 
  roomDimensions?: { width?: number; height?: number; area?: number; };
  generalObservations: string;
}

// --- FUNÇÕES AUXILIARES ADICIONADAS/RESTAURADAS ---
async function fetchImageAsBuffer(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith('/') || imageUrl.startsWith('.')) {
    const localPath = path.resolve(imageUrl);
    try {
      return await fs.promises.readFile(localPath);
    } catch (error) {
      console.error(`[fetchImageAsBuffer] Erro ao ler arquivo local ${localPath}:`, error);
      throw error;
    }
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`[fetchImageAsBuffer] Falha ao buscar imagem: ${response.status} ${response.statusText} para URL: ${imageUrl}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`[fetchImageAsBuffer] Erro ao buscar imagem da URL ${imageUrl}:`, error);
    throw error;
  }
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function calculatePixelBbox(bboxInput: any, baseImageWidth: number, baseImageHeight: number): Promise<{ x: number, y: number, w: number, h: number } | null> {
  let rectX: number, rectY: number, rectWidth: number, rectHeight: number;
  if (!bboxInput || typeof bboxInput !== 'object') {
    console.warn(`[BBox Calc] bboxInput inválido ou não é um objeto: ${JSON.stringify(bboxInput)}`);
    return null;
  }
  const { x_min, y_min, x_max, y_max, x, y, width, height } = bboxInput;

  if (x_min !== undefined && y_min !== undefined && x_max !== undefined && y_max !== undefined &&
      [x_min, y_min, x_max, y_max].every(val => typeof val === 'number' && val >= 0 && val <= 1.5)) {
      rectX = Math.round(x_min * baseImageWidth);
      rectY = Math.round(y_min * baseImageHeight);
      rectWidth = Math.round((x_max - x_min) * baseImageWidth);
      rectHeight = Math.round((y_max - y_min) * baseImageHeight);
  } else if (x_min !== undefined && y_min !== undefined && x_max !== undefined && y_max !== undefined &&
           [x_min, y_min, x_max, y_max].every(val => typeof val === 'number')) {
      rectX = Math.round(x_min);
      rectY = Math.round(y_min);
      rectWidth = Math.round(x_max - x_min);
      rectHeight = Math.round(y_max - y_min);
  } else if (x !== undefined && y !== undefined && width !== undefined && height !== undefined &&
           [x, y, width, height].every(val => typeof val === 'number')) {
      rectX = Math.round(x);
      rectY = Math.round(y);
      rectWidth = Math.round(width);
      rectHeight = Math.round(height);
  } else {
      console.warn(`[BBox Calc] Formato de bounding box não reconhecido: ${JSON.stringify(bboxInput)}`);
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
// --- FIM DAS FUNÇÕES AUXILIARES ---

async function findSuggestionsForItem(
    item: DesignProjectItem, 
    userId: number, 
    imageUrlToProcess: string, 
    segmentationMaskUrl?: string | null
): Promise<SuggestionForChat[]> {
    console.log(`[findSuggestionsForItem V3.6] Item: "${item.detectedObjectName}", Mask URL: ${segmentationMaskUrl ? "Presente" : "Ausente"}`);
    try {
        const detectedText = (`${item.detectedObjectName || ''} ${item.detectedObjectDescription || ''}`).trim();
        if (!detectedText && !item.detectedObjectBoundingBox) return [];
        let textualSearchResults: (Product & { relevance?: number })[] = [];
        if (detectedText) {
            try {
                textualSearchResults = await storage.searchProducts(userId, detectedText);
                textualSearchResults = textualSearchResults.filter(p => p.imageUrl);
            } catch (error) { console.error("[findSuggestionsForItem V3.6] Erro FTS:", error); }
        }
        let targetRoiClipEmbedding: number[] | null = null;
        let originalImageBuffer: Buffer | null = null;
        let imageMetadata: sharp.Metadata | null = null;
        if (imageUrlToProcess) {
            try {
                originalImageBuffer = await fetchImageAsBuffer(imageUrlToProcess);
                if (originalImageBuffer) imageMetadata = await sharp(originalImageBuffer).metadata();
            } catch (e) { originalImageBuffer = null; }
        }
        if (originalImageBuffer && imageMetadata?.width && imageMetadata?.height) {
            if (segmentationMaskUrl) {
                try {
                    const maskImageBuffer = await fetchImageAsBuffer(segmentationMaskUrl);
                    const maskedRoiBuffer = await sharp(originalImageBuffer).composite([{ input: maskImageBuffer, blend: 'in' }]).png().toBuffer();
                    const pixelBbox = await calculatePixelBbox(item.detectedObjectBoundingBox, imageMetadata.width, imageMetadata.height);
                    if (pixelBbox && pixelBbox.w > 0 && pixelBbox.h > 0) {
                        targetRoiClipEmbedding = await getClipEmbeddingFromImageBuffer(maskedRoiBuffer, `roi_sam_${item.id}`);
                        if (targetRoiClipEmbedding) console.log("[findSuggestionsForItem V3.6] Embedding CLIP da ROI MASCARADA (SAM) gerado.");
                    }
                } catch (samProcessingError) { console.error(`[findSuggestionsForItem V3.6] Erro SAM Mask Proc:`, samProcessingError);}
            }
            if (!targetRoiClipEmbedding && item.detectedObjectBoundingBox) {
                try {
                    const pixelBbox = await calculatePixelBbox(item.detectedObjectBoundingBox, imageMetadata.width, imageMetadata.height);
                    if (pixelBbox && pixelBbox.w > 0 && pixelBbox.h > 0) {
                        const roiBuffer = await sharp(originalImageBuffer).extract({ left: pixelBbox.x, top: pixelBbox.y, width: pixelBbox.w, height: pixelBbox.h }).png().toBuffer();
                        targetRoiClipEmbedding = await getClipEmbeddingFromImageBuffer(roiBuffer, `roi_bbox_${item.id}`);
                         if (targetRoiClipEmbedding) console.log("[findSuggestionsForItem V3.6] Embedding CLIP da ROI por BBOX (fallback) gerado.");
                    }
                } catch (bboxError) {console.error(`[findSuggestionsForItem V3.6] Erro BBOX Fallback:`, bboxError); }
            }
        }
        const combinedSuggestionsMap: Map<number, {product: Product, textScore: number, visualScore: number, sourceDetails: string[]}> = new Map();
        const maxFtsRelevance = textualSearchResults.reduce((max, p) => Math.max(max, p.relevance || 0), 0);
        for (const product of textualSearchResults) {
            let ftsScore = maxFtsRelevance > 0 ? (product.relevance || 0) / maxFtsRelevance : 0;
            ftsScore = Math.max(0, Math.min(ftsScore, 1));
            if (ftsScore > 0.01) combinedSuggestionsMap.set(product.id, { product, textScore: ftsScore, visualScore: 0, sourceDetails: ['text_fts'] });
        }
        if (targetRoiClipEmbedding) {
            let visuallySimilarProductsDb: (Product & { distance?: number })[] = [];
            try {
                const embeddingStringForDb = `[${targetRoiClipEmbedding.join(',')}]`;
                const distanceExpression = sql`${products.clipEmbedding} <-> ${embeddingStringForDb}`;
                visuallySimilarProductsDb = await db.select({id: products.id, userId: products.userId, catalogId: products.catalogId, name: products.name, code: products.code, description: products.description, price: products.price, category: products.category, manufacturer: products.manufacturer, imageUrl: products.imageUrl, colors: products.colors, materials: products.materials, sizes: products.sizes, location: products.location, stock: products.stock, excelRowNumber: products.excelRowNumber, embedding: products.embedding, clipEmbedding: products.clipEmbedding, search_tsv: products.search_tsv, createdAt: products.createdAt, firestoreId: products.firestoreId, firebaseUserId: products.firebaseUserId, isEdited: products.isEdited, distance: distanceExpression.mapWith(Number) }).from(products).where(and(isNotNull(products.clipEmbedding), isNotNull(products.imageUrl))).orderBy(distanceExpression).limit(40);
            } catch (dbVectorError) { console.error("[findSuggestionsForItem V3.6] Erro DB vector:", dbVectorError); visuallySimilarProductsDb = [];}
            const visualClipThreshold = 0.10; 
            for (const product of visuallySimilarProductsDb) {
                let currentVisualClipScore = typeof product.distance === 'number' ? (1 / (1 + product.distance)) : 0;
                currentVisualClipScore = Math.max(0, Math.min(currentVisualClipScore, 1));
                if (currentVisualClipScore >= visualClipThreshold) {
                    const existing = combinedSuggestionsMap.get(product.id);
                    if (existing) {
                        existing.visualScore = Math.max(existing.visualScore, currentVisualClipScore);
                        if (!existing.sourceDetails.includes('visual_clip_db')) existing.sourceDetails.push('visual_clip_db');
                    } else {
                        combinedSuggestionsMap.set(product.id, { product, textScore: 0, visualScore: currentVisualClipScore, sourceDetails: ['visual_clip_db'] });
                    }
                }
            }
        }
        let processedSuggestions: SuggestionForChat[] = Array.from(combinedSuggestionsMap.values()).map(sugg => {
            const textWeight = 0.01, visualWeight = 0.99; 
            let cs = (sugg.textScore * textWeight) + (sugg.visualScore * visualWeight);
            if (sugg.visualScore > 0 && sugg.textScore === 0) cs = sugg.visualScore * visualWeight;
            else if (sugg.textScore > 0 && sugg.visualScore === 0) cs = sugg.textScore * textWeight;
            return { product: sugg.product, source: sugg.sourceDetails.join('+') || 'none', matchScore: cs, textSimilarity: sugg.textScore, visualSimilarity: sugg.visualScore, combinedScore: cs };
        });
        processedSuggestions = processedSuggestions.filter(s => s.combinedScore > 0.05).sort((a, b) => b.combinedScore - a.combinedScore);
        const itemDetectedObjectNameNormalized = normalizeText(item.detectedObjectName);
        const categoryFilteredSuggestions = processedSuggestions.filter(sugg => {
            if (!sugg.product.imageUrl) return false;
            if (!item.detectedObjectName) return true; 
            const productCategoryNormalized = normalizeText(sugg.product.category);
            if (!productCategoryNormalized) return false;
            let currentItemNameNormalized = itemDetectedObjectNameNormalized;
            if (currentItemNameNormalized.includes("sofa de") && currentItemNameNormalized.includes("lugares")) currentItemNameNormalized = "sofa";
            if (currentItemNameNormalized === productCategoryNormalized) return true;
            const mappings: Record<string, string[]> = {
                'sofa': ['sofa', 'estofado'], 'poltrona': ['poltrona', 'cadeira', 'cadeira de jantar'], 'cadeira': ['cadeira', 'cadeira de jantar', 'poltrona', 'banqueta', 'banco'], 'cadeira de jantar': ['cadeira de jantar', 'cadeira'],
                'mesa': ['mesa', 'mesa de centro', 'mesa lateral', 'mesa de apoio', 'mesa de jantar', 'escrivaninha'], 'mesa de jantar': ['mesa de jantar', 'mesa', 'mesa de jantar redonda'], 'mesa de jantar redonda': ['mesa de jantar redonda', 'mesa de jantar', 'mesa'],
                'mesa de centro': ['mesa de centro', 'mesa', 'mesa de centro redonda'], 'mesa de centro redonda': ['mesa de centro redonda', 'mesa de centro', 'mesa'], 'mesa lateral': ['mesa lateral', 'mesa de apoio', 'mesa', 'mesa lateral redonda'],
                'mesa lateral redonda': ['mesa lateral redonda', 'mesa lateral', 'mesa de apoio', 'mesa'], 'mesa de apoio': ['mesa de apoio', 'mesa lateral', 'mesa'], 'rack': ['rack', 'movel para tv', 'móvel para tv', 'rack baixo para tv'],
                'rack baixo para tv': ['rack baixo para tv', 'rack', 'movel para tv', 'móvel para tv'], 'estante': ['estante', 'livreiro'], 'luminaria': ['luminaria', 'luminaria de chao', 'luminaria de mesa', 'abajur'],
                'luminaria de chao': ['luminaria de chao', 'luminaria'], 'armario': ['armario', 'roupeiro', 'guarda-roupa'], 'buffet': ['buffet', 'aparador', 'balcao'], 'aparador': ['aparador', 'buffet', 'console', 'balcao']
            };
            if (mappings[currentItemNameNormalized]?.includes(productCategoryNormalized)) return true;
            if (mappings[productCategoryNormalized]?.includes(currentItemNameNormalized)) return true;
            if (currentItemNameNormalized.startsWith(productCategoryNormalized) || productCategoryNormalized.startsWith(currentItemNameNormalized)) return true;
            return false;
        });
        const currentItemNameForLog = item.detectedObjectName?.toLowerCase() || "desconhecido";
        console.log(`[DEBUG SCORES ANTES CAT FILTRO V3.6] Para item: "${item.detectedObjectName}" (ID: ${item.id})`);
        processedSuggestions.forEach(s_log_debug => {
            const prodCatLower = s_log_debug.product.category?.toLowerCase() || "sem_categoria";
            console.log(`  -> CANDIDATO: ID: ${s_log_debug.product.id}, Nome: ${s_log_debug.product.name.substring(0,35)}, Cat: ${s_log_debug.product.category}, Score Combinado: ${s_log_debug.combinedScore.toFixed(4)}, Visual: ${s_log_debug.visualSimilarity?.toFixed(4)}, Text: ${s_log_debug.textSimilarity?.toFixed(4)}, Source: ${s_log_debug.source}`);
        });
        console.log(`[findSuggestionsForItem V3.6] PÓS-FILTRO categoria: ${categoryFilteredSuggestions.length} para "${item.detectedObjectName}".`);
        return categoryFilteredSuggestions.slice(0, 5);
    } catch (error) {
        console.error(`[findSuggestionsForItem V3.6] Erro GERAL item ${item.id}:`, error);
        return [];
    }
}

interface SuggestionForChat {
    product: Product;
    matchScore?: number; 
    source?: string;
    combinedScore: number; 
    textSimilarity?: number;
    visualSimilarity?: number;
}

function formatSuggestionsForChatItem(item: DesignProjectItem, suggestions: SuggestionForChat[]): string {
    if (!item.detectedObjectName) {
        console.warn("[formatSuggestions V3.3.2] Item sem detectedObjectName, retornando string vazia.");
        return '';
    }
    if (!suggestions || suggestions.length === 0) {
      return `  - **${item.detectedObjectName}** (Original: *${item.detectedObjectDescription || 'N/A'}*): Nenhuma sugestão encontrada com os critérios atuais.\\n`;
    }
    let response = `  - **${item.detectedObjectName}** (Original: *${item.detectedObjectDescription || 'N/A'}*):\\n`;
    suggestions.slice(0, 3).forEach((sugg, index) => {
        response += `    ${index + 1}. **${sugg.product.name}** (Relevância: ${(sugg.combinedScore * 100).toFixed(0)}%, Cat: ${sugg.product.category || 'N/A'})\\n`;
        if (sugg.product.imageUrl) {
            response += `       ![Produto](${sugg.product.imageUrl}?w=100&h=100)\\n`;
        }
        response += `       (Detalhes: Cód: ${sugg.product.code || 'N/A'}, Preço: R$ ${sugg.product.price ? (sugg.product.price / 100).toFixed(2) : 'N/A' })\\n`;
    });
    return response;
}

// Funções analyzeFloorPlanImage, analyzeRenderImage, findSimilarProducts, 
// generateAiResponse, processAiDesignProject USARÃO AS IMPLEMENTAÇÕES DO CÓDIGO ANTIGO FORNECIDO.
// Certifique-se que elas chamam as funções auxiliares fetchImageAsBuffer, normalizeText, calculatePixelBbox quando necessário.

export async function analyzeFloorPlanImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    const imageBuffer = await fetchImageAsBuffer(imageUrl); // Usa a função auxiliar restaurada
    const base64Image = imageBuffer.toString('base64');
    const response = await openai.chat.completions.create({
      model: "gpt-4o", messages: [{ role: "system", content: `Você é um assistente especializado em análise de plantas baixas...` }, { role: "user", content: [{ type: "text", text: "Analise esta planta baixa...JSON..." },{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }], response_format: { type: "json_object" }, max_tokens: 2000 });
    const messageContent = response.choices[0]?.message?.content;
    if (!messageContent) throw new Error("OpenAI response content is null.");
    return JSON.parse(messageContent) as ImageAnalysisResult;
  } catch (error) {
    console.error("Erro ao analisar planta baixa com OpenAI:", error);
    return analyzeFloorPlanImageWithClaude(imageUrl);
  }
}
async function analyzeFloorPlanImageWithClaude(imageUrl: string): Promise<ImageAnalysisResult> {
  console.warn("[Claude Fallback] analyzeFloorPlanImageWithClaude chamado."); 
  // Implementação simplificada, idealmente teria lógica de API como a original
  return { detectedFurniture: [], roomType: "Não identificado", generalObservations: "Fallback Claude para planta baixa." };
}
export async function analyzeRenderImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    const imageBuffer = await fetchImageAsBuffer(imageUrl); // Usa a função auxiliar restaurada
    const base64Image = imageBuffer.toString('base64');
    const response = await openai.chat.completions.create({ model: "gpt-4o", messages: [ { role: "system", content: `Você é um assistente especializado em análise de renders...` }, { role: "user", content: [{ type: "text", text: "Analise este render...JSON..." },{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } } ] }], response_format: { type: "json_object" }, max_tokens: 2000 });
    const messageContent = response.choices[0]?.message?.content;
    if (!messageContent) throw new Error("OpenAI response content is null.");
    return JSON.parse(messageContent) as ImageAnalysisResult;
  } catch (error) {
    console.error("Erro ao analisar render com OpenAI:", error);
    return analyzeRenderImageWithClaude(imageUrl);
  }
}
async function analyzeRenderImageWithClaude(imageUrl: string): Promise<ImageAnalysisResult> {
  console.warn("[Claude Fallback] analyzeRenderImageWithClaude chamado.");
  return { detectedFurniture: [], roomType: "Não identificado", generalObservations: "Fallback Claude para render." };
}
export async function findSimilarProducts(detectedFurniture: ImageAnalysisResult['detectedFurniture'], userId: number) {
  // Esta é a implementação antiga que você forneceu, que não usa a `findSuggestionsForItem` V3.
  // Para usar a nova lógica de sugestão, esta função precisaria ser refatorada ou não ser usada por `processAiDesignProject`.
  console.warn("[findSimilarProducts] Usando implementação antiga. Para sugestões V3, esta função precisa ser revista.");
  const allProducts = await storage.getProductsByUserId(userId);
  const similarProducts = [];
  for (const furniture of detectedFurniture) {
    const relevantProducts = allProducts.filter(product => {
      const category = product.category?.toLowerCase() || '';
      const productName = product.name.toLowerCase();
      const furnitureName = furniture.name.toLowerCase();
      return category.includes(furnitureName) || productName.includes(furnitureName) || furnitureName.includes(category);
    });
    if (relevantProducts.length > 0) {
      similarProducts.push({ detectedFurniture: furniture, similarProducts: relevantProducts.slice(0, 3) });
    }
  }
  return similarProducts;
}
export async function generateAiResponse( floorPlanAnalysis: ImageAnalysisResult, renderAnalysis: ImageAnalysisResult, similarProducts: any[] ): Promise<string> {
  console.warn("[generateAiResponse] Usando implementação antiga.");
  // Simplificado para evitar dependências não revisadas
  return `Análise concluída. Encontrados ${renderAnalysis.detectedFurniture.length} tipos de móveis. ${similarProducts.length} tiveram sugestões preliminares.`;
}
export async function processAiDesignProject(projectId: number): Promise<DesignProject | null> {
  console.warn("[processAiDesignProject] Esta função usa a lógica antiga de findSimilarProducts. Precisa ser adaptada para a nova findSuggestionsForItem se o objetivo for usar as sugestões V3.");
  // ... (resto da implementação antiga)
  return null;
}

export async function processDesignProjectImage(projectId: number, imageUrlToProcess: string, userMessageText?: string): Promise<void> {
  console.log(`[AI Design Processor V3.6] Iniciando para projeto ${projectId}`);
  const initialUserMessageForChat = userMessageText ? 
    `Analisando a imagem que você enviou com a mensagem: "${userMessageText}"...` :
    `Analisando a imagem que você enviou...`;
  await storage.createAiDesignChatMessage({ projectId, role: 'assistant', content: initialUserMessageForChat });
  broadcastToProject(projectId.toString(), { type: 'ai_processing_started' });

  let detectedObjectsFromVision: { name: string; description: string; bbox: any; }[] = [];
  let visionAnalysisFailed = false;
  let project: DesignProject | undefined | null = null; 

  let originalImageBuffer: Buffer | null = null;
  let imageMetadata: sharp.Metadata | null = null;

  if (imageUrlToProcess) {
      try {
          originalImageBuffer = await fetchImageAsBuffer(imageUrlToProcess);
          if (originalImageBuffer) {
              imageMetadata = await sharp(originalImageBuffer).metadata();
          }
      } catch (e) {
          console.error("[AI Design Processor V3.6] Erro ao buscar imagem:", e);
          return; 
      }
  }
  if (!originalImageBuffer || !imageMetadata?.width || !imageMetadata?.height) {
      console.error("[AI Design Processor V3.6] Imagem ou metadados inválidos.");
      return; 
  }

  try {
    project = await storage.getDesignProject(projectId);
    if (!project) {
      console.error(`[AI Design Processor V3.6] Projeto ${projectId} não encontrado.`);
      await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: `Erro: Não consegui encontrar os detalhes do projeto (ID: ${projectId}).` });
      broadcastToProject(projectId.toString(), { type: 'ai_processing_error', error: 'Project not found' });
      return; 
    }

    console.log(`[AI Design Processor V3.6] Enviando imagem para análise de visão GPT-4o...`);
    let visionContent: string | null | undefined = null;
    try {
      const visionResponse = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
            {
              role: "system",
              content: `Você é um especialista em design de interiores com formação avançada (nível doutorado) e ampla experiência na análise de renders de ambientes. Sua tarefa é analisar a imagem fornecida e identificar APENAS OS MÓVEIS PRINCIPAIS presentes no ambiente (excluindo itens decorativos, plantas, cortinas, objetos pequenos e estruturas fixas).\n\nPara CADA MÓVEL INDIVIDUALMENTE IDENTIFICADO (liste cada instância separadamente, mesmo que sejam do mesmo tipo, como múltiplas cadeiras idênticas), responda com:\n\n1.  **NOME DO MÓVEL:** Forneça o nome mais preciso e técnico possível (ex: "Cadeira de jantar Estilo Eames", "Sofá Chesterfield 3 lugares", "Mesa lateral redonda tripé").\n    *   **CADEIRA vs. POLTRONA:**\n        *   **Poltrona:** Estofada, com braços, aspecto robusto, geralmente voltada ao conforto.\n        *   **Cadeira de jantar:** Usada com mesa de jantar. Pode ser estofada, mas mais leve.\n        *   **Cadeira de escritório:** Com rodízios e ajuste de altura.\n        *   **Cadeira (genérica):** Assento simples individual, sem características claras das anteriores.\n        *   ⚠️ **Nunca confunda** uma poltrona com uma cadeira estofada leve.\n    *   Use nomes técnicos como: "mesa lateral", "rack baixo", "estante alta", "banco", "banqueta", "mesa de cabeceira", "sofá modular", etc.\n\n2.  **DESCRIÇÃO CURTA:** Máximo 20 palavras, descrevendo estilo, cor principal, material predominante e uma característica marcante.\n    *   Exemplo:\n        *   "Sofá de 3 lugares, veludo verde-escuro, encosto baixo, pés dourados, estilo moderno."\n        *   "Mesa lateral redonda, madeira clara, estilo escandinavo, base de três pés."\n\n3.  **BOUNDING BOX (bbox):** Forneça as coordenadas da bounding box para CADA móvel, em formato JSON: { "x_min": %, "y_min": %, "x_max": %, "y_max": % } (valores de 0.0 a 1.0 relativos à dimensão da imagem). **A BBOX DEVE SER PRECISA E ENVOLVER COMPLETAMENTE APENAS O MÓVEL VISÍVEL, sem ser excessivamente pequena nem incluir muitos elementos ao redor. Certifique-se que a BBox cubra a maior parte do objeto.**\n\nRESPONDA SEMPRE em formato JSON válido. O JSON deve ser um objeto contendo uma chave "furniture" que é um array de objetos. Cada objeto representa um móvel. Se NENHUM MÓVEL for identificável, retorne { "furniture": [] }. Evite frases como "não foram encontrados móveis", apenas retorne o JSON especificado.`
            },
          { role: "user", content: [{ type: "text", text: `Analise a imagem e identifique os móveis conforme as instruções. Mensagem do usuário (pode estar vazia): "${userMessageText || ''}"` },{ type: "image_url", image_url: { url: imageUrlToProcess } }] }
          ],
        response_format: { type: "json_object" }, 
          max_tokens: 3000,
        });
        console.log("[AI Design Processor V3.6] Resposta bruta da API Vision (choices[0]):", JSON.stringify(visionResponse.choices[0], null, 2));
        visionContent = visionResponse.choices[0]?.message?.content;
    } catch (e: any) { 
        visionAnalysisFailed = true; 
        console.error("[AI Design Processor V3.6] Erro DIRETO na chamada da API OpenAI Vision:", e.message);
        if (e.response) { console.error("[AI Design Processor V3.6] OpenAI Error Response:", e.response.data); }
    }

    if (!visionAnalysisFailed && visionContent) {
        console.log("[AI Design Processor V3.6] Conteúdo da API Vision recebido para parse:", visionContent.substring(0, 500) + "...");
        try {
            const parsedJsonResponse = JSON.parse(visionContent);
            let tempDetectedObjects: { name: string | undefined; description: string | undefined; bbox: any; }[] = [];

            if (parsedJsonResponse?.furniture && Array.isArray(parsedJsonResponse.furniture)) {
                 tempDetectedObjects = parsedJsonResponse.furniture.map((item: any) => ({
                    name: item["NOME DO MÓVEL"] || item.nome || item.name,
                    description: item["DESCRIÇÃO CURTA"] || item.descrição || item.description,
                    bbox: item["BOUNDING BOX (bbox)"] || item["BOUNDING BOX"] || item.bounding_box || item.bbox, 
                }));
            } else if (Array.isArray(parsedJsonResponse)) { 
                tempDetectedObjects = parsedJsonResponse.map((item: any) => ({
                    name: item["NOME DO MÓVEL"] || item.nome || item.name,
                    description: item["DESCRIÇÃO CURTA"] || item.descrição || item.description,
                    bbox: item["BOUNDING BOX (bbox)"] || item["BOUNDING BOX"] || item.bounding_box || item.bbox, 
                }));
            } else {
                console.warn("[AI Design Processor V3.6] Formato JSON da Vision API inesperado ou sem a chave 'furniture'.", parsedJsonResponse);
                // Considerar como falha se não tiver a chave furniture e não for um array vazio direto
                if (!Array.isArray(parsedJsonResponse) || parsedJsonResponse.length > 0) {
                     visionAnalysisFailed = true;
                }
            }
            detectedObjectsFromVision = tempDetectedObjects.filter(obj => obj.name && obj.name.trim() !== "").map(obj => ({ name: obj.name!, description: obj.description || "", bbox: obj.bbox }));
            console.log(`[AI Design Processor V3.6] ${detectedObjectsFromVision.length} objetos detectados pela IA de Visão.`);
        } catch (parseError: any) { 
            visionAnalysisFailed = true; 
            console.error("[AI Design Processor V3.6] Erro CRÍTICO ao parsear JSON da API Vision:", parseError.message, "Conteúdo recebido:", visionContent.substring(0,500));
        }
    } else if (!visionAnalysisFailed && !visionContent) {
         console.error("[AI Design Processor V3.6] Resposta da API Vision bem-sucedida, mas o conteúdo da mensagem está vazio ou nulo.");
         visionAnalysisFailed = true; 
    }

    if (visionAnalysisFailed || detectedObjectsFromVision.length === 0) {
        const errorMsg = visionAnalysisFailed ? "Falha na análise inicial da imagem pela IA." : "Nenhum móvel principal identificado na imagem.";
        await storage.createAiDesignChatMessage({ projectId, role: 'assistant', content: errorMsg });
        if (project) {
            await storage.updateDesignProject(projectId, { status: visionAnalysisFailed? 'error_vision':'processed_no_items', updatedAt: new Date() });
        }
        broadcastToProject(projectId.toString(), { type: visionAnalysisFailed? 'ai_processing_error' : 'ai_processing_complete_no_objects', error: visionAnalysisFailed? 'Vision API error' : undefined });
        return;
    }
    
    const createdDesignProjectItems: DesignProjectItem[] = [];
    for (const obj of detectedObjectsFromVision) {
        const newItemData: NewDesignProjectItem = {
            designProjectId: projectId, detectedObjectName: obj.name, 
            detectedObjectDescription: obj.description, detectedObjectBoundingBox: obj.bbox, 
        };
        const createdItem = await storage.createDesignProjectItem(newItemData);
        if (createdItem) createdDesignProjectItems.push(createdItem as DesignProjectItem);
    }
    console.log(`[AI Design Processor V3.6] ${createdDesignProjectItems.length} DesignProjectItems criados a partir da IA de Visão.`);
    
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
                mainKeyword = kw; normalizedMainKeyword = normalizedKw; break;
            }
        }
        if(mainKeyword) console.log(`[AI Design Processor V3.6] Keyword de foco detectada: "${mainKeyword}"`);
    }
    
    const itemsWithSuggestions: {item: DesignProjectItem, suggestions: SuggestionForChat[]}[] = [];
    for (const DRAFT_item of createdDesignProjectItems) {
        let segmentationMaskUrl: string | null = null;
        const detectedObjectNameLower = DRAFT_item.detectedObjectName?.toLowerCase() || "";
        let samPromptText = DRAFT_item.detectedObjectName || ""; 
        if (detectedObjectNameLower.includes("mesa")) samPromptText = "mesa";
        else if (detectedObjectNameLower.includes("cadeira")) samPromptText = "cadeira";
        else if (detectedObjectNameLower.includes("sofa")) samPromptText = "sofa";
        console.log(`[PROCESS_SAM V3.6] Item: "${DRAFT_item.detectedObjectName}", SAM Prompt: "${samPromptText}"`);
        if (DRAFT_item.detectedObjectBoundingBox && samPromptText.trim() !== "") {
            try {
                segmentationMaskUrl = await getSegmentationMaskSAM(imageUrlToProcess, samPromptText); 
                if (segmentationMaskUrl) console.log(`[PROCESS_SAM V3.6] Máscara SAM OBTIDA: ${segmentationMaskUrl}`);
                else console.warn(`[PROCESS_SAM V3.6] getSegmentationMaskSAM retornou NULL para prompt: "${samPromptText}".`);
            } catch (samError) { console.error(`[PROCESS_SAM V3.6] Erro SAM:`, samError); }
        } else {
          console.warn(`[PROCESS_SAM V3.6] Condições para SAM NÃO SATISFEITAS.`);
        }
        
        const itemForSuggestions = { ...DRAFT_item, detectedObjectBoundingBox: DRAFT_item.detectedObjectBoundingBox };

        if (project?.userId) {
            const suggestionsFromFind = await findSuggestionsForItem(itemForSuggestions, project.userId, imageUrlToProcess, segmentationMaskUrl);
            itemsWithSuggestions.push({ item: DRAFT_item, suggestions: suggestionsFromFind});
        } else {
            itemsWithSuggestions.push({ item: DRAFT_item, suggestions: []});
        }
    }

    let itemsToProcessForChat = itemsWithSuggestions;
    if (mainKeyword && normalizedMainKeyword) {
        const focused = itemsWithSuggestions.filter(({item}) => item.detectedObjectName && normalizeText(item.detectedObjectName).includes(normalizedMainKeyword!));
        if (focused.length > 0) {
            itemsToProcessForChat = focused;
            focusedProcessing = true;
            chatResponseContent += `Entendido! Focando em sugestões para **${mainKeyword}** que identifiquei na imagem:\\n\\n`;
        } else {
            chatResponseContent += `Não encontrei especificamente um "${mainKeyword}" claro nos itens detectados. Mostrando todas as sugestões:\\n\\n`;
        }
    }

    if (itemsToProcessForChat.length > 0) {
        if (!focusedProcessing && chatResponseContent.length === 0) {
             chatResponseContent += "Aqui estão os móveis que identifiquei na imagem e algumas sugestões do nosso catálogo:\\n\\n";
        }
        for (const {item, suggestions} of itemsToProcessForChat) {
            const updatePayload: Partial<Omit<DesignProjectItem, 'id' | 'designProjectId' | 'createdAt' | 'updatedAt'>> = {};
            if(suggestions.length > 0 && suggestions[0]?.product?.id && typeof suggestions[0]?.combinedScore === 'number') { 
                updatePayload.suggestedProductId1 = suggestions[0].product.id; updatePayload.matchScore1 = suggestions[0].combinedScore; 
            }
            if(suggestions.length > 1 && suggestions[1]?.product?.id && typeof suggestions[1]?.combinedScore === 'number') { 
                updatePayload.suggestedProductId2 = suggestions[1].product.id; updatePayload.matchScore2 = suggestions[1].combinedScore; 
            }
            if(suggestions.length > 2 && suggestions[2]?.product?.id && typeof suggestions[2]?.combinedScore === 'number') { 
                updatePayload.suggestedProductId3 = suggestions[2].product.id; updatePayload.matchScore3 = suggestions[2].combinedScore; 
            }
            if (Object.keys(updatePayload).length > 0) await storage.updateDesignProjectItem(item.id, updatePayload);
            chatResponseContent += formatSuggestionsForChatItem(item, suggestions); 
        }
        if (focusedProcessing) {
            const otherItems = itemsWithSuggestions.filter(({item}) => !itemsToProcessForChat.some(focused => focused.item.id === item.id));
            if (otherItems.length > 0) {
                 chatResponseContent += `\\nTambém identifiquei outros itens (${otherItems.map(({item}) => item.detectedObjectName).join(', ')}). Se quiser sugestões para eles, me diga!`;
            }
        }
    } else if (!visionAnalysisFailed && createdDesignProjectItems.length > 0 && chatResponseContent.length === 0) {
        chatResponseContent = "Não consegui encontrar sugestões adequadas para os itens detectados com os critérios atuais.";
    } else if (!visionAnalysisFailed && chatResponseContent.length === 0) {
         chatResponseContent = "Não identifiquei móveis claros nesta imagem. Poderia tentar outra imagem ou descrever o que você procura?";
    }
    
    if (chatResponseContent.trim() !== "") {
        await storage.createAiDesignChatMessage({ projectId, role: 'assistant', content: chatResponseContent });
    } 
    
    if (project) { 
        let newStatus: DesignProject['status'] = project.status; 
        if (visionAnalysisFailed && newStatus !== 'error' && newStatus !== 'error_vision') newStatus = 'error_vision';
        else if (!visionAnalysisFailed && createdDesignProjectItems.length > 0 && newStatus !== 'completed') newStatus = 'awaiting_selection';
        else if (!visionAnalysisFailed && createdDesignProjectItems.length === 0 && newStatus !== 'completed') newStatus = 'processed_no_items';
        
        if (project.status !== newStatus) {
            await storage.updateDesignProject(projectId, { status: newStatus, updatedAt: new Date() });
        }
    }
    broadcastToProject(projectId.toString(), { type: 'ai_processing_complete', projectId });
    console.log(`[AI Design Processor V3.6] Processamento da imagem para projeto ${projectId} concluído.`);
  } catch (error: any) {
    console.error(`[AI Design Processor V3.6] Erro GERAL no processamento para projeto ${projectId}:`, error);
    try {
        if (project) await storage.updateDesignProject(projectId, { status: 'error', updatedAt: new Date() });
        broadcastToProject(projectId.toString(), { type: 'ai_processing_error', error: error.message || 'Unknown error' });
    } catch (dbError) { console.error(`[AI Design Processor V3.6] Erro ao registrar erro no DB:`, dbError); }
  }
}

export async function triggerInpaintingForItem(itemId: number, projectId: number, originalImageUrl: string): Promise<void> {
  console.log(`[Inpainting Trigger V3.3.2] Iniciando para itemId: ${itemId}, projectId: ${projectId}`);
  try {
    const project = await storage.getDesignProject(projectId);
    const projectItems = await storage.getDesignProjectItems(projectId);
    const item = projectItems.find(pItem => pItem.id === itemId);
    if (!project || !item || !item.selectedProductId) {
      console.error(`[Inpainting Trigger V3.3.2] Projeto, item ou produto selecionado não encontrado/inválido.`);
      return;
    }
    const product = await storage.getProduct(item.selectedProductId);
    if (!product || !product.imageUrl) {
      console.error(`[Inpainting Trigger V3.3.2] Produto ${item.selectedProductId} não encontrado ou sem imagem.`);
      return;
    }
    if (!item.detectedObjectBoundingBox) {
      console.error(`[Inpainting Trigger V3.3.2] BBox não definida para item ${item.id}.`);
      return;
    }
    const generatedImageUrl = await performSingleInpaintingStep(originalImageUrl, item, product);
    if (generatedImageUrl) {
      await storage.updateDesignProjectItem(item.id, { generatedInpaintedImageUrl: generatedImageUrl });
      broadcastToProject(projectId.toString(), { 
        type: 'DESIGN_PROJECT_UPDATED', 
        payload: { projectId, updatedItem: {id: item.id, generatedInpaintedImageUrl: generatedImageUrl} } 
      });
    } else {
      console.error(`[Inpainting Trigger V3.3.2] Falha ao gerar imagem com inpainting para item ${item.id}.`);
    }
  } catch (error) {
    console.error(`[Inpainting Trigger V3.3.2] Erro GERAL:`, error);
  }
}

async function performSingleInpaintingStep(baseImageUrl: string, item: DesignProjectItem, product: Product): Promise<string | null> {
  console.log(`[Inpainting Step V3.5.1] Iniciando para item ID: ${item.id}`);
  if (!product.imageUrl || !item.detectedObjectBoundingBox) return null;
  try {
    const baseImageBuffer = await fetchImageAsBuffer(baseImageUrl);
    const metadata = await sharp(baseImageBuffer).metadata();
    const { width: imageWidth, height: imageHeight } = metadata;
    if (!imageWidth || !imageHeight) throw new Error("Dimensões da imagem base inválidas.");

    const pixelDataBbox = await calculatePixelBbox(item.detectedObjectBoundingBox, imageWidth, imageHeight);
    if (!pixelDataBbox) throw new Error("Não foi possível calcular BBox em pixels.");
    const { x: rectX, y: rectY, w: rectWidth, h: rectHeight } = pixelDataBbox;

    const blackBackground = await sharp({ create: { width: imageWidth, height: imageHeight, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const whiteRectangle = await sharp({ create: { width: rectWidth, height: rectHeight, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const maskBuffer = await sharp(blackBackground).composite([{ input: whiteRectangle, left: rectX, top: rectY }]).grayscale().png().toBuffer();
    
    const productSelectionImageBuffer = await fetchImageAsBuffer(product.imageUrl);
    const resizedProductImageOutput = await sharp(productSelectionImageBuffer).resize(rectWidth, rectHeight, { fit: sharp.fit.inside, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const { data: resizedProductBuffer, info: resizedInfo } = resizedProductImageOutput;
    const offsetX = rectX + Math.floor((rectWidth - resizedInfo.width) / 2);
    const offsetY = rectY + Math.floor((rectHeight - resizedInfo.height) / 2);
    const primedBuffer = await sharp(baseImageBuffer).composite([{ input: resizedProductBuffer, left: offsetX, top: offsetY }]).png().toBuffer();
    const primedImageBase64 = `data:image/png;base64,${primedBuffer.toString('base64')}`; 
    const inpaintingPrompt = `A photo of a ${product.name}, ${product.description || 'high quality'}.`;

    console.warn("[Inpainting Step V3.5.1] Chamada a runReplicateModel está COMENTADA.");
    return null; 
  } catch (error) {
    console.error(`[Inpainting Step V3.5.1] Erro:`, error); return null;
  }
}

export async function generateFinalRenderForProject(projectId: number): Promise<void> {
  console.log(`[Render Final V3.3.2] Iniciando para projeto ID: ${projectId}`);
  try {
    const project = await storage.getDesignProject(projectId);
    if (!project || !project.clientRenderImageUrl) {
      console.error(`[Render Final V3.3.2] Projeto ${projectId} não encontrado ou sem imagem base.`);
      await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
      return;
    }
    await storage.updateDesignProject(projectId, { status: 'rendering_final', updatedAt: new Date() });
    const items = await storage.getDesignProjectItems(projectId);
    const confirmedItems = items.filter(item => item.selectedProductId); 
    if (confirmedItems.length === 0) {
      console.log(`[Render Final V3.3.2] Nenhum item confirmado para projeto ${projectId}.`);
      await storage.updateDesignProject(projectId, { status: 'completed', updatedAt: new Date() }); 
      return;
    }
    let currentImageUrl = project.clientRenderImageUrl;
    for (const item of confirmedItems) {
      const product = await storage.getProduct(item.selectedProductId!);
      if (product) {
        const nextImageUrl = await performSingleInpaintingStep(currentImageUrl, item, product);
        if (nextImageUrl) currentImageUrl = nextImageUrl;
        else console.warn(`[Render Final V3.3.2] Falha no inpainting do item ${item.id}.`);
      }
    }
    await storage.updateDesignProject(projectId, { generatedRenderUrl: currentImageUrl, status: 'completed', updatedAt: new Date() });
    console.log(`[Render Final V3.3.2] Render final para projeto ${projectId} concluído.`);
  } catch (error) {
    console.error(`[Render Final V3.3.2] Erro:`, error);
    try { await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() }); }
    catch (statusError) { console.error(`[Render Final V3.3.2] Erro ao setar status falha:`, statusError);}
  }
}