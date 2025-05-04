import OpenAI from 'openai';
import XLSX from 'xlsx';
import fs from 'fs/promises';

// 1. Configurar Cliente OpenAI (assume que a chave está em process.env.OPENAI_API_KEY)
const { OPENAI_API_KEY } = process.env;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 2. Prompt Padrão para a IA (Pode ser substituído pelo seu prompt específico)
const DEFAULT_SYSTEM_PROMPT = `\nVocê é um assistente especialista em análise de planilhas de catálogos de produtos.\nSua tarefa é analisar os dados brutos de uma planilha Excel (fornecidos como JSON) e extrair *apenas* as informações de produtos válidos.\n\nInstruções:\n1.  **Identifique as Colunas Relevantes:** Analise as primeiras linhas e cabeçalhos para determinar:\n    * Qual coluna contém o **Código do Produto** (SKU/Referência/Cod.). Anote a letra desta coluna.\n    * Qual coluna **mais provavelmente contém as Imagens** (procure por cabeçalhos como \"Imagem\", \"Foto\" ou colunas com poucos dados textuais perto de nome/descrição). Anote a letra desta coluna.\n2.  **Ignore Linhas Irrelevantes:** Ignore completamente linhas que são cabeçalhos, títulos, subtotais, totais, separadores, linhas vazias, faixas de preço, ou que claramente não representam um produto individual.\n3.  **Extraia Dados do Produto:** Para cada linha que representa um produto válido, extraia os seguintes campos:\n    *   \`excelRowNumber\`: O número original da linha onde este produto foi encontrado na planilha Excel.\n    *   \`name\`: O nome principal do produto.\n    *   \`code\`: O código único do produto (extraído da coluna identificada na etapa 1).\n    *   \`price\`: O preço **APENAS como NÚMERO** (ex: 1234.56 ou 1234). **NÃO inclua 'R$', pontos de milhar ou vírgula como separador decimal.** Use PONTO como separador decimal, se houver centavos. Se não encontrar, use 0.\n    *   \`description\`: A descrição completa.\n    *   \`manufacturer\`: O fabricante/marca.\n    *   \`location\`: A localização física.\n4.  **Formato de Saída:** Retorne um objeto JSON contendo as seguintes chaves principais:\n    *   \`codeColumnLetter\`: A letra da coluna identificada na Etapa 1 para os códigos (ex: \"H\"). Retorne null se não identificar.\n    *   \`guessedImageColumnLetter\`: A letra da coluna identificada na Etapa 1 como a mais provável para as imagens (ex: \"F\"). Retorne null se não identificar.\n    *   \`products\`: Um array JSON onde cada objeto representa um produto e contém *todos* os campos extraídos na etapa 3.\n    Exemplo de Saída:\n    {\n      \"codeColumnLetter\": \"H\",\n      \"guessedImageColumnLetter\": \"F\",\n      \"products\": [ \n        { \"excelRowNumber\": 3, \"name\": \"Sofá Sleep\", \"code\": \"SLE1823313\", \"price\": 1234.56, ... },\n        { \"excelRowNumber\": 4, \"name\": \"Sofá Boheme\", \"code\": \"29059\", \"price\": 6543, ... }\n      ]\n    }\n5.  **Seja Preciso:** Extraia apenas produtos reais.\n`;

/**
 * Processa DADOS de um Excel (em formato JSON) usando IA para extrair produtos.
 * @param {any[]} rawDataWithRowNumbers Array de objetos representando linhas do Excel.
 * @param {string} [userPrompt] Prompt customizado do usuário (opcional).
 * @returns {Promise<{products: Array<object>, codeColumnLetter: string | null, guessedImageColumnLetter: string | null}>} Objeto com produtos e as letras das colunas identificadas.
 */
async function processExcelWithAI(rawDataWithRowNumbers, userPrompt = null) {
  console.log(`\n=== INICIANDO PROCESSAMENTO EXCEL COM IA ===`);

  try {
    if (!rawDataWithRowNumbers || rawDataWithRowNumbers.length === 0) {
      console.log(`Dados brutos recebidos vazios.`);
      return { products: [], codeColumnLetter: null, guessedImageColumnLetter: null };
    }

    const jsonDataString = JSON.stringify(rawDataWithRowNumbers, null, 2);

    console.log(`Enviando ${rawDataWithRowNumbers.length} linhas para análise da IA...`);

    // 3. Preparar a chamada para a IA
    const systemPrompt = userPrompt || DEFAULT_SYSTEM_PROMPT;
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Analise os seguintes dados da planilha Excel (em formato JSON) e extraia os produtos:\n\n\`\`\`json\n${jsonDataString}\n\`\`\`\n\nRetorne *apenas* o objeto JSON com a chave 'products' contendo o array de produtos extraídos.` }
    ];

    // 4. Chamar a API da OpenAI
    console.log("Chamando API da OpenAI (gpt-4o)...");
    const startTime = Date.now();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    const duration = Date.now() - startTime;
    console.log(`Resposta da IA recebida em ${duration}ms.`);

    // 5. Processar a Resposta
    const aiResponseContent = response.choices[0]?.message?.content;
    if (!aiResponseContent) {
      throw new Error("A IA não retornou conteúdo.");
    }

    let extractedProducts = [];
    let identifiedCodeColumn = null;
    let identifiedImageColumn = null;
    try {
      const jsonResponse = JSON.parse(aiResponseContent);

      // MODIFICADO: Espera codeColumnLetter, guessedImageColumnLetter e products
      if (jsonResponse.products && Array.isArray(jsonResponse.products)) {
        extractedProducts = jsonResponse.products;
        identifiedCodeColumn = jsonResponse.codeColumnLetter || null;
        identifiedImageColumn = jsonResponse.guessedImageColumnLetter || null;
        
        if (identifiedCodeColumn) {
           console.log(`IA identificou a coluna de código: ${identifiedCodeColumn}`);
        } else {
           console.warn("IA NÃO retornou 'codeColumnLetter'.");
        }
        if (identifiedImageColumn) {
           console.log(`IA identificou a coluna de imagem provável: ${identifiedImageColumn}`);
        } else {
           console.warn("IA NÃO retornou 'guessedImageColumnLetter'. Associação usará apenas proximidade de linha.");
        }

      } else {
        // Tenta encontrar só o array de produtos como fallback (menos ideal)
        console.warn("Formato JSON da resposta da IA inesperado (sem 'products' ou 'codeColumnLetter' no nível superior). Tentando encontrar array...");
        const firstArrayKey = Object.keys(jsonResponse).find(key => Array.isArray(jsonResponse[key]));
        if (firstArrayKey) {
          console.log(`Encontrado array na chave '${firstArrayKey}'. Coluna do código não identificada.`);
          extractedProducts = jsonResponse[firstArrayKey];
          identifiedCodeColumn = null;
          identifiedImageColumn = null;
        } else {
          throw new Error("Array de produtos não encontrado no JSON retornado pela IA.");
        }
      }

      console.log(`IA extraiu ${extractedProducts.length} produtos.`);
      // Logar a amostra para ver se tem excelRowNumber
      if(extractedProducts.length > 0) {
        console.log("Amostra da IA (com excelRowNumber?):", JSON.stringify(extractedProducts[0], null, 2));
      }

    } catch (parseError) {
      console.error("Erro ao parsear JSON da resposta da IA:", parseError);
      console.error("Conteúdo recebido da IA:", aiResponseContent);
      throw new Error(`Falha ao processar resposta da IA: ${parseError.message}`);
    }

    // 6. Validar e Limpar os Dados
    const validProducts = extractedProducts
      .filter(p => p && typeof p === 'object' && p.name && p.code && typeof p.excelRowNumber === 'number')
      .map(p => ({
        excelRowNumber: p.excelRowNumber,
        name: p.name || 'Nome Ausente',
        code: p.code || 'Código Ausente',
        price: typeof p.price === 'number' ? p.price : 0,
        description: p.description || p.name || '',
        manufacturer: p.manufacturer || '',
        location: p.location || '',
        category: p.category || '', 
        materials: p.materials || [],
        colors: p.colors || [],
        isEdited: false
      }));

    console.log(`Total de produtos válidos após limpeza: ${validProducts.length}`);
    // Modificado: Retorna produtos E as colunas identificadas
    return { products: validProducts, codeColumnLetter: identifiedCodeColumn, guessedImageColumnLetter: identifiedImageColumn }; 

  } catch (error) {
    console.error('Erro CRÍTICO durante o processamento Excel com IA:', error);
    // Modificado: Retorna array vazio e colunas null
    return { products: [], codeColumnLetter: null, guessedImageColumnLetter: null }; 
  }
}

/**
 * Usa GPT-4o Vision para descrever o item principal em uma imagem.
 * @param {string} imageUrl URL da imagem a ser analisada.
 * @returns {Promise<string | null>} Uma string descrevendo o item, ou null em caso de erro.
 */
async function describeImageWithVision(imageUrl) {
  const MAX_RETRIES = 2; 
  const INITIAL_DELAY = 1500; 
  let attempt = 0;

  console.log(`[Vision Desc] Descrevendo Imagem ${imageUrl.substring(imageUrl.lastIndexOf('/') + 1)}...`);

  // Prompt pedindo apenas a descrição concisa
  const promptMessages = [
    {
      role: "system",
      content: "Você é um especialista em identificar móveis em imagens. Descreva o tipo de móvel principal mostrado na imagem em poucas palavras (ex: 'sofá', 'cadeira com braços', 'mesa de centro redonda'). Seja conciso.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Descreva o tipo de móvel principal nesta imagem em poucas palavras.",
        },
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
            detail: "high" 
          },
        },
      ],
    },
  ];

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      console.log(`[Vision Desc]   Tentativa ${attempt}/${MAX_RETRIES}: Chamando API Vision...`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: promptMessages,
        max_tokens: 50, 
        temperature: 0.1, 
      });

      const description = response.choices[0]?.message?.content?.trim() || null;
      console.log(`[Vision Desc]   Descrição da IA: '${description}'`);
      // RETORNA APENAS A DESCRIÇÃO
      return description; 

    } catch (error) {
      console.error(`[Vision Desc]   Erro na tentativa ${attempt} da API Vision:`, error);
      if (error.status === 429) {
         console.warn(`[Vision Desc]    Rate limit atingido. Aumentando delay.`);
         const delay = INITIAL_DELAY * Math.pow(2, attempt + 1); 
         console.log(`[Vision Desc]    Aguardando ${delay / 1000}s antes de tentar novamente...`);
         await new Promise(resolve => setTimeout(resolve, delay));
      } else if (attempt < MAX_RETRIES) {
          const delay = INITIAL_DELAY * Math.pow(2, attempt -1);
          console.log(`[Vision Desc]   Aguardando ${delay / 1000}s antes de tentar novamente...`);
          await new Promise(resolve => setTimeout(resolve, delay));
      } else {
          console.error("[Vision Desc]   Máximo de tentativas atingido após erro não recuperável. Desistindo.");
          return null; 
      }
    }
  }

  return null; 
}

/**
 * Usa GPT-4o Vision para verificar se uma imagem corresponde aos detalhes de um produto.
 * Pede uma resposta JSON { match: boolean, reason: string } indicando correspondência confiante.
 * @param {object} productDetails Detalhes COMPLETOS do produto (name, code, description, category, etc.).
 * @param {string} imageUrl URL da imagem a ser verificada.
 * @returns {Promise<{match: boolean, reason: string} | null>} Objeto com resultado ou null em caso de erro.
 */
async function verifyImageMatchWithVision(productDetails, imageUrl) {
  const MAX_RETRIES = 2;
  const INITIAL_DELAY = 1500;
  let attempt = 0;

  const detailsText = [
    `Nome: ${productDetails.name || 'N/A'}`,
    `Código: ${productDetails.code || 'N/A'}`,
    `Descrição: ${(productDetails.description || 'N/A').substring(0, 200)}`,
    `Categoria: ${productDetails.category || 'N/A'}`,
    `Fabricante: ${productDetails.manufacturer || 'N/A'}`,
    `Cores: ${productDetails.colors || 'N/A'}`,
    `Materiais: ${productDetails.materials || 'N/A'}`,
  ].join('\n');

  console.log(`[Vision Compare v4] Verificando Imagem ${imageUrl.substring(imageUrl.lastIndexOf('/') + 1)} para Prod: ${productDetails.name} (${productDetails.code})`);

  const promptMessages = [
    {
      role: "system",
      content: "Você é um especialista em análise visual de catálogos de móveis. Sua tarefa é comparar a imagem fornecida com os detalhes do produto e determinar se a imagem representa bem o produto ou se há uma correspondência confiante. Considere tipo, estilo, cor e características mencionadas. Responda APENAS com um objeto JSON contendo duas chaves: 'match' (boolean: true se for uma correspondência confiante, false caso contrário) e 'reason' (string: explique brevemente sua decisão em português, ex: 'Match: Sofá cinza de 3 lugares.', ou 'Mismatch: Imagem mostra uma cadeira, produto é um sofá.').",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Analise a imagem e compare com estes detalhes:\n${detailsText}\nA imagem representa bem este produto? Responda APENAS com o JSON { "match": boolean, "reason": string }.`
        },
        {
          type: "image_url",
          image_url: { url: imageUrl, detail: "high" },
        },
      ],
    },
  ];

  while (attempt < MAX_RETRIES) {
    try {
      console.log(`[Vision Compare v4]   Tentativa ${attempt + 1}/${MAX_RETRIES}: Chamando API Vision...`);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: promptMessages,
        max_tokens: 100,
        temperature: 0.1,
        response_format: { type: "json_object" }
      });

      const resultText = response.choices[0]?.message?.content;
      console.log(`[Vision Compare v4]   Resposta bruta da IA: ${resultText}`);

      if (resultText) {
          try {
              const jsonResponse = JSON.parse(resultText);
              if (typeof jsonResponse.match === 'boolean' && typeof jsonResponse.reason === 'string') {
                  console.log(`[Vision Compare v4]     ---> Resultado: Match=${jsonResponse.match}, Razão: ${jsonResponse.reason} <---`);
                  return jsonResponse;
              } else {
                  console.warn(`[Vision Compare v4]     WARN: JSON da IA não tem o formato esperado (match/reason). Resposta: ${resultText}`);
                  return { match: false, reason: "Formato de resposta da IA inválido." };
              }
          } catch (jsonError) {
              console.warn(`[Vision Compare v4]     WARN: Erro ao parsear JSON da IA: ${jsonError}. Resposta: ${resultText}`);
              return { match: false, reason: "Erro ao parsear resposta JSON da IA." };
          }
      } else {
        console.warn(`[Vision Compare v4]     WARN: IA não retornou conteúdo na tentativa ${attempt + 1}.`);
      }
    } catch (error) {
      console.error(`[Vision Compare v4]   ERRO na chamada da API Vision (tentativa ${attempt + 1}):`, error);
      if (attempt + 1 >= MAX_RETRIES) {
          console.error(`[Vision Compare v4]   Máximo de tentativas atingido. Desistindo.`);
          return null;
      }
    }
    attempt++;
    if (attempt < MAX_RETRIES) {
      const delay = INITIAL_DELAY * Math.pow(2, attempt -1);
      console.log(`[Vision Compare v4]     Aguardando ${delay / 1000}s antes da próxima tentativa...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

// Exportar ambas funções
export { processExcelWithAI, verifyImageMatchWithVision };
