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

    const textContent = response.content[0]?.text ?? '';
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

    const textContent = response.content[0]?.text ?? '';
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

/**
 * Analisa a imagem de um projeto de design, identifica móveis, 
 * busca produtos similares no catálogo e salva os resultados.
 */
export async function processDesignProjectImage(projectId: number): Promise<void> {
  console.log(`[AI Design Processor] Iniciando processamento para projeto ID: ${projectId}`);

  if (!openai) {
    console.error('[AI Design Processor] Chave da API OpenAI não configurada.');
    await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
    throw new Error("OpenAI API Key not configured");
  }

  try {
    // 1. Buscar dados do projeto
    const project = await storage.getDesignProject(projectId);
    if (!project || !project.clientRenderImageUrl) {
      console.error(`[AI Design Processor] Projeto ${projectId} ou URL da imagem não encontrado(a).`);
      // Atualiza status para falha se não achou o projeto
      if (!project) await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
      return; // Não pode continuar sem imagem
    }

    // Atualizar status para 'processing'
    await storage.updateDesignProject(projectId, { status: 'processing', updatedAt: new Date() });
    console.log(`[AI Design Processor] Status do projeto ${projectId} atualizado para processing.`);

    // 2. Chamar OpenAI Vision API
    console.log(`[AI Design Processor] Analisando imagem: ${project.clientRenderImageUrl}`);
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o", // Usando o modelo mais recente
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analise esta imagem de um ambiente. Identifique os principais móveis (como sofás, mesas, cadeiras, estantes, camas, etc.). Para cada móvel identificado, forneça:
                     1. Uma descrição detalhada (tipo de móvel, estilo, cor principal, material aparente, características marcantes).
                     2. Opcional: Se possível, as coordenadas aproximadas da caixa delimitadora (bounding box) do móvel na imagem (formato: { x_min, y_min, x_max, y_max } com valores percentuais ou em pixels se souber as dimensões).
                     Responda em formato JSON, com uma lista chamada 'identified_furniture', onde cada item da lista é um objeto com as chaves 'description' e 'bounding_box' (se disponível). 
                     Exemplo de item na lista: { "description": "Sofá de 3 lugares em tecido cinza claro, estilo moderno, pés de madeira finos", "bounding_box": { "x_min": 10, "y_min": 40, "x_max": 60, "y_max": 80 } }`,
            },
            {
              type: "image_url",
              image_url: { url: project.clientRenderImageUrl },
            },
          ],
        },
      ],
      max_tokens: 1000, // Ajustar conforme necessário
      response_format: { type: "json_object" }, // Pedir resposta em JSON
    });

    const messageContent = visionResponse.choices[0]?.message?.content;
    if (!messageContent) {
      throw new Error("Resposta da API Vision vazia ou inválida.");
    }

    console.log("[AI Design Processor] Resposta da API Vision recebida.");
    // TODO: Adicionar log mais detalhado da resposta da IA (cuidado com o tamanho)
    // console.log(messageContent);

    // 3. Parsear a resposta JSON
    let identifiedFurniture: { description: string; bounding_box?: any }[] = [];
    try {
      const parsedJson = JSON.parse(messageContent);
      if (parsedJson && Array.isArray(parsedJson.identified_furniture)) {
        identifiedFurniture = parsedJson.identified_furniture;
        console.log(`[AI Design Processor] ${identifiedFurniture.length} móveis identificados pela IA.`);
      } else {
        console.warn("[AI Design Processor] Formato JSON inesperado da API Vision:", messageContent);
      }
    } catch (parseError) {
      console.error("[AI Design Processor] Erro ao parsear JSON da API Vision:", parseError, "\nConteúdo:", messageContent);
      throw new Error("Erro ao interpretar a resposta da análise da imagem.");
    }

    // 4. Processar cada item identificado
    let itemsCreatedCount = 0;
    for (const furniture of identifiedFurniture) {
      if (!furniture.description || typeof furniture.description !== 'string') {
         console.warn(`[AI Design Processor] Item de mobília sem descrição válida encontrado.`);
         continue; // Pular item sem descrição válida
      }

      const currentDescription = furniture.description; // Agora é garantido ser string
      console.log(`[AI Design Processor] Processando item: ${currentDescription}`);

      // 5. Buscar produtos similares
      let suggestedProducts: Product[] = [];
      try {
        // Passar a variável garantida como string
        suggestedProducts = await storage.searchProducts(project.userId, currentDescription);
        console.log(`[AI Design Processor] Encontrados ${suggestedProducts.length} produtos similares para "${currentDescription}".`);
      } catch (searchError) {
         console.error(`[AI Design Processor] Erro ao buscar produtos para "${currentDescription}":`, searchError);
      }

      // 6. Preparar e salvar DesignProjectItem
      const newItemData: NewDesignProjectItem = {
        designProjectId: projectId,
        detectedObjectDescription: currentDescription, // Usar a variável garantida
        detectedObjectBoundingBox: furniture.bounding_box || null,
        // Pegar os IDs dos top 3 produtos (ou menos se houver menos)
        suggestedProductId1: suggestedProducts[0]?.id ?? null,
        matchScore1: suggestedProducts[0] ? 0.9 : null, // Score Fixo Temporário (Placeholder)
        suggestedProductId2: suggestedProducts[1]?.id ?? null,
        matchScore2: suggestedProducts[1] ? 0.8 : null, // Score Fixo Temporário
        suggestedProductId3: suggestedProducts[2]?.id ?? null,
        matchScore3: suggestedProducts[2] ? 0.7 : null, // Score Fixo Temporário
        selectedProductId: null, // Nenhum selecionado ainda
        userFeedback: null,
        // createdAt e updatedAt serão adicionados pelo DB/Schema
      };

      try {
        await storage.createDesignProjectItem(newItemData);
        itemsCreatedCount++;
      } catch (dbError) {
        console.error(`[AI Design Processor] Erro ao salvar item no DB para "${currentDescription}":`, dbError);
        // Decidir se deve parar ou continuar?
      }
    }

    // 7. Atualizar status final do projeto
    const finalStatus = itemsCreatedCount > 0 ? 'awaiting_selection' : 'processed_no_items';
    await storage.updateDesignProject(projectId, { status: finalStatus, updatedAt: new Date() });
    console.log(`[AI Design Processor] Processamento concluído para projeto ${projectId}. Status: ${finalStatus}. ${itemsCreatedCount} itens criados.`);

  } catch (error) {
    console.error(`[AI Design Processor] ERRO FATAL no processamento do projeto ${projectId}:`, error);
    // Tentar atualizar o status para 'failed'
    try {
      await storage.updateDesignProject(projectId, { status: 'failed', updatedAt: new Date() });
    } catch (updateError) {
      console.error(`[AI Design Processor] Falha ao atualizar status para 'failed' do projeto ${projectId}:`, updateError);
    }
    // Rethrow ou tratar o erro conforme necessário
    // throw error;
  }
}