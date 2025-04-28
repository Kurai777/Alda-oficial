import OpenAI from 'openai';
import XLSX from 'xlsx';
import fs from 'fs/promises';

// 1. Configurar Cliente OpenAI (assume que a chave está em process.env.OPENAI_API_KEY)
const openai = new OpenAI(); // A chave API será pega automaticamente das variáveis de ambiente

// 2. Prompt Padrão para a IA (Pode ser substituído pelo seu prompt específico)
const DEFAULT_SYSTEM_PROMPT = `
Você é um assistente especialista em análise de planilhas de catálogos de produtos.
Sua tarefa é analisar os dados brutos de uma planilha Excel (fornecidos como JSON) e extrair *apenas* as informações de produtos válidos.

Instruções:
1.  **Identifique as Colunas:** Determine quais colunas representam Nome do Produto, Código do Produto (SKU/Referência), Preço, Descrição, Fabricante/Marca e Localização. As colunas podem não ter nomes óbvios.
2.  **Ignore Linhas Irrelevantes:** Ignore completamente linhas que são cabeçalhos, títulos, subtotais, totais, separadores (linhas com --- ou ___), linhas vazias, faixas de preço (ex: "20-40k"), ou que claramente não representam um produto individual.
3.  **Extraia Dados:** Para cada linha que representa um produto válido, extraia os seguintes campos:
    *   \`excelRowNumber\`: O número original da linha onde este produto foi encontrado na planilha Excel (importante para mapeamento posterior!).
    *   \`name\`: O nome principal do produto. Se o nome estiver misturado na descrição, extraia a parte mais relevante.
    *   \`code\`: O código único do produto.
    *   \`price\`: O preço numérico em CENTAVOS. Converta valores como "R$ 1.234,56" para 123456. Se o preço não for encontrado, use 0.
    *   \`description\`: A descrição completa do produto. Se não houver, use o nome.
    *   \`manufacturer\`: O fabricante ou marca, se disponível.
    *   \`location\`: A localização física (ex: "2º Piso", "Depósito"), se disponível.
    *   \`imageColumn\`: A letra da coluna que contém as imagens (ex: \"D\"). Se não houver, retorne null.
4.  **Formato de Saída:** Retorne os dados extraídos como um objeto JSON contendo uma única chave "products" cujo valor é um array JSON. Cada objeto no array deve representar um produto e conter *todos* os campos extraídos na etapa 3 (incluindo excelRowNumber).
    Exemplo de Saída:
    { "products": [ { "excelRowNumber": 3, "name": "Sofá Sleep", "code": "SLE1823313", "price": 2269100, "description": "Tecido 3/83\\n3 mod de 1.00m\\nc/ braço de 8cm", "manufacturer": "Enobli", "location": "2º Piso" }, ... ] }
5.  **Seja Preciso:** Extraia apenas produtos reais. É melhor omitir uma linha duvidosa do que incluir dados incorretos.
`;

/**
 * Processa um arquivo Excel usando IA para extrair produtos.
 * @param {string} filePath Caminho para o arquivo Excel.
 * @param {string} [userPrompt] Prompt customizado do usuário (opcional).
 * @returns {Promise<{products: Array<object>, imageColumn: string | null}>} Um objeto contendo a lista de produtos extraídos e a coluna de imagem identificada.
 */
export async function processExcelWithAI(filePath, userPrompt = null) {
  console.log(`\n=== INICIANDO PROCESSAMENTO EXCEL COM IA ===`);
  console.log(`Arquivo: ${filePath}`);

  try {
    // 1. Ler o arquivo Excel
    const fileBuffer = await fs.readFile(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    // 2. Converter para JSON (limitar linhas para não sobrecarregar a IA?)
    // *** Reduzir o número de linhas enviadas ***
    const MAX_ROWS_TO_SEND = 100; // Reduzido de 200 para 100
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: null }).slice(0, MAX_ROWS_TO_SEND);
    if (!rawData || rawData.length === 0) {
      console.log(`Planilha vazia ou sem dados nas primeiras ${MAX_ROWS_TO_SEND} linhas.`);
      return { products: [], imageColumn: null };
    }

    // Adicionar o número da linha original aos dados brutos enviados para a IA
    const rawDataWithRowNumbers = rawData.map((row, index) => ({
      excelRowNumber: index + 1, // +1 porque slice(0, MAX) já pulou cabeçalhos se houver
      ...row
    }));
    const jsonDataString = JSON.stringify(rawDataWithRowNumbers, null, 2);

    console.log(`Enviando ${rawDataWithRowNumbers.length} linhas (com row numbers) para análise da IA...`);
    // console.log("Dados enviados (amostra):", jsonDataString.substring(0, 500)); // Log para debug

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
      model: "gpt-4o", // Usar o modelo mais capaz
      messages: messages,
      temperature: 0.1, // Baixa temperatura para respostas mais consistentes
      response_format: { type: "json_object" }, // Pedir resposta em JSON
    });
    const duration = Date.now() - startTime;
    console.log(`Resposta da IA recebida em ${duration}ms.`);

    // 5. Processar a Resposta
    const aiResponseContent = response.choices[0]?.message?.content;
    if (!aiResponseContent) {
      throw new Error("A IA não retornou conteúdo.");
    }

    // Tentar parsear o JSON da resposta
    let extractedProducts = [];
    let identifiedImageColumn = null; // Valor padrão
    try {
      const jsonResponse = JSON.parse(aiResponseContent);

      // Espera-se que a IA retorne um objeto com a chave "products"
      if (jsonResponse.products && Array.isArray(jsonResponse.products)) {
        extractedProducts = jsonResponse.products;
      } else {
        console.warn("Formato JSON da resposta da IA inesperado. Tentando encontrar um array...");
        // Tentar encontrar o primeiro array dentro do objeto retornado como fallback
        const firstArrayKey = Object.keys(jsonResponse).find(key => Array.isArray(jsonResponse[key]));
        if (firstArrayKey) {
          console.log(`Encontrado array na chave '${firstArrayKey}'.`);
          extractedProducts = jsonResponse[firstArrayKey];
        } else {
          throw new Error("Array de produtos ('products') não encontrado no JSON retornado pela IA.");
        }
      }

      console.log(`IA extraiu ${extractedProducts.length} produtos.`);
      // Logar a amostra para ver se tem excelRowNumber
      if(extractedProducts.length > 0) {
        console.log("Amostra da IA (com excelRowNumber?):", JSON.stringify(extractedProducts[0], null, 2));
      }

      identifiedImageColumn = jsonResponse.imageColumn || null; // Extrai a coluna da imagem
      console.log(`IA identificou a coluna de imagens como: ${identifiedImageColumn}`);

    } catch (parseError) {
      console.error("Erro ao parsear JSON da resposta da IA:", parseError);
      console.error("Conteúdo recebido da IA:", aiResponseContent);
      throw new Error(`Falha ao processar resposta da IA: ${parseError.message}`);
    }

    // 6. Validar e Limpar os Dados (garantir que excelRowNumber está presente)
    const validProducts = extractedProducts
      .filter(p => p && typeof p === 'object' && p.name && p.code && typeof p.excelRowNumber === 'number') // Validar campos essenciais + excelRowNumber
      .map(p => ({
        excelRowNumber: p.excelRowNumber, // Manter o número da linha
        name: p.name || 'Nome Ausente',
        code: p.code || 'Código Ausente',
        price: typeof p.price === 'number' ? p.price : 0,
        description: p.description || p.name || '',
        manufacturer: p.manufacturer || '',
        location: p.location || '',
        category: p.category || '', 
        materials: p.materials || [],
        colors: p.colors || [],
        isEdited: false,
        imageColumn: p.imageColumn || null
      }));

    console.log(`Total de produtos válidos após limpeza: ${validProducts.length}`);
    return { products: validProducts, imageColumn: identifiedImageColumn };

  } catch (error) {
    console.error('Erro CRÍTICO durante o processamento Excel com IA:', error);
    return { products: [], imageColumn: null };
  }
}