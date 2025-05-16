import { storage } from './storage';
import { Product, InsertMoodboard, Moodboard } from '@shared/schema';
import OpenAI from 'openai';
import axios from 'axios'; // Para baixar a imagem do DALL-E
import { generateMoodboardImageWithBannerbear_Simulated as generateMoodboardVisual } from './moodboard-image-composer'; // Renomear aqui ou usar o nome novo diretamente

// Configurar o cliente OpenAI (assumindo que a chave de API está nas variáveis de ambiente)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

interface GenerateMoodboardWithAiParams {
  userId: number;
  productIds: number[];
  userPrompt?: string; // O que o usuário pediu, ex: "um moodboard moderno com tons de azul"
}

interface AiGeneratedMoodboardContent {
  projectName: string;
  description: string;
  style: string;
  colorPalette: string[]; // Array de hex codes ou nomes de cores
  // iaPromptForImage?: string; // Poderíamos gerar um prompt para DALL-E aqui também
}

// A função generateVisualMoodboardWithDallE será removida ou comentada, 
// pois createMoodboardImageProgrammatically a substitui para a geração da imagem.
/*
async function generateVisualMoodboardWithDallE(
  moodboardContent: AiGeneratedMoodboardContent,
  productsDetails: Product[],
  userId: number,
  moodboardId: number
): Promise<string | null> {
  if (!openai) {
    console.error("[DALL-E] OpenAI API key não configurada.");
    return null;
  }

  // Novo prompt para DALL-E, focado em colagem/prancha
  let dallEPrompt = `Crie uma imagem de uma prancha de moodboard de design de interiores, estilo colagem elegante e profissional. `;
  dallEPrompt += `O tema é "${moodboardContent.projectName}" com um estilo geral "${moodboardContent.style || 'eclético'}". `;
  dallEPrompt += `A descrição do conceito é: "${moodboardContent.description}". `;
  dallEPrompt += `A paleta de cores principal a ser usada e exibida como amostras de cores na prancha é: ${moodboardContent.colorPalette.join(', ')}. `;
  
  if (productsDetails.length > 0) {
    dallEPrompt += "O moodboard deve APRESENTAR os seguintes produtos (renderize cada produto individualmente, como se fossem recortes de revista ou fotos de catálogo sobre a prancha): ";
    productsDetails.forEach((p, index) => {
      // Tentar ser mais descritivo para ajudar o DALL-E
      let productDescriptionForDalle = p.name;
      if (p.category) productDescriptionForDalle += `, tipo ${p.category}`;
      if (p.materials && p.materials.length > 0) productDescriptionForDalle += `, feito de ${p.materials.join(' e ')}`;
      if (p.colors && p.colors.length > 0) productDescriptionForDalle += `, nas cores ${p.colors.join('/')}`;
      if (p.description) productDescriptionForDalle += ` (detalhes: ${p.description.substring(0, 70)}${p.description.length > 70 ? '...':''})`;
      else productDescriptionForDalle += ` (descrição básica: ${p.name} ${p.category || ''})`;
      
      dallEPrompt += `Item ${index + 1}: ${productDescriptionForDalle}. `;
    });
  }
  dallEPrompt += "Organize os recortes dos produtos e as amostras de cores de forma harmoniosa sobre um fundo neutro (ex: linho claro, papel texturizado branco ou cinza claro). Adicione pequenos elementos gráficos ou texturas sutis que complementem o estilo, se apropriado. Evite criar uma cena 3D de um ambiente; o resultado deve ser uma colagem plana bidimensional.";

  console.log(`[DALL-E V2 Prompt] Para Moodboard ID ${moodboardId}:\n${dallEPrompt}`);

  try {
    const response = await openai.images.generate({
      model: "dall-e-3", 
      prompt: dallEPrompt,
      n: 1,
      size: "1024x1024", 
      response_format: "url",
      // quality: "standard", // Standard pode ser mais rápido e barato para testes
      // style: "vivid" // ou "natural"
    });

    const imageUrl = response.data && response.data[0]?.url;
    if (!imageUrl) {
      console.error("[DALL-E] Nenhuma URL de imagem retornada ou formato de resposta inesperado.", response);
      return null;
    }
    console.log(`[DALL-E] Imagem gerada com sucesso (URL temporária): ${imageUrl}`);

    // Passo Opcional, mas recomendado: Baixar e salvar no S3
    try {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(imageResponse.data, 'binary');
      const s3FileName = `moodboard_${moodboardId}_${Date.now()}.png`;
      // Usar uma categoria específica para imagens geradas por IA de moodboards
      const s3Url = await uploadBufferToS3(buffer, s3FileName, userId, 'ai_generated_moodboards', moodboardId.toString());
      console.log(`[DALL-E] Imagem do moodboard salva no S3: ${s3Url}`);
      return s3Url; // Retorna a URL permanente do S3
    } catch (s3Error) {
      console.error("[DALL-E] Erro ao baixar/salvar imagem do DALL-E no S3:", s3Error);
      // Retornar a URL temporária do DALL-E como fallback se o S3 falhar
      // ATENÇÃO: Essas URLs do DALL-E geralmente expiram após um tempo (ex: 1 hora)
      console.warn("[DALL-E] Usando URL temporária do DALL-E como fallback.")
      return imageUrl; 
    }

  } catch (error) {
    console.error(`[DALL-E] Erro ao gerar imagem para Moodboard ID ${moodboardId}:`, error);
    return null;
  }
}
*/

/**
 * Gera o conteúdo textual de um moodboard usando IA.
 */
export async function generateMoodboardContentWithAi(
  params: GenerateMoodboardWithAiParams
): Promise<Moodboard | null> {
  const { userId, productIds, userPrompt } = params;

  if (!openai) {
    console.error("OpenAI API key não configurada. Não é possível gerar conteúdo de moodboard com IA.");
    throw new Error("Serviço de IA indisponível.");
  }

  if (!productIds || productIds.length === 0) {
    console.warn("Nenhum ID de produto fornecido para gerar moodboard.");
    throw new Error("Selecione ao menos um produto para o moodboard.");
  }

  // 1. Buscar detalhes dos produtos selecionados
  const productsDetails: Product[] = [];
  for (const productId of productIds) {
    const product = await storage.getProduct(productId);
    if (product && product.userId === userId) { // Garantir que o produto pertence ao usuário
      productsDetails.push(product);
    }
  }

  if (productsDetails.length === 0) {
    console.warn("Nenhum detalhe de produto encontrado para os IDs fornecidos ou não pertencem ao usuário.");
    throw new Error("Produtos selecionados não encontrados ou inválidos.");
  }

  // 2. Montar o prompt para o LLM (GPT)
  let promptForLlm = `Objetivo: Gerar conteúdo para um moodboard de design de interiores.

Produtos Selecionados:
`;
  productsDetails.forEach(p => {
    promptForLlm += `- ${p.name} (Categoria: ${p.category || 'N/A'}, Descrição: ${p.description || 'Sem descrição'})\n`;
  });

  if (userPrompt) {
    promptForLlm += `\nPreferências do Usuário: ${userPrompt}\n`;
  }

  promptForLlm += `\nCom base nos produtos e preferências acima, gere o seguinte em formato JSON (apenas o JSON, sem texto adicional antes ou depois):
{
  "projectName": "Um nome criativo e conciso para o moodboard (máximo 5 palavras)",
  "description": "Uma descrição inspiradora para o moodboard (2-3 frases), explicando como os produtos se complementam e se encaixam no tema/estilo geral.",
  "style": "O principal estilo de design do moodboard (ex: Moderno, Japandi, Industrial, Minimalista, Boho, etc.).",
  "colorPalette": ["cor1", "cor2", "cor3", "cor4"] // Um array com 3 a 5 nomes de cores principais ou códigos HEX que definem a paleta do moodboard.
}
`;

  console.log("Prompt para LLM (Moodboard Content):\n", promptForLlm);

  // 3. Chamar a API do OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Ou o modelo que você preferir/tiver acesso
      messages: [{ role: "user", content: promptForLlm }],
      response_format: { type: "json_object" }, // Solicitar resposta em JSON
      temperature: 0.7,
    });

    const aiResponseContent = completion.choices[0]?.message?.content;
    if (!aiResponseContent) {
      throw new Error("Resposta da IA vazia.");
    }

    console.log("Resposta da IA (Moodboard Content):", aiResponseContent);
    const generatedContent: AiGeneratedMoodboardContent = JSON.parse(aiResponseContent);

    // 4. Salvar o moodboard no banco de dados
    const moodboardToSave: InsertMoodboard = {
      userId,
      productIds,
      projectName: generatedContent.projectName,
      description: generatedContent.description,
      style: generatedContent.style,
      colorPalette: generatedContent.colorPalette,
      status: 'text_generated', // Novo status indicando que o texto foi gerado
      iaPrompt: promptForLlm, // Salvar o prompt usado para gerar o texto
      // generatedImageUrl ainda será null aqui
    };

    const savedTextMoodboard = await storage.createMoodboard(moodboardToSave);
    console.log("Moodboard (conteúdo textual) salvo no DB:", savedTextMoodboard);

    // 5. Gerar a imagem programaticamente
    let finalMoodboard = savedTextMoodboard;
    try {
        const visualImageUrl = await generateMoodboardVisual(
            savedTextMoodboard, // Passa o moodboard salvo que contém ID, nome, estilo, etc.
            productsDetails,    // Passa os detalhes dos produtos
            userId              // Passa o userId para o caminho S3
        );

        if (visualImageUrl) {
            const updatedMoodboardWithImage = await storage.updateMoodboard(savedTextMoodboard.id, { 
                generatedImageUrl: visualImageUrl, 
                status: 'image_generated' 
            });
            console.log(`[Moodboard Gen] Moodboard ${savedTextMoodboard.id} atualizado com URL da imagem (Bannerbear Sim): ${visualImageUrl}`);
            finalMoodboard = updatedMoodboardWithImage || savedTextMoodboard;
        } else {
            await storage.updateMoodboard(savedTextMoodboard.id, { status: 'image_generation_failed' });
            console.warn(`[Moodboard Gen] Conteúdo textual gerado para moodboard ${savedTextMoodboard.id}, mas a geração de imagem (Bannerbear Sim) falhou.`);
            // Retornar o moodboard com o status de falha na imagem para que a UI possa refletir isso
            finalMoodboard = { ...savedTextMoodboard, status: 'image_generation_failed', generatedImageUrl: null };
        }
    } catch (imageGenError) {
        console.error(`[Moodboard Gen] Erro CATASTRÓFICO durante generateMoodboardVisual (Bannerbear Sim) para moodboard ${savedTextMoodboard.id}:`, imageGenError);
        await storage.updateMoodboard(savedTextMoodboard.id, { status: 'image_generation_failed' });
        finalMoodboard = { ...savedTextMoodboard, status: 'image_generation_failed', generatedImageUrl: null };
    }
    return finalMoodboard;

  } catch (error) {
    console.error("Erro ao gerar conteúdo do moodboard com IA:", error);
    // Se o erro for de parse do JSON da IA, pode ser útil logar o conteúdo bruto
    if (error instanceof SyntaxError && (error as any).message.includes('JSON')) {
      console.error("Conteúdo bruto da IA que falhou no parse:", (error as any).failedContent || 'Não disponível');
    }
    throw new Error("Falha ao gerar conteúdo do moodboard com IA."); // Repassar o erro
  }
} 