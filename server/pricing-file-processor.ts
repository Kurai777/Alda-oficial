import xlsx from 'xlsx';
import { storage } from './storage.js'; // To get catalog details
// @ts-ignore
import { downloadFileFromS3 } from './s3-service.js'; // To download the file from S3
import { Catalog } from '@shared/schema'; // Type for catalog
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

interface PriceInfo {
  className: string; // Ex: "CLASSE 01", "CLASSE 02"
  value: number;     // Preço já normalizado (ex: 261.00 para R$ 261,00)
}

export interface ExtractedPriceItem { // Exportar para uso em catalog-processor
  code?: string;
  name?: string;
  prices?: PriceInfo[];
  dimensions?: string;
  // Outras informações que a IA possa extrair e acharmos úteis
  rawAIReponse?: any; // Para depuração da resposta da IA
}

// Definição da estrutura JSON que esperamos da IA
interface AIPriceExtractionResponse {
  products: Array<{
    code?: string;
    name?: string;
    dimensions?: string;
    priceVariations: Array<{
      class_name: string; // ex: "CLASSE 01"
      price: number | string; // IA pode retornar como string ou número
    }>;
  }>;
  classDefinitions?: Array<{ // Opcional, se a IA encontrar uma tabela de definição
    className: string;
    definition: Record<string, string>; // ex: {"Cor": "Azul", "Tecido": "Linho"} ou simplesmente {"Descrição": "Tecido Especial"}
  }>;
  error?: string; // Se a IA detectar um problema na interpretação
}

/**
 * Extracts the S3 key from a full S3 URL.
 * Example: https://bucket-name.s3.region.amazonaws.com/users/1/catalogs/2/file.xlsx -> users/1/catalogs/2/file.xlsx
 * @param s3Url Full S3 URL
 * @returns S3 key or null if URL is invalid
 */
function extractS3KeyFromUrl(s3Url: string): string | null {
  if (!s3Url || !s3Url.startsWith('http')) {
    console.warn(`[extractS3KeyFromUrl] Provided s3Url does not seem to be a full URL: ${s3Url}`);
    if (s3Url.includes('/') && !s3Url.startsWith('http') && !s3Url.startsWith('data:')) {
        return s3Url;
    }
    return null;
  }
  try {
    const url = new URL(s3Url);
    const key = decodeURIComponent(url.pathname.substring(1));
    return key;
  } catch (error) {
    console.error(`[extractS3KeyFromUrl] Error parsing S3 URL ${s3Url}:`, error);
    return null;
  }
}

function normalizePrice(priceString: string | number | null | undefined): number | undefined {
    if (priceString === null || priceString === undefined) return undefined;
    let s = String(priceString).trim();
    s = s.replace(/R\\$\\s*/gi, '').replace(/\\s+/g, '');
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf('.') < s.lastIndexOf(',')) {
            s = s.replace(/\\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const num = parseFloat(s);
    return isNaN(num) ? undefined : num;
}

function convertSheetDataToTextSample(jsonData: any[][], maxRows = 50, maxCols = 15): string {
  let textSample = "";
  const numRows = Math.min(jsonData.length, maxRows);
  for (let i = 0; i < numRows; i++) {
    const row = jsonData[i];
    if (row && row.length > 0) {
      const numColsToConsider = Math.min(row.length, maxCols);
      let lastNonEmptyCellInRow = -1;
      for (let k = numColsToConsider - 1; k >= 0; k--) {
        if (row[k] !== null && String(row[k]).trim() !== '') {
          lastNonEmptyCellInRow = k;
          break;
        }
      }
      // Se a linha inteira (até maxCols) estiver vazia, pular para a próxima linha
      if (lastNonEmptyCellInRow === -1 && numColsToConsider > 0) {
        // Adicionar uma linha em branco se a linha original não era completamente vazia além de maxCols,
        // mas era vazia dentro do limite de maxCols. Ou simplesmente pular.
        // Por simplicidade e para manter a estrutura visual para a IA, vamos adicionar linha em branco se a linha original tinha colunas.
        if(row.length > 0) textSample += '\n';
        continue; 
      }

      const effectiveCols = lastNonEmptyCellInRow + 1;
      // Usar concatenação de strings para evitar problemas com template literals aninhados
      textSample += row.slice(0, effectiveCols).map(cell => {
        const cellString = String(cell === null ? '' : cell).trim();
        return cellString.replace(/\t/g, ' ').replace(/\n/g, ' '); // Substituir TABs e Newlines dentro das células
      }).join('\t') + '\n';
    }
  }
  // console.log("Amostra de texto para IA:", textSample);
  return textSample;
}

export async function processPricingFile(catalogId: number): Promise<ExtractedPriceItem[] | null> {
  console.log(`[PricingProcessor] Iniciando processamento do arquivo de preços para o catálogo ID: ${catalogId} USANDO IA.`);
  if (!openai) {
    console.error("[PricingProcessor] OpenAI client não inicializado. Verifique a API Key.");
    return null;
  }

  let catalog: Catalog | undefined;
  try {
    catalog = await storage.getCatalog(catalogId);
    if (!catalog || !catalog.pricingFileUrl) {
      console.log(`[PricingProcessor] Catálogo ID ${catalogId} ou URL do arquivo de preços não encontrado/vazio.`);
      return null;
    }

    const fileUrl = catalog.pricingFileUrl;
    const fileExtension = fileUrl.substring(fileUrl.lastIndexOf('.')).toLowerCase();
    if (fileExtension !== '.xlsx' && fileExtension !== '.xls') {
      console.log(`[PricingProcessor] Arquivo de preços (ID ${catalogId}) não é Excel (${fileExtension}). Processamento IA de preços focado em Excel por enquanto.`);
      return null;
    }

    const s3Key = extractS3KeyFromUrl(fileUrl);
    if (!s3Key) {
      console.error(`[PricingProcessor] Não foi possível extrair a chave S3 de: ${fileUrl} (ID: ${catalogId})`);
      return null;
    }

    const fileBuffer = await downloadFileFromS3(s3Key);
    if (!fileBuffer || !(fileBuffer instanceof Buffer)) {
      console.error(`[PricingProcessor] Falha ao baixar ou buffer inválido do S3: ${s3Key}`);
      return null;
    }
    console.log(`[PricingProcessor] Arquivo baixado (${(fileBuffer.length / 1024).toFixed(2)} KB). Lendo com xlsx...`);

    const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellNF: false, cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null, blankrows: true });

    if (jsonData.length < 1) {
      console.log(`[PricingProcessor] Planilha (ID: ${catalogId}) vazia.`);
      return [];
    }

    const sheetTextSample = convertSheetDataToTextSample(jsonData);
    if (!sheetTextSample.trim()) {
        console.log(`[PricingProcessor] Amostra de texto da planilha (ID: ${catalogId}) está vazia. Nada para enviar à IA.`);
        return [];
    }
    
    console.log(`[PricingProcessor] Enviando amostra da planilha (primeiras ${Math.min(jsonData.length, 50)} linhas) para análise da IA...`);

    const systemPrompt = `Você é um assistente especialista em analisar planilhas de preços de lojas de móveis e extrair dados de produtos de forma estruturada.
Sua tarefa é analisar a amostra de dados da planilha fornecida pelo usuário e identificar os produtos, seus códigos/modelos, nomes/descrições, dimensões e todas as variações de preço com suas respectivas classes (ex: "CLASSE 01", "CLASSE 02", "Preço Promo").
Procure também por qualquer tabela ou seção que defina o que cada classe de preço significa (ex: uma tabela de cores/tecidos associada às classes).

Responda OBRIGATORIAMENTE em formato JSON. A estrutura principal do JSON deve ser:
{
  "products": [
    {
      "code": "string (código ou modelo do produto)",
      "name": "string (nome ou descrição principal)",
      "dimensions": "string (dimensões como 'C x L x A', opcional)",
      "priceVariations": [
        {
          "class_name": "string (ex: CLASSE 01, CLASSE 02, Preço Atacado)",
          "price": "number ou string (o valor do preço, tente converter para número se possível, mantendo o formato original se a conversão falhar ou não for clara)"
        }
      ]
    }
  ],
  "classDefinitions": [
    {
      "className": "string (ex: CLASSE 01)",
      "definition": {
        "atributo1": "valor1",
        "atributo2": "valor2"
      }
    }
  ],
  "error": "string (opcional, preencha se não conseguir processar ou encontrar dados significativos, explicando o problema)"
}

Instruções importantes:
- Se uma linha parecer ser um cabeçalho ou um título de seção e não um produto, ignore-a na lista de "products".
- Para os preços, tente normalizá-los para um formato numérico (ex: 2599.90 para R$ 2.599,90), mas se a conversão for ambígua, retorne o valor como string como ele aparece na planilha.
- Se múltiplas colunas de preço existirem para o mesmo produto (ex: CLASSE 01, CLASSE 02), liste todas elas em "priceVariations".
- Se a planilha contiver uma legenda ou tabela separada explicando o que significa cada "CLASSE X" (ex: CLASSE 01 = Tecido Y, Cor Z), tente extrair essa informação para a seção "classDefinitions". Associe a "className" correta.
- Seja o mais preciso possível. Se não tiver certeza sobre um campo, omita-o do produto específico ou da variação de preço.
- A coluna de código/modelo é a mais importante para identificar um produto. A descrição/nome é a segunda mais importante.
- As dimensões geralmente estão em uma coluna separada.
- Se a planilha estiver mal formatada ou for impossível extrair dados de produtos, preencha o campo "error" com uma descrição do problema.`;

    try {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Aqui está a amostra da planilha de preços:\n\n${sheetTextSample}` }
        ],
        response_format: { type: "json_object" }, 
        temperature: 0.2, 
      });

      const responseContent = aiResponse.choices[0]?.message?.content;
      if (!responseContent) {
        console.error(`[PricingProcessor] Resposta da IA vazia para catálogo ID: ${catalogId}`);
        return null;
      }

      console.log(`[PricingProcessor] Resposta da IA recebida (primeiros 500 chars): ${responseContent.substring(0,500)}`);
      
      let parsedAIResponse: AIPriceExtractionResponse;
      try {
        parsedAIResponse = JSON.parse(responseContent) as AIPriceExtractionResponse;
      } catch (parseError) {
        console.error(`[PricingProcessor] Erro ao parsear JSON da resposta da IA para catálogo ID: ${catalogId}`, parseError);
        console.error(`[PricingProcessor] Conteúdo da IA que falhou no parse: ${responseContent}`);
        // Tentar um fallback ou retornar erro
        await storage.updateCatalogStatus(catalogId, 'failed_ia_pricing_parse');
        return null;
      }
      
      if (parsedAIResponse.error) {
          console.warn(`[PricingProcessor] IA reportou um erro para catálogo ID ${catalogId}: ${parsedAIResponse.error}`);
          // Decidir se isso deve ser um erro fatal ou se podemos tentar algo mais
          // Por agora, se IA reporta erro, não extraímos nada.
          return []; 
      }

      if (!parsedAIResponse.products || parsedAIResponse.products.length === 0) {
        console.log(`[PricingProcessor] IA não extraiu produtos da planilha para catálogo ID: ${catalogId}`);
        return [];
      }

      const extractedItems: ExtractedPriceItem[] = parsedAIResponse.products.map(aiProduct => {
        const prices: PriceInfo[] = aiProduct.priceVariations?.map(pv => {
          const normalized = normalizePrice(pv.price);
          return {
            className: pv.class_name,
            value: normalized !== undefined ? normalized : -1 // Usar -1 ou algum marcador se preço não pôde ser normalizado
          };
        }).filter(p => p.value !== -1) || []; // Filtrar preços que não puderam ser normalizados

        return {
          code: aiProduct.code,
          name: aiProduct.name,
          dimensions: aiProduct.dimensions,
          prices: prices.length > 0 ? prices : undefined,
          rawAIReponse: parsedAIResponse // Para depuração futura, pode remover
        };
      }).filter(item => item.code || item.name); // Garantir que temos pelo menos um código ou nome

      // TODO: Processar e armazenar `parsedAIResponse.classDefinitions` se presente.
      // Isso pode ser associado ao catálogo ou usado para enriquecer os produtos.
      if (parsedAIResponse.classDefinitions && parsedAIResponse.classDefinitions.length > 0) {
          console.log(`[PricingProcessor] IA encontrou definições de classe para catálogo ID ${catalogId}:`, JSON.stringify(parsedAIResponse.classDefinitions, null, 2));
          // Aqui você poderia salvar essas definições em uma nova tabela ou campo JSON no catálogo.
      }

      console.log(`[PricingProcessor] IA extraiu ${extractedItems.length} itens da planilha de preços para o catálogo ID: ${catalogId}.`);
      if (extractedItems.length > 0 && extractedItems.length < 10) {
          console.log("[PricingProcessor] Amostra (até 3) itens extraídos pela IA:", JSON.stringify(extractedItems.slice(0, 3).map(item => ({code: item.code, name: item.name, prices: item.prices, dimensions: item.dimensions})), null, 2));
      }
      return extractedItems;

    } catch (aiError) {
      console.error(`[PricingProcessor] Erro na chamada da API OpenAI para catálogo ID ${catalogId}:`, aiError);
      await storage.updateCatalogStatus(catalogId, 'failed_ia_pricing_call'); // Novo status de erro
      return null;
    }

  } catch (error) {
    console.error(`[PricingProcessor] Erro GERAL ao processar arquivo de preços para o catálogo ID ${catalogId}:`, error);
    return null;
  }
} 