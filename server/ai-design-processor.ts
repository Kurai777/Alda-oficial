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
import { type Product, type DesignProject, type NewDesignProjectItem, type DesignProjectItem } from '@shared/schema';

// Inicializar clientes de IA
// Use o mais recente modelo do OpenAI: gpt-4o que foi lançado em 13 de maio de 2024
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Use o mais recente modelo do Anthropic: claude-3-7-sonnet-20250219 que foi lançado em 24 de fevereiro de 2025
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const EMBEDDING_MODEL = 'text-embedding-3-small';

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

/**
 * Analisa UMA imagem específica (seja um render do projeto ou um anexo de chat),
 * identifica móveis, busca produtos similares no catálogo e salva os resultados como DesignProjectItems.
 * ATENÇÃO: Esta função agora recebe a URL da imagem e o texto da mensagem do usuário (opcional).
 */
export async function processDesignProjectImage(projectId: number, imageUrlToProcess: string, userMessageText?: string): Promise<void> {
  console.log(`[AI Design Processor] Iniciando processamento para projeto ID: ${projectId}, Imagem URL: ${imageUrlToProcess}`);
  let mainKeyword = null;
  let normalizedMainKeyword = null;
  let userRequestedSpecificItem = false;
  if (userMessageText) {
    console.log(`[AI Design Processor] Texto da mensagem do usuário recebido: "${userMessageText}"`);
    const keywords = ["sofá", "sofa", "poltrona", "cadeira", "mesa", "estante", "cama", "tapete", "luminária", "buffet", "aparador", "pintura", "quadro"];
    const normalizedUserMessage = normalizeText(userMessageText);
    for (const kw of keywords) {
      const normalizedKw = normalizeText(kw);
      if (normalizedUserMessage.includes(normalizedKw)) {
        mainKeyword = kw;
        normalizedMainKeyword = normalizedKw;
        userRequestedSpecificItem = true;
        console.log(`[AI Design Processor] Palavra-chave de foco detectada: "${mainKeyword}" (normalizada: "${normalizedMainKeyword}")`);
        break;
      }
    }
  }

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

    console.log(`[AI Design Processor] Analisando imagem: ${imageUrlToProcess}`);
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o", 
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analise esta imagem de um ambiente. Identifique os principais móveis (como sofás, mesas, cadeiras, estantes, camas, etc.). Para cada móvel identificado, forneça:
                     1. Um 'name' curto e genérico do tipo de móvel (ex: 'Sofá', 'Mesa de Centro', 'Cadeira', 'Tapete').
                     2. Uma 'description' detalhada (estilo, cor principal, material aparente, características marcantes).
                     3. Opcional: 'bounding_box' (formato: { x_min, y_min, x_max, y_max } com valores percentuais ou em pixels).
                     Responda em formato JSON, com uma lista chamada 'identified_furniture', onde cada item da lista é um objeto com as chaves 'name', 'description' e 'bounding_box' (se disponível).
                     Exemplo de item na lista: { "name": "Sofá", "description": "Sofá de canto grande em tecido cinza escuro, estilo contemporâneo", "bounding_box": { "x_min": 10, "y_min": 40, "x_max": 60, "y_max": 80 } }`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrlToProcess }, 
            },
          ],
        },
      ],
      max_tokens: 1500, 
      response_format: { type: "json_object" }, 
    });

    const messageContent = visionResponse.choices[0]?.message?.content;
    if (!messageContent) throw new Error("Resposta da API Vision vazia ou inválida.");
    console.log("[AI Design Processor] Resposta da API Vision recebida.");

    let identifiedFurniture: { name: string; description: string; bounding_box?: any }[] = [];
    try {
      const parsedJson = JSON.parse(messageContent);
      if (parsedJson && Array.isArray(parsedJson.identified_furniture)) {
        identifiedFurniture = parsedJson.identified_furniture.map((item: any) => ({
          description: item.description, 
          bounding_box: item.bounding_box, 
          name: item.name || item.description?.split(' ')[0] || 'Móvel' 
        }));
        console.log(`[AI Design Processor] ${identifiedFurniture.length} móveis identificados pela IA.`);
      } else {
        console.warn("[AI Design Processor] Formato JSON inesperado da API Vision:", messageContent);
      }
    } catch (parseError) {
      console.error("[AI Design Processor] Erro ao parsear JSON da API Vision:", parseError, "Conteúdo:", messageContent);
      throw new Error("Falha ao parsear resposta da IA.");
    }

    const createdItemsWithSuggestions: { detectedName: string, suggestedProduct: Product | null }[] = [];
    let focusedItemsOutput: { detectedName: string, suggestedProduct: Product | null }[] = [];

    if (identifiedFurniture.length > 0) {
      console.log(`[AI Design Processor] Buscando produtos similares para ${identifiedFurniture.length} móveis...`);
      for (const furniture of identifiedFurniture) {
        if (!furniture.description || !furniture.name) continue;

        // Busca textual (como antes)
        const relevantProductsTextual = await storage.findRelevantProducts(project.userId, furniture.description);
        console.log(`[AI Design Processor] Para "${furniture.name}" (busca textual), encontrados ${relevantProductsTextual.length} produtos relevantes.`);

        // --- NOVA LÓGICA DE EMBEDDING ---
        let similarProductsFromEmbedding: Product[] = [];
        try {
          console.log(`   Gerando embedding para a DESCRIÇÃO do móvel detectado: "${furniture.description.substring(0,50)}..."`);
          const descriptionEmbeddingResponse = await openai.embeddings.create({
            model: EMBEDDING_MODEL, // Usando o mesmo modelo que para os produtos
            input: furniture.description,
          });
          const descriptionEmbeddingVector = descriptionEmbeddingResponse.data[0]?.embedding;

          if (descriptionEmbeddingVector) {
            console.log(`   Embedding da descrição obtido. Chamando findProductsByEmbedding...`);
            similarProductsFromEmbedding = await storage.findProductsByEmbedding(project.userId, descriptionEmbeddingVector, 5); // Pega até 5 similares
            console.log(`   [Embedding Search] Para "${furniture.name}", encontrados ${similarProductsFromEmbedding.length} produtos por similaridade de embedding da descrição.`);
            if (similarProductsFromEmbedding.length > 0) {
              // console.log("      Produtos por embedding (IDs):", similarProductsFromEmbedding.map(p => p.id));
            }
          } else {
            console.warn(`   Não foi possível gerar embedding para a descrição do móvel: ${furniture.name}`);
          }
        } catch (embeddingError) {
          console.error(`   Erro ao gerar/buscar embedding para descrição de "${furniture.name}":`, embeddingError);
        }
        // --- FIM DA NOVA LÓGICA DE EMBEDDING ---

        // Por enquanto, continuamos usando relevantProductsTextual para as sugestões principais e DesignProjectItem
        const productsToSuggest = relevantProductsTextual; // Poderíamos combinar/priorizar no futuro

        const newItemData: NewDesignProjectItem = {
          designProjectId: projectId,
          detectedObjectDescription: furniture.description,
          detectedObjectBoundingBox: furniture.bounding_box || null,
          suggestedProductId1: productsToSuggest[0]?.id || null, 
          matchScore1: productsToSuggest[0] ? 1.0 : null, 
          suggestedProductId2: productsToSuggest[1]?.id || null, 
          matchScore2: productsToSuggest[1] ? 1.0 : null, 
          suggestedProductId3: productsToSuggest[2]?.id || null, 
          matchScore3: productsToSuggest[2] ? 1.0 : null, 
          userFeedback: 'pending', 
        };

        try {
          const createdItem = await storage.createDesignProjectItem(newItemData);
          console.log(`[AI Design Processor] Item de design criado para "${furniture.name}", ID: ${createdItem.id}`);
          
          const mainSuggestedProduct = productsToSuggest[0] ? await storage.getProduct(productsToSuggest[0].id) : null;
          const itemResult = { detectedName: furniture.name, suggestedProduct: mainSuggestedProduct || null };
          createdItemsWithSuggestions.push(itemResult);

          if (normalizedMainKeyword && furniture.name && 
              (normalizeText(furniture.name).includes(normalizedMainKeyword) || 
               (furniture.description && normalizeText(furniture.description).includes(normalizedMainKeyword))) ) {
            focusedItemsOutput.push(itemResult);
          }
        } catch (dbError) {
          console.error(`[AI Design Processor] Erro ao salvar DesignProjectItem para "${furniture.name}":`, dbError);
        }
      }
      console.log("[AI Design Processor] Processamento de itens de design concluído.");
    } else {
      console.log("[AI Design Processor] Nenhum móvel identificado pela IA ou falha no parse.");
      await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: "Não consegui identificar móveis nesta imagem. Você pode tentar outra imagem ou descrever o que procura?" });
    }

    let chatMessageContent = "";
    let itemsToDisplayInChatMessage: typeof createdItemsWithSuggestions = [];

    if (userRequestedSpecificItem) {
        if (focusedItemsOutput.length > 0) {
            itemsToDisplayInChatMessage = focusedItemsOutput;
            chatMessageContent = `Analisei a imagem que você enviou, focando em encontrar '${mainKeyword}'. Veja o que encontrei para '${mainKeyword}':\n`;
        } else {
            chatMessageContent = `Você pediu por '${mainKeyword}', mas não identifiquei esse item específico na imagem ou não encontrei sugestões para ele.`;
        }
    } else {
        itemsToDisplayInChatMessage = createdItemsWithSuggestions;
        if (itemsToDisplayInChatMessage.length > 0) {
            chatMessageContent = "Analisei a imagem que você enviou! Veja o que encontrei:\n";
        } else if (identifiedFurniture.length > 0) {
            chatMessageContent = "Analisei a imagem e identifiquei alguns objetos, mas não encontrei sugestões correspondentes no catálogo no momento.";
        } else {
            chatMessageContent = ""; 
        }
    }

    if (itemsToDisplayInChatMessage.length > 0 && chatMessageContent) {
        for (const item of itemsToDisplayInChatMessage) {
            chatMessageContent += `\nPara o item detectado '${item.detectedName}':\n`;
            if (item.suggestedProduct && item.suggestedProduct.imageUrl && item.suggestedProduct.name) {
                chatMessageContent += `Sugiro: ${item.suggestedProduct.name}\n![${item.suggestedProduct.name}](${item.suggestedProduct.imageUrl})\n`;
            } else {
                chatMessageContent += "Não encontrei uma sugestão clara no catálogo para este item.\n";
            }
        }
        chatMessageContent += "\nVocê pode ver mais detalhes e ajustar as sugestões na interface do projeto.";
    }

    if (chatMessageContent.trim() !== "") {
        await storage.createAiDesignChatMessage({ projectId, role: "assistant", content: chatMessageContent });
    }

    if (imageUrlToProcess === project.clientRenderImageUrl) {
        let projectStatusAfterProcessing: DesignProject['status'] = 'completed';
        if (identifiedFurniture.length === 0) {
            projectStatusAfterProcessing = 'processed_no_items';
        } else if (itemsToDisplayInChatMessage.length > 0) {
            projectStatusAfterProcessing = 'awaiting_selection';
        } else if (userRequestedSpecificItem && focusedItemsOutput.length === 0) {
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
  }
}

// Se houver mais código depois desta função no arquivo, ele deve ser preservado.
// Se esta for a última função, o arquivo termina aqui.