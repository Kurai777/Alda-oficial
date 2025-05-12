import axios from 'axios';
import fetch from 'node-fetch'; 

async function imageToBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`Erro ao baixar imagem de ${imageUrl}: ${response.statusText}`);
      return null;
    }
    const imageBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    return base64Image;
  } catch (error) {
    console.error(`Erro ao converter imagem ${imageUrl} para base64:`, error);
    return null;
  }
}

export async function getClipEmbeddingFromImageUrl(
  imageUrl: string,
  hfToken: string | undefined
): Promise<number[] | null> {
  if (!hfToken) {
    console.error('[CLIP Service] Token da API Hugging Face não fornecido.');
    return null;
  }
  if (!imageUrl) {
    console.error('[CLIP Service] URL da imagem não fornecida.');
    return null;
  }

  console.log(`[CLIP Service] Obtendo embedding para imagem: ${imageUrl}`);
  const base64ImageData = await imageToBase64(imageUrl);

  if (!base64ImageData) {
    console.error(`[CLIP Service] Falha ao converter imagem para base64: ${imageUrl}`);
    return null;
  }

  try {
    console.log(`[CLIP Service] Chamando API Hugging Face para ${imageUrl.substring(0, 50)}...`);
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/openai/clip-vit-large-patch14",
      {
         inputs: { image: base64ImageData } 
      },
      {
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json' 
        },
        timeout: 30000, 
      }
    );

    if (response.data && Array.isArray(response.data) && response.data.length > 0 && Array.isArray(response.data[0])) {
        console.log('[CLIP Service] Embedding recebido da Hugging Face (formato: array de vetores).');
        return response.data[0] as number[];
    } else if (response.data && Array.isArray(response.data) && typeof response.data[0] === 'number') {
         console.log('[CLIP Service] Embedding recebido da Hugging Face (formato: vetor direto).');
        return response.data as number[];
    } else {
      console.error('[CLIP Service] Formato de resposta inesperado da API Hugging Face:', response.data);
      return null;
    }

  } catch (error: any) {
    console.error(`[CLIP Service] Erro ao chamar API Hugging Face para ${imageUrl}:`, error.isAxiosError ? error.toJSON() : error);
    if (error.response) {
      console.error('[CLIP Service] HF Response Status:', error.response.status);
      console.error('[CLIP Service] HF Response Data:', error.response.data);
    }
    return null;
  }
} 