/**
 * Serviço de integração com Replicate API
 * 
 * Este serviço permite executar modelos hospedados no Replicate,
 * como modelos de imagem para texto, geração de imagens, etc.
 */

import axios from 'axios';
import { setTimeout } from 'timers/promises';
import Replicate from "replicate"; // Adicionar import do cliente Replicate

interface ReplicateModelInput {
  [key: string]: any;
}

interface ReplicatePredictionResponse {
  id: string;
  version: string;
  urls: {
    get: string;
    cancel: string;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  input: ReplicateModelInput;
  output?: any;
  error?: string;
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
}

export interface RamSamSegment {
  box: [number, number, number, number];
  label: string;
  logit: number;
  value: number; // ID da máscara, se aplicável a uma máscara combinada
  mask_url?: string; // Adicionando caso o modelo retorne URLs de máscaras individuais aqui
}

interface RamSamOutput {
  tags?: string;
  json_data?: { mask?: RamSamSegment[] }; // O array de segmentos está em json_data.mask
  masked_img?: string; // URL da imagem com máscaras coloridas (para debug)
  rounding_box_img?: string; // URL da imagem com bboxes (para debug)
  // O output principal da API também pode ser um array de URLs, 
  // sendo a primeira geralmente a visualização e a última a máscara principal (mask.jpg)
  // Vamos priorizar o json_data.mask se disponível.
}

/**
 * Executa um modelo do Replicate e aguarda a conclusão
 * 
 * @param modelPath Caminho do modelo (ex: "stability-ai/stable-diffusion")
 * @param version Versão do modelo (ex: "db21e45d3f7023abc2a46ee38a23973f6dce16bb082a930b0c49861f96d1e5bf")
 * @param input Parâmetros de entrada para o modelo
 * @param apiToken Token da API Replicate
 * @param maxRetries Número máximo de tentativas para verificar o status
 * @param delayMs Atraso em milissegundos entre verificações de status
 * @returns Resultado da execução do modelo
 */
export async function runReplicateModel<T = any>(
  modelPath: string,
  version: string,
  input: ReplicateModelInput,
  apiToken: string,
  maxRetries = 60, // Limite máximo de tentativas (60 x 2s = 2 minutos)
  delayMs = 2000   // 2 segundos entre verificações
): Promise<T | null> {
  if (!apiToken) {
    console.error('[Replicate Service] Token da API Replicate não fornecido.');
    return null;
  }

  try {
    // Iniciar a execução do modelo
    console.log(`[Replicate Service] Iniciando execução do modelo ${modelPath}:${version}`);
    const response = await axios.post<ReplicatePredictionResponse>(
      'https://api.replicate.com/v1/predictions',
      {
        version: version,
        input: input,
      },
      {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const prediction = response.data;
    console.log(`[Replicate Service] Execução iniciada com ID: ${prediction.id}`);

    // Verificar o status da execução até concluir
    let attempts = 0;
    let status = prediction.status;
    let getPredictionUrl = prediction.urls.get;

    while (status !== 'succeeded' && status !== 'failed' && status !== 'canceled' && attempts < maxRetries) {
      attempts++;
      await setTimeout(delayMs);

      const checkResponse = await axios.get<ReplicatePredictionResponse>(
        getPredictionUrl,
        {
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      status = checkResponse.data.status;
      
      if (status === 'processing') {
        console.log(`[Replicate Service] Modelo ainda em processamento... (tentativa ${attempts})`);
      }
    }

    if (status === 'succeeded') {
      const finalResponse = await axios.get<ReplicatePredictionResponse>(
        getPredictionUrl,
        {
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      console.log(`[Replicate Service] Execução concluída com sucesso após ${attempts} verificações`);
      return finalResponse.data.output as T;
    } else {
      console.error(`[Replicate Service] Execução falhou ou tempo esgotado. Status: ${status}`);
      return null;
    }
  } catch (error: any) {
    console.error('[Replicate Service] Erro ao executar modelo:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Dados:', error.response.data);
    }
    return null;
  }
}

/**
 * Exemplo: Gerar embeddings de texto usando o modelo CLIP do Replicate
 * 
 * @param text Texto para gerar embeddings
 * @param apiToken Token da API Replicate
 * @returns Array de embeddings ou null em caso de erro
 */
export async function getTextEmbeddings(
  text: string,
  apiToken: string
): Promise<number[] | null> {
  if (!text.trim()) {
    console.error('[Replicate Service] Texto vazio fornecido para embeddings.');
    return null;
  }

  return runReplicateModel<number[]>(
    'nateraw/clip-embedding-generator',
    '4ee2e4aff45e4b577e4159a8ab31a3c6c8167b7294536886a34f2761ace61c69',
    { text: text },
    apiToken
  );
}

/**
 * Exemplo: Gerar embeddings de imagem usando o modelo CLIP do Replicate
 * 
 * @param imageUrl URL da imagem para gerar embeddings
 * @param apiToken Token da API Replicate
 * @returns Array de embeddings ou null em caso de erro
 */
export async function getImageEmbeddings(
  imageUrl: string,
  apiToken: string
): Promise<number[] | null> {
  if (!imageUrl) {
    console.error('[Replicate Service] URL de imagem vazia fornecida para embeddings.');
    return null;
  }

  return runReplicateModel<number[]>(
    'nateraw/clip-embedding-generator',
    '4ee2e4aff45e4b577e4159a8ab31a3c6c8167b7294536886a34f2761ace61c69',
    { image: imageUrl },
    apiToken
  );
}

/**
 * Exemplo: Extrair texto de uma imagem usando o modelo Salesforce BLIP
 * 
 * @param imageUrl URL da imagem para extrair texto
 * @param apiToken Token da API Replicate
 * @returns Texto extraído ou null em caso de erro
 */
export async function extractTextFromImage(
  imageUrl: string,
  apiToken: string
): Promise<string | null> {
  if (!imageUrl) {
    console.error('[Replicate Service] URL de imagem vazia fornecida para extração de texto.');
    return null;
  }

  return runReplicateModel<string>(
    'salesforce/blip',
    '2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139eea840d0ac4746',
    { image: imageUrl },
    apiToken
  );
}

// ATUALIZADA para usar idea-research/ram-grounded-sam
export async function getSegmentationDataRAM(
  imageUrl: string,
  // promptText não é mais usado como input direto para este modelo SAM
  modelIdentifier: string = "idea-research/ram-grounded-sam:80a2aede4cf8e3c9f26e96c308d45b23c350dd36f1c381de790715007f1ac0ad"
  // Retorna o array de segmentos detectados (label e box) ou null
): Promise<RamSamSegment[] | null> { 
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("[DEBUG RAM-SAM SVC] REPLICATE_API_TOKEN não está configurado.");
    return null;
  }
  if (!imageUrl) {
    console.error("[DEBUG RAM-SAM SVC] URL da imagem não fornecida.");
    return null;
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });
  
  const input = {
    input_image: imageUrl,
    // use_sam_hq: false, // Default é false, podemos omitir ou setar explicitamente
    // show_visualisation: false // Default é false, útil para debug no Replicate, mas não precisamos da imagem anotada no backend agora
  };

  console.log(`[DEBUG RAM-SAM SVC] Chamando Replicate.run com: Model: ${modelIdentifier}, Input: ${JSON.stringify(input)}`);

  try {
    // O output principal é um objeto com várias chaves, incluindo json_data
    const output = await replicate.run(modelIdentifier as `${string}/${string}:${string}`, { input }) as RamSamOutput;
    
    console.log("[DEBUG RAM-SAM SVC] Output BRUTO do Replicate (idea-research/ram-grounded-sam):", JSON.stringify(output));

    if (output && output.json_data && Array.isArray(output.json_data.mask)) {
      console.log(`[DEBUG RAM-SAM SVC] ${output.json_data.mask.length} segmentos encontrados em json_data.mask.`);
      return output.json_data.mask;
    } else {
      console.warn("[DEBUG RAM-SAM SVC] Output do Replicate não continha json_data.mask esperado.", output);
      return null;
    }

  } catch (error: any) {
    console.error("[DEBUG RAM-SAM SVC] Erro ao chamar API do idea-research/ram-grounded-sam:", error.message);
    if (error.response?.status) {
        console.error("[DEBUG RAM-SAM SVC] Replicate Error Status:", error.response.status);
        if (error.response.data?.detail) {
            console.error("[DEBUG RAM-SAM SVC] Replicate Error Detail:", error.response.data.detail);
        } else if (error.response.data) {
            console.error("[DEBUG RAM-SAM SVC] Replicate Error Data (snippet):", JSON.stringify(error.response.data).substring(0, 200));
        }
    }
    return null;
  }
}

// A função getSegmentationMaskSAM antiga não é mais necessária se usarmos getSegmentationDataRAM
// Ou podemos renomeá-la e adaptar se precisarmos de outros modelos SAM no futuro.
// Por agora, vou comentar a antiga para evitar confusão.
/*
export async function getSegmentationMaskSAM(
  imageUrl: string,
  promptText: string, 
  modelIdentifier: string = "andreasjansson/grounded-sam:b8c7f97f29af1f56e372cddf7c60f55a8b5f91b67892b6d3dfc2e6c79779bfc6"
): Promise<string | null> { 
  // ... (código antigo) ...
}
*/