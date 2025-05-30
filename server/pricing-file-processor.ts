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
  code?: string; // Código do modelo principal (se houver)
  name?: string; // Nome completo da variação (ex: "BORA C/ASSENTO 0,63")
  model_base?: string; // Nome do modelo base (ex: "BORA")
  variation_description?: string; // Descrição da variação (ex: "C/ASSENTO 0,63" ou da coluna DESCRIÇÃO)
  prices?: PriceInfo[];
  dimensions?: string;
  description?: string; // Mantido para qualquer descrição geral da IA, mas priorizar variation_description
  rawAIReponse?: any; // Para depuração da resposta da IA
}

// Definição da estrutura JSON que esperamos da IA
interface AIPriceExtractionResponse {
  products: Array<{
    code?: string | null; 
    name?: string; // NOME COMPLETO DO MODELO/PRODUTO da linha, ex: 'Bora C/Assento 0,63'
    model_base?: string; // NOME DO MODELO BASE, ex: 'Bora'
    variation_description?: string | null; // DESCRIÇÃO DA VARIAÇÃO, ex: 'C/Assento 0,63' ou 'sofá 1 lug'
    description?: string | null; // Descrição geral adicional, se houver
    dimensions?: string | null; 
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

// Estrutura para a resposta da IA de ANÁLISE ESTRUTURAL INICIAL
interface AISheetStructureResponse {
  productHeaderRowIndex?: number; // 0-indexed
  modelColumnIndex?: number;    // 0-indexed
  descriptionColumnIndex?: number; // 0-indexed
  priceColumnMapping?: Array<{ headerText: string, columnIndex: number }>; // Ex: [{headerText: "CLASSE 01", columnIndex: 2}]
  dimensionsColumnIndex?: number; // 0-indexed
  classDefinitions?: Array<{ 
    className: string; // Ex: "CLASSE 01"
    definition: Record<string, string>; // Ex: {"Cor": "Amarelo", "Tecido": "Suede"} ou {"Descrição": "Couro Legítimo"}
  }>;
  dataStartRowIndex?: number; // 0-indexed, primeira linha com dados de PRODUTO reais, após o cabeçalho
  error?: string;
}

// Estrutura para a resposta da IA de processamento LINHA A LINHA (mantida)
interface AIProductLineResponse {
  name?: string; 
  model_base?: string; 
  variation_description?: string | null; 
  description?: string | null; 
  dimensions?: string | null; 
  priceVariations: Array<{ class_name: string; price: number | string; }>;
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
    s = s.replace(/R\$\s*/gi, '').replace(/\s+/g, ''); 
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf('.') < s.lastIndexOf(',')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const num = parseFloat(s);
    if (isNaN(num)) return undefined;
    return Math.round(num * 100); // Converter para centavos e arredondar
}

interface ColumnMapping {
    modelColumnIndex?: number;
    descriptionColumnIndex?: number;
    priceClassColumnIndices: number[];
    dimensionsColumnIndex?: number;
    headerRowIndex: number; // Índice da linha que foi identificada como cabeçalho
}

async function analyzeSheetStructureWithAI(sheetDataSample: string, fullSheetDataForContext?: any[][]): Promise<AISheetStructureResponse | null> {
  if (!openai) return null;
  
  // Tentar encontrar a tabela de cores/classes no fullSheetDataForContext se fornecido
  let colorTableSample = "";
  if (fullSheetDataForContext) {
    let tableStartIndex = -1;
    let tableEndIndex = -1;
    for(let i = 0; i < fullSheetDataForContext.length; i++) {
      const rowText = fullSheetDataForContext[i].join(";").toUpperCase();
      if (rowText.includes("TABELA DE CORES") || rowText.includes("LEGENDA") || rowText.includes("ACABAMENTOS")) {
        tableStartIndex = i;
        break;
      }
    }
    if (tableStartIndex !== -1) {
      tableEndIndex = tableStartIndex;
      for (let i = tableStartIndex + 1; i < fullSheetDataForContext.length; i++) {
        const row = fullSheetDataForContext[i];
        // Uma heurística simples: parar se a linha tiver poucas colunas preenchidas ou parecer muito diferente
        if (!row || row.slice(0,3).filter(cell => cell !== null && String(cell).trim() !== "").length < 1) {
          break;
        }
        tableEndIndex = i;
      }
      colorTableSample = fullSheetDataForContext.slice(tableStartIndex, tableEndIndex + 1).map(row => row.join(";")).join("\n");
      console.log("[PricingProcessor V2 AI Structure] Tabela de definição de cores/classes encontrada e extraída para o prompt:", colorTableSample);
    }
  }

  const structuralAnalysisSystemPrompt = `
Você é um especialista em analisar a ESTRUTURA de planilhas de preços de móveis.
Sua tarefa é identificar cabeçalhos de colunas de produtos e quaisquer tabelas de definição de classes/cores/materiais.

Amostra PRINCIPAL da planilha (início dos dados, formato CSV ou similar baseado em texto):
${sheetDataSample}

${colorTableSample ? `INFORMAÇÃO ADICIONAL: Uma possível tabela de definição de classes/cores foi encontrada na planilha e está incluída abaixo:\n${colorTableSample}\nUse esta tabela para popular o campo 'classDefinitions'.` : "Nenhuma tabela de definição de classes/cores óbvia foi pré-identificada na amostra."}

Responda OBRIGATORIAMENTE em formato JSON com a seguinte estrutura:
{
  "productHeaderRowIndex": null | number,
  "modelColumnIndex": null | number,
  "descriptionColumnIndex": null | number,
  "priceColumnMapping": null | Array<{ "headerText": string, "columnIndex": number }>, 
  "dimensionsColumnIndex": null | number,
  "dataStartRowIndex": null | number, 
  "classDefinitions": null | Array<{ 
    "className": string, 
    "definition": { [key: string]: string } 
  }>
}

Instruções detalhadas para o campo 'classDefinitions':
- Extraia de tabelas de legenda/cores encontradas na planilha (use a INFORMAÇÃO ADICIONAL se fornecida).
- "className" deve ser o nome da classe principal (ex: "CLASSE 01", "TECIDOS GRUPO A").
- "definition" é um objeto chave-valor.
  - As CHAVES do objeto 'definition' devem ser os CABEÇALHOS da tabela de legenda (ex: "Cor", "Tecido", "Material", "Referência").
  - Os VALORES devem ser os dados correspondentes da tabela para aquela classe.
  - Se uma classe tem múltiplas entradas sob o mesmo cabeçalho na tabela de legenda (ex: CLASSE 01 tem várias cores sob um cabeçalho "Cor"), 
    crie chaves únicas e descritivas para cada entrada, como "Cor 1", "Cor 2" ou use o próprio valor se fizer sentido e for curto, 
    mas tente manter a chave original do cabeçalho se possível (ex: "Cores Disponíveis" como chave e um array de strings como valor, se a IA conseguir fazer isso, seria ideal, mas para JSON simples, "Cor 1", "Cor 2" é aceitável).
  - Exemplo Ideal (se a tabela de legenda permitir e a IA conseguir agrupar):
    { "className": "CLASSE 01", "definition": { "Cores Disponíveis": "AMARELO, AREIA", "Tecido Principal": "Algodão" } }
  - Exemplo Aceitável (se a IA extrair item a item da legenda):
    { "className": "CLASSE 01", "definition": { "Cor": "AMARELO" } }, 
    { "className": "CLASSE 01", "definition": { "Cor": "AREIA" } }, 
    { "className": "CLASSE 01", "definition": { "Tecido": "Algodão" } }
    (O frontend agrupará estas se o className for o mesmo)
  - Tente ser o mais fiel possível aos cabeçalhos e dados da tabela de legenda.

Se você não conseguir determinar um campo com confiança, retorne null para esse campo.
`;

  try {
    console.log("[PricingProcessor V2 AI Structure] Enviando amostra da planilha para análise estrutural. Amostra principal (primeiras linhas):");
    console.log(sheetDataSample.substring(0,1000) + "...");
    if (colorTableSample) {
      console.log("[PricingProcessor V2 AI Structure] Incluindo amostra da tabela de definição no prompt.");
    }

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: structuralAnalysisSystemPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const responseContent = aiResponse.choices[0]?.message?.content;
    if (responseContent) {
      console.log("[PricingProcessor V2 AI Structure] Resposta COMPLETA da IA para estrutura:", responseContent);
      const parsedResponse = JSON.parse(responseContent) as AISheetStructureResponse;
      if (parsedResponse.error) {
        console.warn("[PricingProcessor V2 AI Structure] IA retornou erro na análise estrutural:", parsedResponse.error);
        return null;
      }
      return parsedResponse;
    }
    return null;
  } catch (error) {
    console.error("[PricingProcessor V2 AI Structure] Erro ao analisar estrutura da planilha com IA:", error);
    return null;
  }
}

export async function processPricingFile(catalogId: number): Promise<ExtractedPriceItem[] | null> {
  console.log(`[PricingProcessor V2] Iniciando processamento do arquivo de preços para o catálogo ID: ${catalogId} USANDO IA V2.`);
  if (!openai) {
    console.error("[PricingProcessor V2] OpenAI client não inicializado. Verifique a API Key.");
    return null;
  }

  let catalog: Catalog | undefined;
  try {
    catalog = await storage.getCatalog(catalogId);
    if (!catalog || !catalog.pricingFileUrl) {
      console.log(`[PricingProcessor V2] Catálogo ID ${catalogId} ou URL do arquivo de preços não encontrado/vazio.`);
      return null;
    }

    const fileUrl = catalog.pricingFileUrl;
    const fileExtension = fileUrl.substring(fileUrl.lastIndexOf('.')).toLowerCase();
    if (fileExtension !== '.xlsx' && fileExtension !== '.xls') {
      console.log(`[PricingProcessor V2] Arquivo de preços (ID ${catalogId}) não é Excel (${fileExtension}). Processamento IA de preços focado em Excel por enquanto.`);
      return null;
    }

    const s3Key = extractS3KeyFromUrl(fileUrl);
    if (!s3Key) {
      console.error(`[PricingProcessor V2] Não foi possível extrair a chave S3 de: ${fileUrl} (ID: ${catalogId})`);
      return null;
    }

    const fileBuffer = await downloadFileFromS3(s3Key);
    if (!fileBuffer || !(fileBuffer instanceof Buffer)) {
      console.error(`[PricingProcessor V2] Falha ao baixar ou buffer inválido do S3: ${s3Key}`);
      return null;
    }
    console.log(`[PricingProcessor V2] Arquivo baixado (${(fileBuffer.length / 1024).toFixed(2)} KB). Lendo com xlsx...`);

    const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellNF: false, cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    let sheetData: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null, blankrows: false });

    // Adicionar lógica para encontrar a última linha real com dados
    let lastMeaningfulRowIndex = -1;
    const 최소_셀_개수 = 2; // Mínimo de células não vazias para considerar a linha significativa

    for (let i = sheetData.length - 1; i >= 0; i--) {
      const row = sheetData[i];
      if (row) {
        const nonEmptyCells = row.filter(cell => cell !== null && String(cell).trim() !== "");
        let hasMeaningfulContent = nonEmptyCells.length >= 최소_셀_개수;

        if (!hasMeaningfulContent && nonEmptyCells.length === 1 && row[0] !== null && String(row[0]).trim() !== "") {
            // Se tem só uma célula não vazia, mas é a coluna do modelo e parece um nome, considera
            const modelCellContent = String(row[0]).trim();
            if (modelCellContent.length > 3 && !/^[\d\s.,-]+$/.test(modelCellContent)) { // Não ser apenas números/símbolos
                hasMeaningfulContent = true;
            }
        }
        
        // Adicionar verificação se tem preços válidos, mesmo que poucas células
        if(!hasMeaningfulContent && row.length > 1) {
            for (const cell of row.slice(1)) {
                if (cell !== null && normalizePrice(cell) !== undefined && normalizePrice(cell) !== 0) {
                    hasMeaningfulContent = true;
                    break;
                }
            }
        }

        if (hasMeaningfulContent) {
          lastMeaningfulRowIndex = i;
          break;
        }
      }
    }

    if (lastMeaningfulRowIndex === -1) {
      console.log(`[PricingProcessor V2] Planilha (ID: ${catalogId}) parece estar completamente vazia ou sem dados significativos.`);
      return [];
    }

    // Cortar sheetData para incluir apenas até a última linha significativa
    sheetData = sheetData.slice(0, lastMeaningfulRowIndex + 1);
    console.log(`[PricingProcessor V2] Planilha efetivamente processada até a linha: ${lastMeaningfulRowIndex + 1}`);

    // Log para depurar a estrutura de sheetData
    console.log(`[PricingProcessor V2 DEBUG] Amostra sheetData (primeiras 15 linhas - ou total se menor):
${JSON.stringify(sheetData.slice(0, 15), null, 2)}
[FIM DEBUG sheetData]`);
    // E logar especificamente as linhas que podem conter "CUBO" para análise mais fácil
    const cuboStartIndex = sheetData.findIndex(row => row && row.some(cell => String(cell).toUpperCase().includes("CUBO")));
    if (cuboStartIndex !== -1) {
      console.log(`[PricingProcessor V2 DEBUG] Linhas ao redor de 'CUBO' (índice ${cuboStartIndex}):
${JSON.stringify(sheetData.slice(Math.max(0, cuboStartIndex - 2), cuboStartIndex + 10), null, 2)}
[FIM DEBUG CUBO em sheetData]`);
    }

    if (sheetData.length < 1) {
      console.log(`[PricingProcessor V2] Planilha (ID: ${catalogId}) vazia.`);
      return [];
    }

    const allExtractedItems: ExtractedPriceItem[] = [];
    let lastModelBase: string | undefined = undefined;

    // **1. ANÁLISE ESTRUTURAL INICIAL COM IA (NOVO)**
    // Converter uma amostra significativa da planilha para texto (ex: CSV simples)
    // Para simplificar, vamos converter as primeiras X linhas (ex: 50) e as últimas Y (ex: 20) para texto.
    // Uma abordagem mais completa poderia enviar a planilha inteira se não for gigantesca, ou usar OCR em imagem da planilha.
    const sampleForHeaderAnalysis = sheetData.slice(0, 30).map(row => row.join(';')).join('\n');
    
    const structureAnalysis = await analyzeSheetStructureWithAI(sampleForHeaderAnalysis, sheetData);

    let columnMapping: ColumnMapping | null = null;
    let actualDataStartRow = 0;

    if (structureAnalysis && structureAnalysis.productHeaderRowIndex !== null && structureAnalysis.productHeaderRowIndex !== undefined) {
        columnMapping = {
            modelColumnIndex: structureAnalysis.modelColumnIndex !== null ? structureAnalysis.modelColumnIndex : undefined,
            descriptionColumnIndex: structureAnalysis.descriptionColumnIndex !== null ? structureAnalysis.descriptionColumnIndex : undefined,
            priceClassColumnIndices: structureAnalysis.priceColumnMapping?.map(pc => pc.columnIndex).sort((a,b)=>a-b) || [],
            dimensionsColumnIndex: structureAnalysis.dimensionsColumnIndex !== null ? structureAnalysis.dimensionsColumnIndex : undefined,
            headerRowIndex: structureAnalysis.productHeaderRowIndex,
        };
        actualDataStartRow = structureAnalysis.dataStartRowIndex !== null && structureAnalysis.dataStartRowIndex !== undefined 
                                ? structureAnalysis.dataStartRowIndex 
                                : (columnMapping.headerRowIndex + 1);
        
        console.log("[PricingProcessor V2] Mapeamento de colunas DERIVADO DA IA ESTRUTURAL:", columnMapping);
        console.log(`[PricingProcessor V2] Início dos dados de produto (derivado da IA): Linha ${actualDataStartRow + 1}`);

        if (structureAnalysis.classDefinitions && structureAnalysis.classDefinitions.length > 0) {
            try {
                await storage.updateCatalogClassDefinitions(catalogId, structureAnalysis.classDefinitions);
                console.log(`[PricingProcessor V2] ${structureAnalysis.classDefinitions.length} definições de classe salvas para o catálogo ID ${catalogId}.`);
            } catch (storageError) {
                console.error(`[PricingProcessor V2] Erro ao salvar definições de classe para o catálogo ID ${catalogId}:`, storageError);
            }
        }
    } else {
        console.warn("[PricingProcessor V2] Análise estrutural da IA não retornou cabeçalhos válidos. Tentando fallback ou processamento manual de cabeçalho (LÓGICA DE FALLBACK AINDA NÃO IMPLEMENTADA TOTALMENTE - USANDO INÍCIO DA PLANILHA).");
        // Fallback MUITO simples se a IA estrutural falhar (manter lógica anterior ou simplificar)
        actualDataStartRow = 0; // Começar do início como último recurso
        // Aqui poderíamos tentar a antiga `findColumnHeaders` como fallback, ou apenas assumir as primeiras colunas.
        // Por ora, para manter o fluxo, se a IA estrutural falhar, o columnMapping pode ficar null e o loop abaixo pode ter problemas.
    }

    // Novo prompt para a IA, focado em uma única linha
    const singleLineSystemPrompt = `Você é um assistente especialista em analisar dados de UMA ÚNICA LINHA de uma planilha de preços de móveis e extrair informações estruturadas.

Dados da linha fornecidos pelo usuário:
- 'MODELO_CELL': Conteúdo da célula que provavelmente é o Nome/Modelo do produto.
- 'DESC_CELL': Conteúdo da célula que provavelmente é a Descrição/Variação.
- 'PRICE_CELLS': Um array de objetos {header: string, value: string} representando colunas de preço (ex: {header: "CLASSE 01", value: "1234.56"}).
- 'DIM_CELL': Conteúdo da célula que provavelmente são as Dimensões.
- 'ALL_CELLS': Um array com todos os valores da linha, na ordem em que aparecem.
- 'LAST_MODEL_BASE': O model_base extraído da linha anterior, se aplicável (pode ser null).

Sua tarefa é extrair os seguintes campos para esta ÚNICA LINHA:
1.  **name**: (String) O nome completo da variação do produto, idealmente o conteúdo de 'MODELO_CELL'. Se 'MODELO_CELL' estiver vazio mas 'DESC_CELL' parecer um nome completo, use 'DESC_CELL'.
2.  **model_base**: (String) O nome principal da família do produto.
    *   Se 'MODELO_CELL' contiver um nome como "CHESTERFIELD I", o model_base é "CHESTERFIELD I".
    *   Se 'MODELO_CELL' for "BORA C/ASSENTO 0,63", o model_base é "BORA".
    *   Se 'MODELO_CELL' estiver vazio ou não parecer um nome de modelo principal, e 'LAST_MODEL_BASE' for fornecido, use 'LAST_MODEL_BASE'.
    *   Se 'MODELO_CELL' estiver vazio e 'LAST_MODEL_BASE' for nulo, tente inferir um model_base a partir de 'DESC_CELL' ou de 'name'.
3.  **variation_description**: (String | null) A descrição específica da variação. 
    *   Normalmente, o conteúdo de 'DESC_CELL'.
    *   Se 'MODELO_CELL' era "BORA C/ASSENTO 0,63" e 'model_base' é "BORA", então variation_description pode ser "C/ASSENTO 0,63".
    *   Se 'DESC_CELL' estiver vazio, pode ser null.
4.  **priceVariations**: (Array de { class_name: string, price: number }) Classes de preço e valores. 
    *   Use os dados de 'PRICE_CELLS'. O 'header' é class_name. Converta 'value' para um NÚMERO (ex: "1234.56" ou "1234,56" se torna 1234.56). Ignore preços zerados ou inválidos.
5.  **dimensions**: (String | null) As dimensões da variação, idealmente o conteúdo de 'DIM_CELL'.

Responda OBRIGATORIAMENTE em formato JSON com APENAS o objeto do produto extraído para esta linha. Não inclua chaves extras como "products".
Exemplo de Saída:
{
  "name": "BORA C/ASSENTO 0,63",
  "model_base": "BORA",
  "variation_description": "sofá 1 lug c/ 1 braço",
  "priceVariations": [{ "class_name": "CLASSE 01", "price": 3390.00 }, { "class_name": "CLASSE 02", "price": 3899.00 }],
  "dimensions": "0,85X F 0,96 A 1,59 X 1,00"
}
Se a linha não parecer um produto válido (ex: totalmente vazia, lixo, ou um subtotal claro), retorne null.
`;

    for (let rowIndex = actualDataStartRow; rowIndex < sheetData.length; rowIndex++) {
        const row = sheetData[rowIndex];
        if (!row || row.every(cell => cell === null || String(cell).trim() === "")) {
            console.log(`[PricingProcessor V2] Linha ${rowIndex + 1} pulada: completamente vazia.`);
            continue;
        }

        // Preparar dados da linha para a IA
        const modelValue = columnMapping?.modelColumnIndex !== undefined && row[columnMapping.modelColumnIndex] ? String(row[columnMapping.modelColumnIndex]).trim() : null;
        const descriptionValue = columnMapping?.descriptionColumnIndex !== undefined && row[columnMapping.descriptionColumnIndex] ? String(row[columnMapping.descriptionColumnIndex]).trim() : null;
        const dimensionsValue = columnMapping?.dimensionsColumnIndex !== undefined && row[columnMapping.dimensionsColumnIndex] ? String(row[columnMapping.dimensionsColumnIndex]).trim() : null;
        
        const priceCellsData: {header: string, value: string}[] = [];
        let hasMeaningfulPriceInDataColumns = false;
        if (columnMapping?.priceClassColumnIndices) {
            columnMapping.priceClassColumnIndices.forEach(idx => {
                if (row[idx] !== null && row[idx] !== undefined) {
                    const headerRow = sheetData[columnMapping.headerRowIndex];
                    const headerText = headerRow && headerRow[idx] ? String(headerRow[idx]).trim() : `CLASSE_COL_${idx}`;
                    const cellPriceValue = String(row[idx]).trim();
                    priceCellsData.push({ header: headerText, value: cellPriceValue });
                    if (cellPriceValue && normalizePrice(cellPriceValue) !== undefined && normalizePrice(cellPriceValue) !== 0) {
                        hasMeaningfulPriceInDataColumns = true;
                    }
                }
            });
        }

        // Se não temos nome do modelo nem descrição, E não temos preços significativos NAS COLUNAS MAPEADAS,
        // então é provável que não seja uma variação válida do item anterior.
        if (!modelValue && !descriptionValue && !hasMeaningfulPriceInDataColumns) {
            console.log(`[PricingProcessor V2] Linha ${rowIndex + 1} pulada: sem modelo/descrição e sem preços significativos nas colunas mapeadas. Resetando lastModelBase.`);
            lastModelBase = undefined; // Resetar o lastModelBase para não propagar para lixo
            continue;
        }

        // Se não temos mapeamento de coluna, ou se o valor do modelo é muito curto/genérico e temos descrição,
        // pode ser que a descrição seja o campo principal.
        let primaryNameCandidate = modelValue;
        if (!columnMapping && descriptionValue && (!modelValue || modelValue.length < 5)) {
            primaryNameCandidate = descriptionValue;
        }
        if (!primaryNameCandidate && modelValue) { // Se primaryNameCandidate ainda é nulo, mas temos modelValue
            primaryNameCandidate = modelValue;
        }

        // Se mesmo após as tentativas, não temos um nome/modelo razoável, pular a linha
        // A não ser que tenhamos colunas de preço com valores, o que pode indicar um item válido sem nome claro.
        // Modificado para usar hasMeaningfulPriceInDataColumns
        if (!primaryNameCandidate && !hasMeaningfulPriceInDataColumns) {
            console.log(`[PricingProcessor V2] Linha ${rowIndex + 1} pulada: sem nome/modelo principal claro e sem preços significativos (após checagem de primaryNameCandidate).`);
            lastModelBase = undefined; // Também resetar aqui por segurança
            continue;
        }

        const lineInputForAI = {
            MODELO_CELL: modelValue,
            DESC_CELL: descriptionValue,
            PRICE_CELLS: priceCellsData,
            DIM_CELL: dimensionsValue,
            ALL_CELLS: row.map(cell => cell === null || cell === undefined ? null : String(cell).trim()),
            LAST_MODEL_BASE: lastModelBase
        };

        console.log(`[PricingProcessor V2] Enviando Linha ${rowIndex + 1} para IA: MODELO_CELL: '${modelValue}', LAST_MODEL_BASE: '${lastModelBase}'`);

    try {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
                    { role: "system", content: singleLineSystemPrompt },
                    { role: "user", content: JSON.stringify(lineInputForAI) }
        ],
        response_format: { type: "json_object" }, 
                temperature: 0.1, 
      });

      const responseContent = aiResponse.choices[0]?.message?.content;
            if (responseContent) {
                console.log(`[PricingProcessor V2] Resposta da IA para linha ${rowIndex + 1} (primeiros 300 chars): ${responseContent.substring(0,300)}`);
                try {
                    const extractedProductData = JSON.parse(responseContent);
                    if (extractedProductData && extractedProductData.name && extractedProductData.model_base) { // Verificar campos essenciais
                        
                        const prices: PriceInfo[] = (extractedProductData.priceVariations || []).map((pv: any) => {
          const normalized = normalizePrice(pv.price);
          return {
                                className: pv.class_name || 'N/A',
            value: normalized !== undefined ? normalized : -1 
          };
                        }).filter((p: PriceInfo) => p.value !== -1);

                        const newItem: ExtractedPriceItem = {
                            name: extractedProductData.name,
                            model_base: extractedProductData.model_base,
                            variation_description: extractedProductData.variation_description || null,
          prices: prices.length > 0 ? prices : undefined,
                            dimensions: extractedProductData.dimensions || null,
                            // rawAIReponse: extractedProductData // Opcional para debug
                        };
                        allExtractedItems.push(newItem);
                        lastModelBase = extractedProductData.model_base; // Atualizar para a próxima linha
                        console.log(`[PricingProcessor V2] Item extraído da linha ${rowIndex + 1}: ${newItem.name} (Base: ${newItem.model_base})`);
                    } else if (extractedProductData === null) {
                        console.log(`[PricingProcessor V2] IA indicou que linha ${rowIndex + 1} não é um produto válido.`);
                    } else {
                        console.warn(`[PricingProcessor V2] IA não retornou dados de produto válidos para linha ${rowIndex + 1}. Resposta:`, extractedProductData);
                    }
                } catch (parseError) {
                    console.error(`[PricingProcessor V2] Erro ao parsear JSON da IA para linha ${rowIndex + 1}:`, parseError, `Conteúdo: ${responseContent}`);
                }
            } else {
                console.warn(`[PricingProcessor V2] Resposta da IA vazia para linha ${rowIndex + 1}.`);
            }
        } catch (aiError) {
            console.error(`[PricingProcessor V2] Erro na chamada da API OpenAI para linha ${rowIndex + 1}:`, aiError);
            // Considerar se deve parar ou continuar para a próxima linha
        }
        // Adicionar um pequeno delay para não sobrecarregar a API, se necessário
        if (rowIndex < sheetData.length -1) await new Promise(resolve => setTimeout(resolve, 200)); 

    }

    // TODO: Remover este log de amostra quando a IA estiver integrada no loop
    if (allExtractedItems.length > 0) {
        const itemsToLog = allExtractedItems.filter(item => item.name && item.name.toLowerCase().includes('chesterfield'));
        if (itemsToLog.length > 0) {
            console.log(`[PricingProcessor V2 DEBUG Chesterfield] Itens extraídos da planilha contendo 'chesterfield':`, JSON.stringify(itemsToLog.map(item => ({name: item.name, model_base: item.model_base, variation_description: item.variation_description, prices: item.prices})), null, 2));
        }
        console.log(`[PricingProcessor V2] Amostra (até 5) de TODOS os itens extraídos pela IA:`, JSON.stringify(allExtractedItems.slice(0, 5).map(item => ({name: item.name, model_base: item.model_base, variation_description: item.variation_description, prices: item.prices})), null, 2));
      }

    // TODO: Processar e armazenar `parsedAIResponse.classDefinitions` se presente.
    // A extração de classDefinitions precisará ser repensada. 
    // Talvez uma chamada separada à IA no início para analisar a estrutura geral e cabeçalhos?
    // Ou a IA que processa linha a linha pode ser instruída a também retornar classDefinitions se as encontrar.
    /*
    if (parsedAIResponse.classDefinitions && parsedAIResponse.classDefinitions.length > 0) {
// ... existing code ...
    }
    */

    return allExtractedItems; // Retornar os itens extraídos

  } catch (error) {
    console.error(`[PricingProcessor V2] Erro GERAL ao processar arquivo de preços para o catálogo ID ${catalogId}:`, error);
    return null;
  }
} 