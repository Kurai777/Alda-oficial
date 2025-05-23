import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@xenova/transformers';
import sharp from 'sharp';

let vision_model: CLIPVisionModelWithProjection | null = null;
let processor: AutoProcessor | null = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

export async function initializeClipModel(): Promise<void> {
  if (vision_model && processor) {
    console.log("[CLIP Service] Modelo CLIP local já está carregado.");
    return;
  }
  if (isLoading && loadPromise) {
    return loadPromise;
  }

  isLoading = true;
  console.log("[CLIP Service] Inicializando modelo CLIP local (Xenova/clip-vit-base-patch32)...");

  loadPromise = (async () => {
    try {
      const modelName = 'Xenova/clip-vit-base-patch32';
      const config = { cache_dir: './.cache/huggingface/transformers' };
      vision_model = await CLIPVisionModelWithProjection.from_pretrained(modelName, config);
      processor = await AutoProcessor.from_pretrained(modelName, config);
      console.log("[CLIP Service] Modelo CLIP e processador carregados.");
      isLoading = false;
    } catch (error) {
      console.error("[CLIP Service] Erro ao carregar modelo CLIP local:", error);
      isLoading = false;
      loadPromise = null;
      throw error;
    }
  })();
  return loadPromise;
}

export async function getClipEmbeddingFromImageUrl(
  imageUrl: string,
  hfToken?: string | undefined
): Promise<number[] | null> {
  if (!imageUrl) {
    console.error('[CLIP Service] URL da imagem não fornecida.');
    return null;
  }

  if (!vision_model || !processor) {
    if (isLoading && loadPromise) {
      await loadPromise;
    } else {
      await initializeClipModel();
    }
  }

  if (!vision_model || !processor) {
    console.error('[CLIP Service] Modelo/Processador CLIP local não carregado.');
    return null;
  }

  try {
    const image = await RawImage.fromURL(imageUrl);
    
    // Corrigido: Passar a imagem diretamente para o processador (ou em um array)
    // Tentativa 1: Passar a imagem diretamente
    const inputs = await (processor as any)(image);

    const output = await vision_model(inputs);
    const image_embeds = output.image_embeds ?? output.pooler_output;

    if (!image_embeds || !image_embeds.data) {
      console.error('[CLIP Service] Não foi possível extrair embeddings da imagem do output do modelo.');
      return null;
    }

    const embeddingVector = Array.from(image_embeds.data as Float32Array);

    if (embeddingVector.length === 0) {
      console.error(`[CLIP Service] Embedding gerado para ${imageUrl} está vazio.`);
      return null;
    }
    // console.log(`[CLIP Service] Embedding local da imagem recebido. Dimensões: ${embeddingVector.length}.`);
    return embeddingVector;

  } catch (error: any) {
    console.error(`[CLIP Service] Erro ao gerar embedding para ${imageUrl}:`, error.message || error);
    if(error.stack) console.error(error.stack);
    return null;
  }
}

export async function getClipEmbeddingFromImageBuffer(
  imageBuffer: Buffer,
  // width e height não são mais necessários como params diretos,
  // pois sharp irá extraí-los do buffer.
  sourceHint: string = "buffer" // Para logs
): Promise<number[] | null> {
  if (!imageBuffer || imageBuffer.length === 0) {
    console.error('[CLIP Service] Buffer de imagem não fornecido ou vazio.');
    return null;
  }

  if (!vision_model || !processor) {
    if (isLoading && loadPromise) {
      await loadPromise;
    } else {
      await initializeClipModel();
    }
  }

  if (!vision_model || !processor) {
    console.error('[CLIP Service] Modelo/Processador CLIP local não carregado para processar buffer.');
    return null;
  }

  try {
    // Usar sharp para decodificar o buffer e obter dados brutos de pixel e metadados
    const sharpImage = sharp(imageBuffer);
    const metadata = await sharpImage.metadata();
    
    if (!metadata.width || !metadata.height || !metadata.channels) {
        console.error(`[CLIP Service] Metadados inválidos da imagem do buffer (${sourceHint}). Width: ${metadata.width}, Height: ${metadata.height}, Channels: ${metadata.channels}`);
        return null;
    }

    // Garantir que a imagem esteja em um formato que RawImage entenda (ex: RGBA)
    // O construtor de RawImage espera Uint8ClampedArray ou Uint8Array
    // Sharp pode nos dar um buffer com os pixels brutos. Precisamos garantir o formato correto.
    // Ex: .toFormat('rgba') ou .raw() se já estiver decodificado
    const pixelBuffer = await sharpImage.ensureAlpha().raw().toBuffer(); // ensureAlpha para RGBA, raw para pixels brutos
    
    const image = new RawImage(Uint8ClampedArray.from(pixelBuffer), metadata.width, metadata.height, 4); // Assumindo 4 canais (RGBA)

    const inputs = await (processor as any)(image);
    const output = await vision_model(inputs);
    const image_embeds = output.image_embeds ?? output.pooler_output;

    if (!image_embeds || !image_embeds.data) {
      console.error(`[CLIP Service] Não foi possível extrair embeddings do buffer (${sourceHint}) do output do modelo.`);
      return null;
    }

    const embeddingVector = Array.from(image_embeds.data as Float32Array);

    if (embeddingVector.length === 0) {
      console.error(`[CLIP Service] Embedding gerado para buffer (${sourceHint}) está vazio.`);
      return null;
    }
    return embeddingVector;

  } catch (error: any) {
    console.error(`[CLIP Service] Erro ao gerar embedding para buffer (${sourceHint}):`, error.message || error);
    if(error.stack) console.error(error.stack);
    return null;
  }
} 