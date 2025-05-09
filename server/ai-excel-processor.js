import OpenAI from 'openai';
import XLSX from 'xlsx';
import fs from 'fs/promises';

// 1. Configurar Cliente OpenAI (assume que a chave está em process.env.OPENAI_API_KEY)
const { OPENAI_API_KEY } = process.env;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 2. Prompt Padrão para a IA (Pode ser substituído pelo seu prompt específico)
const DEFAULT_SYSTEM_PROMPT = `\nVocê é um assistente especialista em análise de planilhas de catálogos de produtos do setor moveleiro.\nSua tarefa é analisar os dados brutos de uma planilha Excel (fornecidos como JSON) e extrair *apenas* as informações de produtos válidos, prestando atenção especial à categoria, cores, materiais e dimensões.\n\n**Conhecimento do Setor Moveleiro (Categorias Comuns):** Sofá, Poltrona, Cadeira, Mesa de Jantar, Mesa de Centro, Mesa Lateral, Aparador, Buffet, Rack, Painel de TV, Cama, Cabeceira, Cômoda, Criado-Mudo, Guarda-Roupa, Estante, Luminária, Tapete, Almofada, Puff, Carrinho Bar.\n\nInstruções:\n1.  **Identifique as Colunas Relevantes:** Analise as primeiras linhas e cabeçalhos para determinar:\n    * Qual coluna contém o **Código do Produto** (SKU/Referência/Cod.). Anote a letra desta coluna.\n    * Qual coluna **mais provavelmente contém as Imagens** (procure por cabeçalhos como \"Imagem\", \"Foto\" ou colunas com poucos dados textuais perto de nome/descrição). Anote a letra desta coluna.\n2.  **Ignore Linhas Irrelevantes:** Ignore completamente linhas que são cabeçalhos, títulos, subtotais, totais, separadores, linhas vazias, faixas de preço, ou que claramente não representam um produto individual.\n3.  **Extraia Dados do Produto:** Para cada linha que representa um produto válido, extraia os seguintes campos:\n    *   \`excelRowNumber\`: O número original da linha onde este produto foi encontrado na planilha Excel.\n    *   \`name\`: O nome principal do produto.\n    *   \`code\`: O código único do produto (extraído da coluna identificada na etapa 1).\n    *   \`price\`: O preço **APENAS como NÚMERO** (ex: 1234.56 ou 1234). **NÃO inclua 'R$', pontos de milhar ou vírgula como separador decimal.** Use PONTO como separador decimal, se houver centavos. Se não encontrar, use 0.\n    *   \`description\`: A descrição completa.\n    *   \`manufacturer\`: O fabricante/marca.\n    *   \`location\`: A localização física (se houver).\n    *   \`category\`: A categoria do produto. **Analise o \`name\` do produto com atenção. Se contiver termos comuns do setor moveleiro (veja lista acima, ex: 'Sofá', 'Mesa de Jantar', 'Carrinho Bar'), use esse termo como a \`category\`. Caso contrário, ou se o nome for genérico, então procure em colunas como 'Tipo', 'Linha' ou infira da \`description\`. Se ainda assim não for claro, use null.**\n    *   \`colors\`: As cores do produto. **DEVE SER um array de strings** (ex: [\"Azul Marinho\", \"Branco\"] ou [\"CL2\"] se for um código de cor). Se as cores estiverem listadas em uma única string separada por vírgulas (ex: \"nogueira, bronze\"), transforme-as em um array (ex: [\"nogueira\", \"bronze\"]). Procure por nomes de cores comuns (branco, preto, cinza, azul, verde, vermelho, amarelo, marrom, bege, etc.) ou códigos de cor (geralmente sequências alfa-numéricas curtas perto de palavras como 'cor', 'acabamento' ou após materiais como 'couro', 'tecido') na descrição, nome ou colunas relevantes. Se múltiplas cores forem mencionadas, inclua todas. Se nenhuma cor for identificada, retorne um array vazio [].\n    *   \`materials\`: Os materiais do produto, como um array de strings (ex: [\"Madeira Carvalho\", \"Aço Inox\"]). Procure na \`description\` e em colunas relevantes por termos como madeira, carvalho, aço, metal, vidro, couro, linho, veludo, MDF, MDP, tecido, etc. Se múltiplos materiais forem mencionados, inclua todos. Se nenhum for identificado, retorne um array vazio [].\n    *   \`sizes\`: Um array de objetos representando as dimensões. Procure na \`description\` ou em colunas relevantes por QUALQUER texto ou padrão numérico que indique dimensões, medidas ou tamanhos.\n        *   Para cada conjunto de dimensões identificado, crie um objeto.\n        *   **\`label\` (OBRIGATÓRIO E MAIS IMPORTANTE):** Capture a string original COMPLETA que representa as dimensões. Seja abrangente. Exemplos de strings a serem capturadas no \`label\`: \"3000x1250x750\", \"123x123\", \"1290cm h por 2123cm\", \"123x123x123x\", \"braço 20cm pé 30cm\", \"L 1.80 A .75 P .90\", \"2.20m P450 A405\".\n        *   **\`width\`, \`height\`, \`depth\` (MELHOR ESFORÇO, opcional, numérico):** Se a string no \`label\` contiver números que possam ser claramente mapeados para largura, altura e profundidade (com ou sem indicadores como L, A, P), tente extraí-los. Se a ordem não for clara ou a string for muito complexa (como \"braço 20cm pé 30cm\"), foque apenas em preencher o \`label\` corretamente. Extraia os números como aparecem, convertendo 'm' para 'cm' (multiplicando por 100) apenas se for muito óbvio e direto.\n        *   Se não encontrar nenhuma menção a dimensões, retorne um array vazio [].\n        Exemplos de como preencher o objeto \`size\`:\n        \`{ \"label\": \"3000x1250x750\" }\` (IA pode tentar \`width: 3000, height: 1250, depth: 750\`)\n        \`{ \"label\": \"1290cm h por 2123cm\" }\` (IA pode tentar \`height: 1290, width: 2123\` ou \`depth: 2123\`)\n        \`{ \"label\": \"braço 20cm pé 30cm\" }\` (Neste caso, apenas o label é suficiente, os campos numéricos podem ficar vazios se a extração for muito complexa).\n        \`{ \"label\": \"L2.20m A1.00 P0.80\", \"width\": 220, \"height\": 100, \"depth\": 80 }\`\n4.  **Formato de Saída:** Retorne um objeto JSON contendo as seguintes chaves principais:\n    *   \`codeColumnLetter\`: A letra da coluna identificada na Etapa 1 para os códigos (ex: \"H\"). Retorne null se não identificar.\n    *   \`guessedImageColumnLetter\`: A letra da coluna identificada na Etapa 1 como a mais provável para as imagens (ex: \"F\"). Retorne null se não identificar.\n    *   \`products\`: Um array JSON onde cada objeto representa um produto e contém *todos* os campos extraídos na etapa 3.\n    Exemplo de Saída:\n    {\n      \"codeColumnLetter\": \"H\",\n      \"guessedImageColumnLetter\": \"F\",\n      \"products\": [ \n        { \"excelRowNumber\": 3, \"name\": \"Sofá Living Elegance Couríssimo Preto\", \"code\": \"SLE1823-CPT\", \"price\": 3990.00, \"description\": \"Sofá de 3 lugares, em couríssimo preto. Dimensões: 2.10x0.90x0.85m. Estrutura em madeira de eucalipto.\", \"manufacturer\": \"Estofados Lux\", \"location\": \"Piso 1\", \"category\": \"Sofá\", \"colors\": [\"Preto\"], \"materials\": [\"Couríssimo\", \"Madeira de Eucalipto\"], \"sizes\": [{ \"label\": \"2.10x0.90x0.85m\", \"width\": 210, \"height\": 85, \"depth\": 90 }] },\n        { \"excelRowNumber\": 4, \"name\": \"Carrinho Bar Industrial\", \"code\": \"CAR-IND01\", \"price\": 850.75, \"description\": \"Carrinho Bar estilo industrial, estrutura em aço carbono preto fosco, prateleiras em madeira demolição. Medidas: L60xA80xP40cm. Outras infos: braço 25cm. Cores: Preto Fosco, Madeira Demolição Natural\", \"manufacturer\": \"Metal Design\", \"category\": \"Carrinho Bar\", \"colors\": [\"Preto Fosco\", \"Madeira Demolição Natural\"], \"materials\": [\"Aço Carbono\", \"Madeira Demolição\"], \"sizes\": [{ \"label\": \"L60xA80xP40cm\", \"width\": 60, \"height\": 80, \"depth\": 40 }, { \"label\": \"braço 25cm\"}] },\n        { \"excelRowNumber\": 5, \"name\": \"Colchão Casal Molas Ensacadas Super Confort\", \"code\": \"COL-CAS-MOL05\", \"price\": 1250.00, \"description\": \"Colchão Casal Padrão 138x188x32cm. Tecido Jacquard. Cod Cor Tecido: JQD001-BCO\", \"manufacturer\": \"Sonho Bom\", \"category\": \"Colchão\", \"colors\": [\"JQD001-BCO\"], \"materials\": [\"Molas Ensacadas\", \"Tecido Jacquard\"], \"sizes\": [{ \"label\": \"138x188x32cm\", \"width\": 138, \"height\": 32, \"depth\": 188 }] }, \n        { \"excelRowNumber\": 6, \"name\": \"Mesa de Jantar Hexa Bipartida\", \"code\": \"MJ-HEXA01\", \"price\": 7500.00, \"description\": \"Mesa de Jantar Hexa Bipartida 3000x1250x750. Cores: Bronze, Nogueira. Material: Madeira Maciça e Metal.\", \"manufacturer\": \"DesignerX\", \"category\": \"Mesa de Jantar\", \"colors\": [\"Bronze\", \"Nogueira\"], \"materials\": [\"Madeira Maciça\", \"Metal\"], \"sizes\": [{ \"label\": \"3000x1250x750\", \"width\": 3000, \"height\": 750, \"depth\": 1250 }] } \n      ]\n    }\n5.  **Seja Preciso:** Extraia apenas produtos reais. Priorize informações explícitas sobre inferências muito vagas.\n`;

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
