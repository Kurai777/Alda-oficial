import { Moodboard, Product } from '@shared/schema';
// @ts-ignore 
import { uploadBufferToS3 } from './s3-service'; // Para salvar a imagem final no S3
// import sharp from 'sharp'; // Comentado pois vamos simular chamada de API externa
// import axios from 'axios'; // axios ainda pode ser útil para buscar imagens dos produtos para enviar para a API externa
import axios from 'axios';

interface MoodboardImageData {
  s3Url: string;
  // Poderíamos adicionar dimensões ou outros metadados aqui no futuro
}

// fetchImageBuffer pode não ser necessário se Bannerbear puder buscar de URLs públicas diretamente.
// Mas pode ser útil se precisarmos pré-processar ou garantir acesso.
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  } catch (error) {
    console.error(`Erro ao baixar imagem de ${url} para API (Bannerbear Sim):`, error);
    return null;
  }
}

// Função para escapar texto para SVG
function escapeSVGText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return text.toString().replace(/[&<>\"\'\r\n]/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

/**
 * Simula a criação de uma imagem de moodboard via API do Bannerbear.
 * Ref: https://developers.bannerbear.com/#images
 */
export async function generateMoodboardImageWithBannerbear_Simulated(
  moodboard: Moodboard,
  productsDetails: Product[],
  userId: number // userId pode não ser diretamente usado por Bannerbear, mas útil para S3 fallback
): Promise<string | null> {
  console.log(`[Bannerbear Sim v1] Iniciando para Moodboard ID: ${moodboard.id}, Nome: ${moodboard.projectName}`);

  if (!process.env.BANNERBEAR_API_KEY) {
    console.error("[Bannerbear Sim v1] BANNERBEAR_API_KEY não está configurada nos secrets.");
    return null;
  }

  try {
    // Etapa 1: Preparar as "modifications" para a API do Bannerbear
    // Isso assume que você tem um template no Bannerbear com camadas nomeadas
    // como "moodboard_title", "moodboard_description", "color_swatch_1", "product_image_1", "product_name_1", etc.

    const modifications: any[] = [];

    // Título e Descrição do Moodboard
    if (moodboard.projectName) {
      modifications.push({ name: "moodboard_title", text: moodboard.projectName });
    }
    if (moodboard.description) {
      modifications.push({ name: "moodboard_description", text: moodboard.description });
    }
    if (moodboard.style) {
      modifications.push({ name: "moodboard_style", text: `Estilo: ${moodboard.style}` });
    }

    // Paleta de Cores
    // Supondo que seu template Bannerbear tenha placeholders para cores (ex: "color_swatch_1_bg", "color_swatch_1_text")
    moodboard.colorPalette?.forEach((hexColor, index) => {
      if (index < 5) { // Limitar a 5 amostras, por exemplo
        modifications.push({ name: `color_swatch_${index + 1}_bg`, color: hexColor });
        modifications.push({ name: `color_swatch_${index + 1}_text`, text: hexColor });
      }
    });

    // Produtos
    // Supondo placeholders como "product_image_1", "product_name_1", "product_code_1"
    productsDetails.forEach((product, index) => {
      if (index < 4) { // Limitar a 4 produtos no moodboard, por exemplo
        if (product.imageUrl) {
          modifications.push({ name: `product_image_${index + 1}`, image_url: product.imageUrl });
        }
        modifications.push({ name: `product_name_${index + 1}`, text: product.name });
        if (product.code) {
          modifications.push({ name: `product_code_${index + 1}`, text: `Cód: ${product.code}` });
        }
        // Poderia adicionar materiais aqui também se o template suportar
        if (product.materials && product.materials.length > 0) {
            modifications.push({ name: `product_materials_${index + 1}`, text: `Materiais: ${product.materials.join(', ')}`});
        }
      }
    });
    
    // Adicionar outros elementos fixos ou dinâmicos que seu template Bannerbear possa ter
    // modifications.push({ name: "logo_empresa", image_url: "URL_DO_SEU_LOGO_NO_S3_OU_PUBLICO" });


    const bannerbearApiPayload = {
      template: "SEU_TEMPLATE_UID_DO_BANNERBEAR_AQUI", // IMPORTANTE: Você precisa substituir isso pelo UID do seu template no Bannerbear
      modifications: modifications,
      webhook_url: null, // Poderíamos usar isso para processamento assíncrono no futuro
      transparent: false,
      render_pdf: false,
      // metadata: JSON.stringify({ moodboardId: moodboard.id, userId: userId }) // Opcional
    };

    console.log('[Bannerbear Sim v1] Payload que seria enviado para POST /v2/images do Bannerbear:', JSON.stringify(bannerbearApiPayload, null, 2));

    // Etapa 2: SIMULAR CHAMADA à API do Bannerbear
    // const BANNERBEAR_API_URL = 'https://api.bannerbear.com/v2/images'; // Ou https://sync.api.bannerbear.com/v2/images para síncrono
    /*
    try {
      const response = await axios.post(BANNERBEAR_API_URL, bannerbearApiPayload, {
        headers: { 'Authorization': `Bearer ${process.env.BANNERBEAR_API_KEY}` }
      });
      
      // Se síncrono, response.data pode já ter image_url
      // Se assíncrono (202), response.data terá um uid e status 'pending'
      // Precisaríamos então fazer polling em GET /v2/images/:uid até status 'completed'
      console.log('[Bannerbear Sim v1] Resposta simulada da API Bannerbear:', response.data);
      const generatedImageUrl = response.data.image_url; // Ajustar conforme a resposta real

      if (!generatedImageUrl) {
        console.error("[Bannerbear Sim v1] Bannerbear API não retornou image_url na simulação.");
        return null;
      }
      // Lógica de re-hospedar no S3 se necessário (como antes)
      return generatedImageUrl;

    } catch (apiError: any) {
      console.error("[Bannerbear Sim v1] Erro simulado ao chamar API Bannerbear:", apiError.response?.data || apiError.message);
      return null;
    }
    */

    // Simulação de sucesso com uma URL de placeholder
    const simulatedBannerbearImageUrl = `https://catalogos-ald-a.s3.us-east-1.amazonaws.com/placeholder-moodboard-BANNERBEAR-SIM-${moodboard.id}.png`;
    console.log(`[Bannerbear Sim v1] URL final da imagem do moodboard (simulada do Bannerbear): ${simulatedBannerbearImageUrl}`);
    
    return simulatedBannerbearImageUrl;

  } catch (error) {
    console.error(`[Bannerbear Sim v1] Erro geral na função de simulação Bannerbear:`, error);
    return null;
  }
} 