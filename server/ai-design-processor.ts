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
import { type Product, type DesignProject, type NewDesignProjectItem, type DesignProjectItem, type AiDesignChatMessage } from '@shared/schema';
import { getClipEmbeddingFromImageUrl } from './clip-service';
import { broadcastToProject } from './index';
import sharp from 'sharp';
import { runReplicateModel } from './replicate-service';

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

function normalizeText(text: string): string {
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
  console.log(`[AI Design Processor] Iniciando processamento para projeto ID: ${projectId}, Imagem URL: ${imageUrlToProcess}`);
  
  let createdItemsWithSuggestions: { detectedName: string, suggestedProduct: Product | null }[] = [];
  let focusedItemsOutputFromTextSearch: { detectedName: string, suggestedProduct: Product | null }[] = [];

  let mainKeyword: string | null = null;
  let normalizedMainKeyword: string | null = null;
  let userRequestedSpecificItem = false;

  if (userMessageText) {
    console.log(`[DEBUG] User Message Text: "${userMessageText}"`);
    const keywords = FURNITURE_KEYWORDS; // Usar a constante definida no topo
    const localNormalizedUserMessage = normalizeText(userMessageText); // Renomeado para evitar conflito de escopo
    for (const kw of keywords) {
      const normalizedKw = normalizeText(kw);
      if (localNormalizedUserMessage.includes(normalizedKw)) {
        mainKeyword = kw;
        normalizedMainKeyword = normalizedKw;
        userRequestedSpecificItem = true;
        console.log(`[DEBUG] Keyword de foco detectada: "${mainKeyword}" (normalizada: "${normalizedMainKeyword}")`);
        break;
      }
    }
  } else {
    console.log("[DEBUG] Sem userMessageText fornecido.");
  }
  console.log(`[DEBUG] userRequestedSpecificItem: ${userRequestedSpecificItem}, mainKeyword: ${mainKeyword}`);

  if (!openai) {
    console.error('[AI Design Processor] Chave da API OpenAI não configurada.');
    throw new Error("OpenAI API Key not configured");
  }

  try {
    const project = await storage.getDesignProject(projectId);
    if (!project) {
      console.error(`[AI Design Processor] Projeto ${projectId} não encontrado.`);
      return; 
    }

    if (imageUrlToProcess === project.clientRenderImageUrl) {
        await storage.updateDesignProject(projectId, { status: 'processing', updatedAt: new Date() });
        console.log(`[AI Design Processor] Status do projeto ${projectId} (render principal) atualizado para processing.`);
    } else {
        console.log(`[AI Design Processor] Processando imagem de anexo (${imageUrlToProcess}), status do projeto ${projectId} não alterado diretamente por esta função.`);
    }

    console.log(`[AI Design Processor] Analisando imagem com GPT-4o: ${imageUrlToProcess}`);
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o", 
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analise esta imagem de um ambiente. 
                     1. Forneça uma 'overall_image_description' detalhada da imagem como um todo, incluindo estilo geral do ambiente (ex: contemporâneo, minimalista, industrial, boho, clássico), paleta de cores predominantes, tipos de materiais visíveis (ex: madeira clara, metal escuro, veludo, linho), iluminação (ex: natural abundante, artificial quente), atmosfera (ex: aconchegante, formal, vibrante) e quaisquer objetos ou características marcantes que definam a "vibe" da imagem.
                     2. Identifique os principais móveis (como sofás, mesas, cadeiras, estantes, camas, tapetes, luminárias). Para cada móvel identificado, forneça:
                        a. Um 'name' curto e genérico do tipo de móvel (ex: 'Sofá', 'Mesa de Centro', 'Cadeira', 'Tapete').
                        b. Uma 'description' detalhada do móvel (estilo, cor principal, material aparente, forma, características marcantes).
                        c. Opcional: 'bounding_box' (formato: { x_min, y_min, x_max, y_max } com valores percentuais ou em pixels).
                     Responda em formato JSON, com uma chave 'overall_image_description' (string) e uma lista chamada 'identified_furniture' (array de objetos com chaves 'name', 'description', 'bounding_box').
                     Exemplo de JSON: { "overall_image_description": "Sala de estar contemporânea com sofá cinza, muita luz natural, piso de madeira clara e detalhes em metal preto. Atmosfera calma e elegante.", "identified_furniture": [{ "name": "Sofá", "description": "Sofá de canto grande em tecido cinza escuro, estilo contemporâneo", "bounding_box": { "x_min": 10, "y_min": 40, "x_max": 60, "y_max": 80 } }] }`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrlToProcess }, 
            },
          ],
        },
      ],
      max_tokens: 2000, // Aumentado para acomodar descrição mais detalhada
      response_format: { type: "json_object" }, 
    });

    const messageContent = visionResponse.choices[0]?.message?.content;
    if (!messageContent) throw new Error("Resposta da API Vision vazia ou inválida.");
    console.log("[AI Design Processor] Resposta da API Vision recebida.");

    let overallImageDescription: string | null = null;
    let identifiedFurniture: { name: string; description: string; bounding_box?: any }[] = [];
    try {
      const parsedJson = JSON.parse(messageContent);
      if (parsedJson && parsedJson.overall_image_description) {
        overallImageDescription = parsedJson.overall_image_description;
        if (overallImageDescription) {
          console.log(`[DEBUG] Descrição geral da imagem: "${overallImageDescription.substring(0,100)}..."`);
        }
      }
      if (parsedJson && Array.isArray(parsedJson.identified_furniture)) {
        identifiedFurniture = parsedJson.identified_furniture.map((item: any) => ({
          description: item.description, 
          bounding_box: item.bounding_box, 
          name: item.name || item.description?.split(' ')[0] || 'Móvel' 
        }));
        console.log(`[DEBUG] ${identifiedFurniture.length} móveis identificados pela IA.`);
      } else {
        console.warn("[DEBUG] Formato JSON inesperado da API Vision (furniture ou overall description ausente):", messageContent);
      }
    } catch (parseError) {
      console.error("[DEBUG] Erro ao parsear JSON da API Vision:", parseError, "Conteúdo:", messageContent);
      throw new Error("Falha ao parsear resposta da IA.");
    }

    // --- BUSCA VISUAL GLOBAL (Embedding da imagem inteira) --- (RESTAURANDO ESTA SEÇÃO)
    let similarProductsVisual: (Product & { distance?: number })[] = [];
    let visualImageEmbeddingVector: number[] | null = null;

    if (project && project.userId) {
      try {
          console.log('[AI Design Processor] Gerando embedding visual da imagem inteira via CLIP Service local...');
          visualImageEmbeddingVector = await getClipEmbeddingFromImageUrl(imageUrlToProcess, undefined);
          if (visualImageEmbeddingVector && visualImageEmbeddingVector.length > 0) {
              similarProductsVisual = await storage.findProductsByEmbedding(project.userId, visualImageEmbeddingVector, 10); 
              console.log(`[AI Design Processor] [Visual Embedding Search - Imagem Inteira] Encontrados ${similarProductsVisual.length} produtos.`);
              if (similarProductsVisual.length > 0) {
                console.log("     Produtos Visuais (Imagem Inteira) Encontrados (com distância):");
                similarProductsVisual.forEach(p => {
                  console.log(`       - ID: ${p.id}, Nome: ${p.name}, Código: ${p.code || 'N/A'}, Distância: ${p.distance?.toFixed(4) || 'N/A'}`);
                });
              }
          } else {
            console.warn('[AI Design Processor] Não foi possível gerar embedding visual da imagem inteira (vetor nulo ou vazio).');
          }
      } catch (err) {
          console.error('[AI Design Processor] Erro ao gerar/buscar embedding visual da imagem inteira:', err);
      }
    } else {
      console.error('[AI Design Processor] project.userId não encontrado para a busca por embedding visual da imagem inteira.');
    }
    // --- FIM DA BUSCA VISUAL GLOBAL ---

    // Certificar que a pasta temp existe
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(tempDir)){
        try {
          fs.mkdirSync(tempDir, { recursive: true });
          console.log(`[AI Design Processor] Diretório temporário criado em: ${tempDir}`);
        } catch (mkdirErr) {
          console.error(`[AI Design Processor] Erro ao criar diretório temporário ${tempDir}:`, mkdirErr);
        }
    }

    createdItemsWithSuggestions = []; 
    focusedItemsOutputFromTextSearch = [];

    // Obter dimensões da imagem base UMA VEZ se formos processar por região
    let baseImageMetadata: sharp.Metadata | undefined;
    let baseImageBuffer: Buffer | undefined;
    if (identifiedFurniture.length > 0) {
      try {
        baseImageBuffer = await fetchImageAsBuffer(imageUrlToProcess);
        baseImageMetadata = await sharp(baseImageBuffer).metadata();
      } catch (err) {
        console.error(`[AI Design Processor] Erro ao buscar ou ler metadados da imagem base ${imageUrlToProcess}:`, err);
      }
    }

    // Loop através de cada móvel identificado pela IA de visão
    if (identifiedFurniture.length > 0) {
      console.log(`[AI Design Processor] Processando ${identifiedFurniture.length} móveis identificados...`);
      for (const furniture of identifiedFurniture) {
        if (!furniture.description || !furniture.name) {
          console.warn(`[AI Design Processor] Móvel sem nome ou descrição, pulando: `, furniture);
          continue;
        }

        let collectedSuggestions: (Product & { distance?: number; relevance?: number; source: string })[] = [];
        const normalizedFurnitureName = normalizeText(furniture.name);
        console.log(`[AI Proc] ---- Processando item: ${furniture.name} (Normalizado: ${normalizedFurnitureName}) ----`);

        // 1. BUSCA VISUAL POR REGIÃO (Prioridade Alta)
        if (furniture.bounding_box && baseImageMetadata?.width && baseImageMetadata?.height && baseImageBuffer) {
          const pixelBbox = await calculatePixelBbox(furniture.bounding_box, baseImageMetadata.width, baseImageMetadata.height);
          if (pixelBbox && pixelBbox.w > 20 && pixelBbox.h > 20) { // BBox válida e com tamanho mínimo
            let tempFilePath: string | undefined;
            try {
              const regionBuffer = await sharp(baseImageBuffer)
                .extract({ left: pixelBbox.x, top: pixelBbox.y, width: pixelBbox.w, height: pixelBbox.h })
                .png()
                .toBuffer();
              tempFilePath = path.join(tempDir, `region_${projectId}_${furniture.name.replace(/\s+/g, '_')}_${Date.now()}.png`);
              fs.writeFileSync(tempFilePath, regionBuffer);
              const regionEmbedding = await getClipEmbeddingFromImageUrl(tempFilePath, undefined);

              if (regionEmbedding && regionEmbedding.length > 0 && project?.userId) {
                const visualRegionResults = await storage.findProductsByEmbedding(project.userId, regionEmbedding, 5);
                if (visualRegionResults.length > 0) {
                  console.log(`[AI Proc] Região "${furniture.name}": ${visualRegionResults.length} resultados visuais brutos.`);
                  const filteredByRegionType = visualRegionResults.filter(p =>
                    (p.category && normalizeText(p.category).includes(normalizedFurnitureName)) ||
                    (p.name && normalizeText(p.name).includes(normalizedFurnitureName))
                  );
                  if (filteredByRegionType.length > 0) {
                    collectedSuggestions.push(...filteredByRegionType.map(p => ({ ...p, source: 'visual_region_filtered' })));
                    console.log(`[AI Proc] Região "${furniture.name}": ${filteredByRegionType.length} filtrados por tipo.`);
                  } else {
                    // Adiciona os não filtrados da região como BAIXA PRIORIDADE se o filtro forte falhou
                    // MAS SÓ SE A CATEGORIA DETECTADA EXISTIR NO CATÁLOGO DO USUÁRIO
                    const userCategories = await storage.getProductCategoriesForUser(project.userId); 
                    const normalizedDetectedCategoryForLog = normalizeText(furniture.name); // Para log
                    if (userCategories.some(cat => normalizeText(cat).includes(normalizedDetectedCategoryForLog))) {
                        collectedSuggestions.push(...visualRegionResults.slice(0, 1).map(p => ({ ...p, source: 'visual_region_unfiltered' }))); 
                        console.log(`[AI Proc] Região "${furniture.name}": Filtro de tipo falhou, mas categoria '${normalizedDetectedCategoryForLog}' existe no catálogo. Adicionando ${visualRegionResults.slice(0, 1).length} não filtrado (baixa prioridade).`);
                    } else {
                        console.log(`[AI Proc] Região "${furniture.name}": Filtro de tipo falhou E categoria '${normalizedDetectedCategoryForLog}' NÃO encontrada no catálogo do usuário. Pulando fallback não filtrado para esta região.`);
                    }
                  }
                }
              }
            } catch (regionError) {
              console.error(`[AI Proc] Erro processando região para "${furniture.name}":`, regionError);
            } finally {
              if (tempFilePath && fs.existsSync(tempFilePath)) { try { fs.unlinkSync(tempFilePath); } catch (e) { console.warn('Falha ao remover temp ' + tempFilePath)} }
            }
          } else {
            console.log(`[AI Proc] BBox para "${furniture.name}" inválida ou pequena (w:${pixelBbox?.w}, h:${pixelBbox?.h}), pulando busca por região.`);
          }
        }

        // 2. BUSCA VISUAL GLOBAL (Prioridade Média)
        const highQualityVisualSuggestionsCount = collectedSuggestions.filter(s => s.source === 'visual_region_filtered').length;
        if (highQualityVisualSuggestionsCount < 2 && similarProductsVisual && similarProductsVisual.length > 0 && project?.userId) {
          const globalVisualFiltered = similarProductsVisual.filter(p =>
            (p.category && normalizeText(p.category).includes(normalizedFurnitureName)) ||
            (p.name && normalizeText(p.name).includes(normalizedFurnitureName))
          );
          if (globalVisualFiltered.length > 0) {
            console.log(`[AI Proc] Global Filtrado para "${furniture.name}": ${globalVisualFiltered.length} resultados.`);
            globalVisualFiltered.forEach(p_global => {
              if (!collectedSuggestions.find(ex => ex.id === p_global.id)) {
                collectedSuggestions.push({ ...p_global, source: 'visual_global_filtered' });
                }
            });
          }
        }

        // 3. BUSCA TEXTUAL FTS (Prioridade Baixa / Complementar)
        const currentFilteredVisualCount = collectedSuggestions.filter(s => s.source.endsWith('_filtered')).length;
        if (currentFilteredVisualCount < 2) { 
          const ftsSearchInput = `${furniture.name} ${furniture.description}`;
          console.log(`[AI Proc] Poucas sugestões visuais filtradas (${currentFilteredVisualCount}). Recorrendo à FTS para "${furniture.name}" com input: "${ftsSearchInput.substring(0, 100)}...".`);
          const textualResults = await storage.findRelevantProducts(project.userId, ftsSearchInput);
          
          if (textualResults.length > 0) {
            console.log(`[AI Proc] FTS para "${furniture.name}" encontrou ${textualResults.length} resultados brutos.`);
            
            const normalizedFurnitureNameForFilter = normalizeText(furniture.name);
            const filteredTextualResults = textualResults.filter(p =>
              (p.category && normalizeText(p.category).includes(normalizedFurnitureNameForFilter)) ||
              (p.name && normalizeText(p.name).includes(normalizedFurnitureNameForFilter))
            );

            if (filteredTextualResults.length > 0) {
              console.log(`[AI Proc] FTS para "${furniture.name}": ${filteredTextualResults.length} resultados APÓS FILTRO DE CATEGORIA.`);
              filteredTextualResults.forEach(p_text => {
                if (!collectedSuggestions.find(ex => ex.id === p_text.id)) {
                  collectedSuggestions.push({ ...p_text, source: 'textual_fts_filtered' }); 
                }
              });
            } else {
              console.log(`[AI Proc] FTS para "${furniture.name}": Nenhum resultado após filtro de categoria.`);
            }
          }
        }
        
        // 4. Ordenar e Selecionar as Top N sugestões
        collectedSuggestions.sort((a, b) => {
            const sourcePriority: Record<string, number> = {
                'visual_region_filtered': 1,
                'visual_global_filtered': 2,
                'textual_fts_filtered': 3, // Prioridade ajustada
                'visual_region_unfiltered': 4, 
                'textual_fts': 5 // FTS não filtrada teria prioridade ainda menor (não estamos usando agora)
            };
            if (sourcePriority[a.source] !== sourcePriority[b.source]) {
                return sourcePriority[a.source] - sourcePriority[b.source];
            }
            if (a.source.startsWith('visual')) { 
                return (a.distance || Infinity) - (b.distance || Infinity);
            } else if (a.source.startsWith('textual_fts')) { // cobre _filtered
                return (b.relevance || 0) - (a.relevance || 0); 
            }
            return 0;
        });

        const finalUniqueSuggestions: (Product & { distance?: number; relevance?: number; source: string })[] = [];
        const seenIds = new Set<number>();
        for (const sug of collectedSuggestions) {
            if (!seenIds.has(sug.id)) {
                finalUniqueSuggestions.push(sug);
                seenIds.add(sug.id);
            }
            if (finalUniqueSuggestions.length >= 3) break;
        }
        
        console.log(`[AI Proc] SUGESTÕES FINAIS para "${furniture.name}" (${finalUniqueSuggestions.length} produtos):`,
          finalUniqueSuggestions.map(p => ({ id: p.id, name: p.name, source: p.source, score: p.distance ?? p.relevance }))
        );

        const newItemData: NewDesignProjectItem = {
          designProjectId: projectId,
          detectedObjectName: furniture.name,
          detectedObjectDescription: furniture.description,
          detectedObjectBoundingBox: furniture.bounding_box || null,
          suggestedProductId1: finalUniqueSuggestions[0]?.id || null,
          matchScore1: finalUniqueSuggestions[0] ? (finalUniqueSuggestions[0].distance ?? finalUniqueSuggestions[0].relevance ?? 0) : null,
          suggestedProductId2: finalUniqueSuggestions[1]?.id || null,
          matchScore2: finalUniqueSuggestions[1] ? (finalUniqueSuggestions[1].distance ?? finalUniqueSuggestions[1].relevance ?? 0) : null,
          suggestedProductId3: finalUniqueSuggestions[2]?.id || null,
          matchScore3: finalUniqueSuggestions[2] ? (finalUniqueSuggestions[2].distance ?? finalUniqueSuggestions[2].relevance ?? 0) : null,
          userFeedback: 'pending',
        };

        try {
          const createdItem = await storage.createDesignProjectItem(newItemData);
          console.log(`[AI Proc] Item de Design salvo para "${furniture.name}", ID: ${createdItem.id}, Sugestão 1: ${finalUniqueSuggestions[0]?.name || 'N/A'} (Fonte: ${finalUniqueSuggestions[0]?.source || 'N/A'})`);
        } catch (dbError) {
          console.error(`[AI Proc] Erro ao salvar DesignProjectItem para "${furniture.name}":`, dbError);
        }
      } // Fim do loop for (const furniture of identifiedFurniture)
      console.log(`[AI Design Processor] Processamento de ${identifiedFurniture.length} itens de design concluído.`);
    } else if (similarProductsVisual && similarProductsVisual.length === 0 && identifiedFurniture.length === 0) { 
        console.log("[DEBUG] Nenhum móvel identificado pela IA e nenhuma sugestão global (imagem inteira) encontrada.");
        await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: "Não consegui identificar móveis específicos nem encontrar sugestões gerais para esta imagem. Você pode tentar outra imagem ou descrever o que procura?" });
    }

    // Montar a mensagem de chat (REFINADA)
    let chatMessageContent = "";
    let hasContent = false;
    const MAX_DISTANCE_THRESHOLD = 15.0; 

    let productsWithinThreshold: (Product & { distance: number; source?: string })[] = [];
    if (similarProductsVisual.length > 0) {
        productsWithinThreshold = similarProductsVisual
            .filter(p => p.distance !== undefined && p.distance !== null && p.distance <= MAX_DISTANCE_THRESHOLD)
            .map(p => ({ ...p, distance: p.distance!, source: 'visual' }))
            .sort((a, b) => a.distance - b.distance);
    }
    
    let finalSuggestionsToShow = productsWithinThreshold.slice(0, 3);
    let introMessage = "";
    let foundFocusedItemVisually = false;

    if (userRequestedSpecificItem && mainKeyword && productsWithinThreshold.length > 0) {
        const normalizedQueryKeyword = normalizeText(mainKeyword);
        const focusedSuggestionsFromVisual = productsWithinThreshold.filter(p => 
            (p.category && normalizeText(p.category).includes(normalizedQueryKeyword)) ||
            (p.name && normalizeText(p.name).includes(normalizedQueryKeyword))
        );
        
        if (focusedSuggestionsFromVisual.length > 0) {
            // Se encontrou o item focado visualmente, essa será a introdução (ou podemos omiti-la)
            // introMessage = `Sugestões para '${mainKeyword}' com base na imagem:\n`;
            finalSuggestionsToShow = focusedSuggestionsFromVisual.slice(0, 3);
            foundFocusedItemVisually = true;
        } else {
            // Não encontrou o item focado visualmente, mas há sugestões visuais gerais
            // introMessage = `Não encontrei '${mainKeyword}' com alta similaridade visual, mas estas são algumas sugestões gerais da imagem:\n`;
        }
    } else if (productsWithinThreshold.length > 0) {
        // introMessage = `Sugestões com base na imagem:\n`;
    } // Se não houver introMessage, as sugestões serão listadas diretamente.

    if (finalSuggestionsToShow.length > 0) {
        if (introMessage) chatMessageContent += introMessage;
        finalSuggestionsToShow.forEach((product, index) => {
            chatMessageContent += `\n**${product.name}** (Ref: ${product.code || 'N/A'}`;
            if (product.source === 'visual') {
                 chatMessageContent += `, Distância Visual: ${product.distance?.toFixed(4) || 'N/A'}`;
            }
            chatMessageContent += `)\n`;
            if (product.imageUrl) {
                chatMessageContent += `  ![${product.name}](${product.imageUrl})\n`;
            }
            if (product.description) {
                 // Descrição mais curta e objetiva
                const shortDesc = product.description.split(/[\.\r\n]+/)[0]; // Pega a primeira frase ou linha
                chatMessageContent += `  *${shortDesc}${shortDesc.length < product.description.length ? '...' : ''}*\n`;
            }
        });
        // Opcional: Adicionar mensagem sobre mais sugestões se houver mais do que 3
        // if (productsWithinThreshold.length > finalSuggestionsToShow.length) {
        //      chatMessageContent += `\n  (... e mais ${productsWithinThreshold.length - finalSuggestionsToShow.length} sugestões encontradas com boa similaridade visual)\n`;
        // }
        chatMessageContent += "\n---\n";
        hasContent = true;
    }

    // Lógica para sugestões textuais (REFINADA)
    // Só adiciona textual se o item focado NÃO foi encontrado visualmente E há sugestões textuais para ele.
    if (userRequestedSpecificItem && mainKeyword && !foundFocusedItemVisually && focusedItemsOutputFromTextSearch.length > 0) {
        const textualSuggestion = focusedItemsOutputFromTextSearch.find(item => 
            (item.detectedName && normalizeText(item.detectedName).includes(normalizeText(mainKeyword))) ||
            (item.suggestedProduct?.category && normalizeText(item.suggestedProduct.category).includes(normalizeText(mainKeyword))) ||
            (item.suggestedProduct?.name && normalizeText(item.suggestedProduct.name).includes(normalizeText(mainKeyword)))
        );

        if (textualSuggestion && textualSuggestion.suggestedProduct) {
            chatMessageContent += `\nNão encontrei '${mainKeyword}' com alta similaridade visual, mas achei este aqui por texto:\n`;
            chatMessageContent += `  **${textualSuggestion.suggestedProduct.name}** (Ref: ${textualSuggestion.suggestedProduct.code || 'N/A'})\n`;
            if (textualSuggestion.suggestedProduct.imageUrl) {
                chatMessageContent += `    ![${textualSuggestion.suggestedProduct.name}](${textualSuggestion.suggestedProduct.imageUrl})\n`;
            }
            const shortDesc = textualSuggestion.suggestedProduct.description?.split(/[\.\r\n]+/)[0];
            if (shortDesc) {
                 chatMessageContent += `  *${shortDesc}${shortDesc.length < (textualSuggestion.suggestedProduct.description?.length || 0) ? '...' : ''}*\n`;
            }
            hasContent = true; 
        }
    }
    
    // Mensagens de Fallback (se não houve nenhuma sugestão visual ou textual focada)
    if (!hasContent) {
      if (userRequestedSpecificItem && mainKeyword) {
        chatMessageContent = `Desculpe, não encontrei nenhuma sugestão para '${mainKeyword}' com base na imagem ou por busca textual.`;
      } else if (identifiedFurniture.length > 0 && similarProductsVisual.length === 0) { 
        chatMessageContent = "Analisei a imagem e identifiquei alguns móveis, mas não encontrei produtos visualmente similares no catálogo.";
      } else if (identifiedFurniture.length === 0 && similarProductsVisual.length === 0) {
        chatMessageContent = "Não consegui identificar móveis específicos nem encontrar sugestões visuais para esta imagem. Você pode tentar outra imagem ou descrever o que procura?";
      } else {
        chatMessageContent = "Não consegui encontrar sugestões para esta imagem. Você pode tentar outra ou descrever melhor o que procura?";
      }
      hasContent = true; 
    }

    console.log(`[DEBUG] FINAL chatMessageContent antes de enviar: "${chatMessageContent.substring(0, 200)}..."`);

    if (chatMessageContent.trim() !== "" && hasContent) { 
        const newAiMessage = await storage.createAiDesignChatMessage({ 
            projectId,
            role: "assistant", 
            content: chatMessageContent 
        });
        // ADICIONADO: Enviar a nova mensagem via WebSocket
        if (newAiMessage) {
            console.log(`[AI Design Processor] Enviando nova mensagem AI via WebSocket para projeto ${projectId}`);
            broadcastToProject(projectId.toString(), { 
                type: 'NEW_AI_MESSAGE', 
                payload: newAiMessage 
            });
        }
    }

    if (imageUrlToProcess === project.clientRenderImageUrl) {
        let projectStatusAfterProcessing: DesignProject['status'] = 'completed';
        if (identifiedFurniture.length === 0) {
            projectStatusAfterProcessing = 'processed_no_items';
        } else if (focusedItemsOutputFromTextSearch.length > 0) {
            projectStatusAfterProcessing = 'awaiting_selection';
        } else if (userRequestedSpecificItem && finalSuggestionsToShow.length === 0) {
            projectStatusAfterProcessing = 'processed_no_match_for_focus';
        }
        await storage.updateDesignProject(projectId, { status: projectStatusAfterProcessing, updatedAt: new Date() });
        console.log(`[AI Design Processor] Status final do projeto ${projectId} (render principal) atualizado para ${projectStatusAfterProcessing}.`);
    }
    
    console.log(`[AI Design Processor] Processamento da imagem de anexo ${imageUrlToProcess} para projeto ${projectId} concluído.`);

  } catch (error) {
    console.error(`[AI Design Processor] Erro GERAL no processamento da imagem para projeto ${projectId}:`, error);
    try {
      const projectForStatus = await storage.getDesignProject(projectId);
      if (projectForStatus && imageUrlToProcess === projectForStatus.clientRenderImageUrl) {
        await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
      }
      await storage.createAiDesignChatMessage({
        projectId: projectId,
        role: "assistant",
        content: `Desculpe, ocorreu um erro ao tentar analisar a imagem que você enviou. Detalhes do erro: ${error instanceof Error ? error.message : String(error)}`
      });
    } catch (nestedError) {
      console.error(`[AI Design Processor] Erro CRÍTICO ao tentar lidar com erro anterior ou atualizar status para falha (Projeto ${projectId}):`, nestedError);
    }
    // Considerar enviar uma mensagem de erro via WebSocket também, se apropriado
    broadcastToProject(projectId.toString(), { 
        type: 'PROCESSING_ERROR', 
        payload: { message: error instanceof Error ? error.message : String(error) } 
    });
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