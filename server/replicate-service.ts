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

// ATUALIZADA para usar cjwbw/semantic-segment-anything
export async function getSegmentationMaskSAM(
  imageUrl: string,
  // promptText não é usado diretamente como input para cjwbw/semantic-segment-anything,
  // mas pode ser usado para selecionar a máscara correta do output se ele retornar múltiplas máscaras com etiquetas.
  promptText: string, 
  // Novo modelIdentifier para cjwbw/semantic-segment-anything com hash de versão
  modelIdentifier: string = "cjwbw/semantic-segment-anything:3c1e3d401ae19046cde20ad78941c3e87b6de60b3c3b45aaee18e714a017b50e"
): Promise<string | null> { 
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("[DEBUG SAM SVC] REPLICATE_API_TOKEN não está configurado.");
    return null;
  }
  if (!imageUrl) {
    console.error("[DEBUG SAM SVC] URL da imagem não fornecida para SAM.");
    return null;
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });
  
  const input = {
    image: imageUrl,
    threshold: 0.4 // Usando o threshold sugerido pelo ChatGPT, pode precisar de ajuste
  };

  console.log(`[DEBUG SAM SVC] Chamando Replicate.run com: Model: ${modelIdentifier}, Input: ${JSON.stringify(input)}`);

  try {
    // O output deste modelo pode ser diferente. Precisamos inspecioná-lo.
    // Exemplo de output esperado (HIPOTÉTICO - PRECISA VERIFICAR O REAL):
    // { masks: [ { label: "chair", mask_url: "url1" }, { label: "table", mask_url: "url2" } ] }
    // ou apenas uma URL de uma imagem de máscara combinada, ou um objeto com várias URLs de máscaras.
    const output = await replicate.run(modelIdentifier as `${string}/${string}:${string}`, { input }) as any; // Usar 'any' por enquanto até sabermos o formato exato
    
    console.log("[DEBUG SAM SVC] Output BRUTO do Replicate (cjwbw/semantic-segment-anything):", JSON.stringify(output));

    // LÓGICA PARA EXTRAIR A MÁSCARA CORRETA (PRECISA SER AJUSTADA BASEADO NO OUTPUT REAL)
    if (output) {
      // Cenário 1: Se o output for diretamente uma URL de string (máscara única/combinada)
      if (typeof output === 'string') {
        console.log(`[DEBUG SAM SVC] Output é uma string (URL de máscara?): ${output}`);
        // Se for uma máscara combinada, não podemos usá-la diretamente para um objeto específico facilmente.
        // Por ora, vamos retornar se for uma URL, mas idealmente queremos máscaras por objeto.
        if (output.startsWith('http')) return output;
        return null; // Não é uma URL válida
      }

      // Cenário 2: Se o output for um objeto com uma propriedade contendo a URL da máscara (ex: output.mask_url ou output.image)
      // Isso é comum para modelos que retornam uma única imagem processada.
      if (typeof output === 'object' && output !== null) {
        const possibleMaskKeys = ['mask', 'mask_url', 'image', 'output', 'combined_mask', 'segmentation_map'];
        for (const key of possibleMaskKeys) {
          if (typeof output[key] === 'string' && output[key].startsWith('http')) {
            console.log(`[DEBUG SAM SVC] Encontrada URL de máscara na chave '${key}': ${output[key]}`);
            // Novamente, se for uma máscara única, não é ideal para objeto específico, mas retornamos por enquanto.
            return output[key];
          }
        }

        // Cenário 3: Se o output for uma estrutura com múltiplas máscaras e etiquetas (IDEAL)
        // Exemplo: output.segments = [{label: "chair", mask_url: "..."}, {label: "table", mask_url: "..."}]
        // ou output.masks = [...] ou output.predictions = [...] etc.
        let segments: {label?: string, class?: string, category?: string, name?: string, mask_url?: string, mask?: string}[] = [];
        if (Array.isArray(output.segments)) segments = output.segments;
        else if (Array.isArray(output.masks)) segments = output.masks;
        else if (Array.isArray(output.predictions)) segments = output.predictions;
        else if (Array.isArray(output.outputs)) segments = output.outputs;
        else if (Array.isArray(output)) segments = output; // Se o output for diretamente um array de segmentos

        if (segments.length > 0) {
            console.log(`[DEBUG SAM SVC] Encontrados ${segments.length} segmentos/máscaras no output.`);
            const normalizedPromptText = promptText.toLowerCase().trim();
            for (const seg of segments) {
                const label = seg.label || seg.class || seg.category || seg.name;
                const maskUrl = seg.mask_url || seg.mask; // Alguns modelos podem usar 'mask' para a URL
                if (label && typeof label === 'string' && maskUrl && typeof maskUrl === 'string' && maskUrl.startsWith('http')) {
                    if (label.toLowerCase().includes(normalizedPromptText)) {
                        console.log(`[DEBUG SAM SVC] Máscara correspondente encontrada para "${promptText}" com etiqueta "${label}": ${maskUrl}`);
                        return maskUrl;
                    }
                }
            }
            console.warn(`[DEBUG SAM SVC] Nenhum segmento com etiqueta correspondente a "${promptText}" encontrado nas máscaras retornadas.`);
            // Se nenhum match exato, mas temos um promptText e só uma máscara principal, talvez retornar ela?
            // Ou, se houver apenas uma máscara no array, retorná-la?
            if (segments.length === 1 && (segments[0].mask_url || segments[0].mask) && typeof (segments[0].mask_url || segments[0].mask) === 'string'){
                const singleMaskUrl = segments[0].mask_url || segments[0].mask;
                 if(singleMaskUrl && singleMaskUrl.startsWith('http')){
                    console.log(`[DEBUG SAM SVC] Retornando a única máscara encontrada, pois não houve match de etiqueta: ${singleMaskUrl}`);
                    return singleMaskUrl;
                }
            }
        }
      }
    }

    console.warn("[DEBUG SAM SVC] Output do Replicate (cjwbw/semantic-segment-anything) não continha uma URL de máscara utilizável ou correspondente.", output);
    return null;
  } catch (error: any) {
    console.error("[DEBUG SAM SVC] Erro ao chamar API do cjwbw/semantic-segment-anything no Replicate:", error.message);
    // Não logar error.response completo aqui, pode ser muito grande ou já logado por runReplicateModel
    if (error.response?.status) console.error("[DEBUG SAM SVC] Replicate Error Status:", error.response.status);
    return null;
  }
}