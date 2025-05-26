import { storage } from './storage';
// @ts-ignore
import { processExcelWithAI, verifyImageMatchWithVision, describeImageWithVision } from './ai-excel-processor.js';
// @ts-ignore
import { uploadBufferToS3, downloadFileFromS3 } from './s3-service';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx'; // Importar XLSX para ler o arquivo
import { spawn } from 'child_process'; // Importar spawn
import { Product, InsertProduct } from '@shared/schema'; // Importar tipo Product e InsertProduct
import { getClipEmbeddingFromImageUrl } from './clip-service'; // ADICIONAR ESTA LINHA
import { ImageAnnotatorClient } from '@google-cloud/vision'; // Adicionado
import { Storage } from '@google-cloud/storage'; // Adicionado para GCS

// Adicionar imports para OpenAI e o modelo de embedding
import OpenAI from "openai";
// @ts-ignore
import { processPricingFile, ExtractedPriceItem } from './pricing-file-processor.js'; // Importando a nova função
// @ts-ignore
import { fuseCatalogData } from './catalog-fusion-service.js'; // Importando a função de fusão
// REMOVIDO: import { fromBuffer } from "pdf2pic"; 

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = 'text-embedding-3-small'; // Mesmo modelo usado em ai-design-processor
const OPENAI_TEXT_EXTRACTION_MODEL = 'gpt-4o'; // Modelo para extrair produtos do texto OCR

// Interface para dados do Python (linha + base64 + sheet_name)
interface ExtractedImageData {
  anchor_row: number;
  image_base_64: string;
  sheet_name: string;
}

// Interface para dados da imagem após upload S3
interface UploadedImageInfo {
    imageUrl: string;
    anchorRow: number;
    sheetName: string;
}

// Interface para os dados necessários para processar um catálogo
interface CatalogJobData {
  catalogId: number;
  userId: number | string;
  s3Key: string;
  processingFilePath: string; // Caminho local temporário do arquivo baixado do S3
  fileName: string;
  fileType: string;
  uploadMode: 'complete' | 'separate';
  pricingFileS3Key?: string | null;
}

// Lista de palavras-chave ESSENCIAIS para tipos de móveis (manter em minúsculas e sem acentos)
const FURNITURE_KEYWORDS = [
    'sofa', 'cadeira', 'poltrona', 'mesa', 'banco', 'banqueta', 'puff', 
    'buffet', 'aparador', 'rack', 'estante', 'cama', 'colchao', 
    'cabeceira', 'escrivaninha', 'criado', 'mudo', 'comoda', 'armario', 'roupeiro', 'espelho' 
];

// Função auxiliar para rodar o novo script Python
async function runPythonImageRowExtractor(excelFilePath: string): Promise<{ images: ExtractedImageData[], error?: string }> {
  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'server', 'python-scripts', 'extract_images_by_row.py');
    console.log(`Executando script Python de imagem/linha: ${pythonScriptPath}`);
    const pythonProcess = spawn('python3', [pythonScriptPath, excelFilePath]);
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      // Logar output de erro do python em tempo real para debug
      console.error(`[Python ERR]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) { // Se o Python rodou sem erros (código 0)
        try {
          // Adicionado tratamento para stdout potencialmente vazio
          if (!stdoutData.trim()) {
            console.warn("Script Python (img/row) retornou stdout vazio, mas com código 0.");
            resolve({ images: [], error: "Python stdout vazio." }); // Considera sucesso, mas sem imagens
            return;
          }
          const result = JSON.parse(stdoutData);
          resolve(result); // Resolva a Promise com o resultado JSON
        } catch (parseError) { // Se deu erro ao ler o resultado JSON
          console.error("Erro ao parsear JSON do Python:", parseError);
          reject(new Error(`Erro ao parsear JSON do Python: ${String(parseError)}. Output: ${stdoutData}`)); // Rejeita a Promise com erro de parse
        }
      } else { // Se o Python terminou com erro (código diferente de 0)
        reject(new Error(`Script Python falhou com código ${code}. Erro: ${stderrData}`)); // Rejeita a Promise com o erro do Python
      }
    }); // Fim do 'on close'

    pythonProcess.on('error', (err) => { // Se deu erro ao tentar iniciar o Python
      console.error("Erro ao iniciar processo Python:", err);
      reject(err); // Rejeita a Promise com o erro de inicialização
    });

  }); // Fim do new Promise
} // Fim da função runPythonImageRowExtractor

// Função auxiliar RENOMEADA e MELHORADA para comparar tipo de móvel
function compareFurnitureType(productText: string | null | undefined, imageDescription: string | null | undefined): boolean {
    if (!productText || !imageDescription) return false;
    
    const normalize = (str: string): string[] => 
        str.toLowerCase()
           .normalize("NFD")
           .replace(/[\u0300-\u036f]/g, "") 
           .replace(/[^a-z0-9\s]/g, '')
           .trim()
           .split(' ')
           .filter(w => w.length > 2); 

    const productWords = normalize(productText);
    const descriptionWords = normalize(imageDescription);
    
    const productTypeKeyword = productWords.find(pw => FURNITURE_KEYWORDS.includes(pw));
    const descriptionTypeKeyword = descriptionWords.find(dw => FURNITURE_KEYWORDS.includes(dw));

    console.log(`[Type Check] Prod Keywords: [${productWords.join(', ')}], IA Desc Keywords: [${descriptionWords.join(', ')}]`);
    console.log(`[Type Check]   Prod Type: ${productTypeKeyword || 'N/A'}, IA Desc Type: ${descriptionTypeKeyword || 'N/A'}`);

    if (productTypeKeyword && descriptionTypeKeyword && productTypeKeyword === descriptionTypeKeyword) {
        console.log(`[Type Check]   >>> MATCH! <<< (Keyword: ${productTypeKeyword})`);
        return true;
    }
    
    if ((productTypeKeyword === 'poltrona' && descriptionTypeKeyword === 'cadeira') || 
        (productTypeKeyword === 'cadeira' && descriptionTypeKeyword === 'poltrona')) {
        console.log(`[Type Check]   >>> MATCH (Cadeira/Poltrona)! <<<`);
        return true;    
    }
    if ((productTypeKeyword === 'buffet' && descriptionTypeKeyword === 'aparador') || 
        (productTypeKeyword === 'aparador' && descriptionTypeKeyword === 'buffet')) {
        console.log(`[Type Check]   >>> MATCH (Buffet/Aparador)! <<<`);
        return true;    
    }

    console.log(`[Type Check]   NÃO MATCH.`);
    return false;
}

interface AIAVisionProductExtraction {
    name?: string;
    description?: string;
    code?: string;
    dimensions?: string;
    category_hint?: string | null; 
    materials_hint?: string[] | null; 
    colors_hint?: string[] | null; 
}

interface AIAVisionExtractionResponse {
    products: AIAVisionProductExtraction[];
    error?: string;
}

// NOVA FUNÇÃO AUXILIAR
async function extractProductsFromTextWithOpenAI(
    pageText: string,
    catalogId: number,
    pageNumberForContext: number
): Promise<AIAVisionProductExtraction[]> {
    if (!pageText.trim()) {
        console.log(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] Texto da página vazio, pulando extração.`);
        return [];
    }

    // PROMPT REFINADO COM SUGESTÕES DO USUÁRIO E ANÁLISE DOS LOGS
    const systemPromptForTextExtraction = `Você é um assistente de IA ultra especializado em analisar texto extraído (via OCR) de páginas de catálogos de móveis e identificar produtos. O texto fornecido é o conteúdo OCR bruto de UMA ÚNICA PÁGINA de um catálogo.

Seu objetivo é identificar CADA PRODUTO DE MOBILIÁRIO principal descrito ou proeminentemente apresentado nesta página, OU especificações detalhadas que claramente pertençam a um produto de mobiliário (mesmo que o nome do modelo não esteja nesta página). Ignore informações genéricas da empresa, texto de capa, índices, ou seções que não descrevem um produto específico. Se a página for claramente uma capa ou índice sem produtos, retorne uma lista vazia.

Para CADA MÓVEL principal identificado OU conjunto de especificações de produto, extraia os seguintes detalhes e formate-os como um objeto JSON dentro de um array "products". **Não preencha campos com inferências ou suposições vagas. Se a informação não estiver explicitamente presente ou claramente inferível a partir do texto fornecido para o produto específico, retorne null para esse campo.**

- "name": (String) O nome principal do produto.
    - **Prioridade 1:** Capture o nome mais completo e específico do modelo ou coleção, se disponível (ex: "Sofá Apgar", "Poltrona Costela"). Evite nomes genéricos como apenas 'sofá' ou 'cadeira' se houver um modelo ou nome de linha mais específico associado no texto.
    - **Prioridade 2 (Se o nome do modelo NÃO estiver nesta página, mas houver especificações claras):** Use um nome genérico baseado na "category_hint" inferida (ex: "Sofá", "Poltrona", "Mesa") e adicione um sufixo como "(ver especificações)", resultando em algo como "Sofá (ver especificações)".
    - **Prioridade 3 (Se nem categoria puder ser inferida, mas há especificações):** Use "Produto (ver especificações)".
    - **Se a página contiver apenas um nome de modelo (ex: "Apgar") e nenhuma outra especificação detalhada, NÃO crie um produto apenas com o nome. Espere por uma página com mais detalhes.**
- "description": (String) Uma descrição concisa. **Combine informações técnicas e estilísticas sobre o produto, mesmo que estejam dispersas no texto da página, formando frases claras e informativas.** (ex: "Encosto com fibra siliconada e sustentação por cinta elástica. Assento em espuma D26 HR soft envolvida por plumante e molas zig zag. Estrutura em madeira eucalipto e chapa MDF. Pés em madeira.").
- "code": (String | null) Se um código de produto (SKU, referência, CÓD. AC) estiver explicitamente associado ao móvel no texto desta página, extraia-o. Caso contrário, retorne null.
- "dimensions": (String | null) Medidas do produto se mencionadas, no formato encontrado no texto (ex: "1,80 x 0,95 x 0,91", "L: 220cm A: 90cm P: 85cm", "Diâmetro: 100cm", ou blocos de números próximos a desenhos técnicos como "0,91 0,95 2,25 0,95 2,03"). Tente capturar todas as dimensões relevantes apresentadas. Caso não existam ou não sejam claras para este produto, retorne null.
- "category_hint": (String | null) Com base no nome e na descrição, infira a categoria principal do móvel (exemplos comuns: "Sofá", "Poltrona", "Cadeira", "Mesa de Jantar", "Mesa de Centro", "Mesa Lateral", "Aparador", "Buffet", "Rack", "Painel de TV", "Cama", "Cabeceira", "Cômoda", "Criado-Mudo", "Guarda-Roupa", "Estante", "Luminária", "Tapete", "Almofada", "Puff"). Se não puder inferir com alta confiança, retorne null.
- "materials_hint": (Array de Strings | null) Se materiais específicos forem mencionados em associação direta com o produto no texto (ex: "Madeira Eucalipto", "Chapa MDF", "Fibra Siliconada", "Espuma D26", "Veludo", "Couro"), liste-os como um array de strings. Se nenhum material for claramente identificado para o produto, retorne null ou um array vazio.
- "colors_hint": (Array de Strings | null) Se cores específicas forem mencionadas em associação direta com o produto no texto (ex: "Cinza Claro", "Preto Fosco"), liste-as como um array de strings. Se nenhuma cor for claramente identificada para o produto, retorne null ou um array vazio.

INSTRUÇÕES IMPORTANTES:
1.  FOCO NO PRODUTO OU ESPECIFICAÇÕES: Se a página contiver múltiplas seções ou informações dispersas, concentre-se em extrair informações que claramente pertençam a um produto de mobiliário específico ou a um conjunto de especificações de um produto.
2.  PÁGINAS SEM PRODUTOS/ESPECIFICAÇÕES CLARAS: Se o texto da página for claramente uma capa com apenas um nome de modelo, índice, página de introdução da empresa, ou não contiver nenhuma descrição de produto de mobiliário ou especificações técnicas detalhadas, retorne um JSON com uma lista "products" vazia: { "products": [] }.
3.  TEXTO OCR: Lembre-se que o texto é resultado de OCR e pode conter pequenos erros ou formatação imperfeita. Tente ser robusto a isso.
4.  UMA PÁGINA POR VEZ: O texto fornecido é de APENAS UMA PÁGINA. Não tente inferir informações de outras páginas.
5.  FORMATO DA RESPOSTA: Responda APENAS com o objeto JSON contendo a chave "products", cujo valor é um array dos objetos de produto extraídos. Não inclua nenhuma outra explicação ou texto introdutório na sua resposta.

EXEMPLO DE TEXTO DE ENTRADA (OCR de uma página de especificações SEM nome do modelo):
"Especificações\nEncosto\nFibra siliconada com sustentação por cinta elástica\nAssento\nEspuma D26 hr soft de alta resiliência envolvida por plumante e mola zig zag\nEstrutura\nMadeira eucalipto de reflorestamento e chapa MDF\nPés\nMadeira\n0,91 0,95 2,25 0,95 2,03"

EXEMPLO DE SAÍDA JSON ESPERADA PARA O TEXTO ACIMA (assumindo que a IA infere a categoria "Sofá"):
{
  "products": [
    {
      "name": "Sofá (ver especificações)",
      "description": "Encosto com fibra siliconada e sustentação por cinta elástica. Assento em espuma D26 hr soft de alta resiliência envolvida por plumante e mola zig zag. Estrutura em madeira eucalipto de reflorestamento e chapa MDF. Pés em madeira.",
      "code": null,
      "dimensions": "0,91 0,95 2,25 0,95 2,03",
      "category_hint": "Sofá",
      "materials_hint": ["Fibra siliconada", "Cinta elástica", "Espuma D26 hr soft", "Plumante", "Mola zig zag", "Madeira eucalipto", "Chapa MDF", "Madeira"],
      "colors_hint": null
    }
  ]
}
`;

    try {
        console.log(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] Enviando texto OCR (comprimento: ${pageText.length}) para ${OPENAI_TEXT_EXTRACTION_MODEL} para extração de produtos.`);
        // Logar apenas uma parte do texto se for muito grande para os logs principais
        if (pageText.length > 500) {
            console.log(`    Primeiros 250 chars: ${pageText.substring(0,250).replace(/\n/g, ' ')}...`);
            console.log(`    Últimos 250 chars: ...${pageText.substring(pageText.length - 250).replace(/\n/g, ' ')}`);
        } else {
            console.log(`    Texto completo: ${pageText.replace(/\n/g, ' ')}`);
        }

        const response = await openai.chat.completions.create({
            model: OPENAI_TEXT_EXTRACTION_MODEL,
            messages: [
                { role: "system", content: systemPromptForTextExtraction },
                { role: "user", content: `Aqui está o texto OCR da página do catálogo:\n\n${pageText}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1, 
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.warn(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] ${OPENAI_TEXT_EXTRACTION_MODEL} não retornou conteúdo.`);
            return [];
        }

        const parsedResponse = JSON.parse(content);
        if (parsedResponse.products && Array.isArray(parsedResponse.products)) {
            console.log(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] ${OPENAI_TEXT_EXTRACTION_MODEL} extraiu ${parsedResponse.products.length} produtos.`);
            return parsedResponse.products as AIAVisionProductExtraction[];
        }
        console.warn(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] Resposta da IA não continha um array 'products' válido. Conteúdo:`, content.substring(0,500));
        return [];

    } catch (error) {
        console.error(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] Erro ao chamar API OpenAI ou parsear resposta:`, error);
        return [];
    }
}

/**
 * Processa um catálogo em background (extrai dados, imagens, associa).
 * Atualiza o status do catálogo no banco de dados.
 */
export async function processCatalogInBackground(jobData: CatalogJobData): Promise<void> {
  const { catalogId, userId, s3Key, fileName, fileType, uploadMode, pricingFileS3Key } = jobData;
  console.log(`[BG Proc ${catalogId}] INICIANDO: ${fileName}, Tipo: ${fileType}, ModoUpload: ${uploadMode}, ArqPreçoS3: ${pricingFileS3Key || 'N/A'}`);

  let localTempFilePath: string | null = null;
  let rawExtractedProducts: AIAVisionProductExtraction[] = []; 
  let savedLocalProducts: Product[] = [];
  let uploadedImages: UploadedImageInfo[] = [];
  let extractionInfo = `Upload modo '${uploadMode}'. Artístico/Principal: ${fileType}.`;
  let pricingDataResult: ExtractedPriceItem[] | null = null;
  
  const MAX_PAGES_TO_PROCESS_WITH_OPENAI = 20; // AUMENTADO PARA 20 PÁGINAS PARA COLETA DE DADOS
  let potentialProductNameFromPreviousPage: string | null = null; // Nova variável

  let visionClient: ImageAnnotatorClient | null = null;
  const gcpCredentialsJsonString = process.env.GCP_CREDENTIALS_JSON;
  let gcsStorage: Storage | null = null;
  const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

  if (fileType === 'pdf') {
      if (gcpCredentialsJsonString) {
          try {
              const credentials = JSON.parse(gcpCredentialsJsonString);
              visionClient = new ImageAnnotatorClient({ credentials });
              gcsStorage = new Storage({ credentials }); 
              console.log("[BG Proc] Clientes Google Vision e Storage inicializados com JSON de credenciais do Secret.");
          } catch (e) {
              console.error("[BG Proc] Erro ao parsear/inicializar clientes Google com JSON de credenciais. Tentando inicialização padrão.", e);
              visionClient = new ImageAnnotatorClient();
              gcsStorage = new Storage();
              console.log("[BG Proc] Clientes Google Vision e Storage inicializados com método padrão.");
          }
      } else {
          console.warn("[BG Proc] Secret GCP_CREDENTIALS_JSON não encontrado. Tentando inicialização padrão dos clientes Google.");
          visionClient = new ImageAnnotatorClient();
          gcsStorage = new Storage();
          console.log("[BG Proc] Clientes Google Vision e Storage inicializados com método padrão.");
      }
  }
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    localTempFilePath = path.join(tempDir, `${catalogId}-${Date.now()}-${path.basename(fileName)}`);
    const fileBufferFromS3 = await downloadFileFromS3(s3Key);
    fs.writeFileSync(localTempFilePath, fileBufferFromS3);
    console.log(`[BG Proc ${catalogId}] Download do arquivo principal S3 (${s3Key}) concluído: ${localTempFilePath}.`);
    await storage.updateCatalogStatus(catalogId, 'processing');
    const localUserIdNum = typeof userId === 'number' ? userId : parseInt(userId.toString());

    if (fileType === 'xlsx' || fileType === 'xls') {
      console.log(`[BG Proc ${catalogId}] Processando ARQUIVO PRINCIPAL Excel: ${localTempFilePath}`);
        const workbook = XLSX.read(fileBufferFromS3, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawSheetData = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: null });
      let produtos_excel_ia: any[] = []; 
        const CHUNK_SIZE = 25;
      for (let i = 0; i < rawSheetData.length; i += CHUNK_SIZE) {
        const chunk = rawSheetData.slice(i, i + CHUNK_SIZE);
        const chunkComNumLinha = chunk.map((r: any, idx: number) => ({ excelRowNumber: i + idx + 1, ...r }));
        try {
          const resultadoIA = await processExcelWithAI(chunkComNumLinha);
          if (resultadoIA?.products) {
            produtos_excel_ia.push(...resultadoIA.products.filter((p: any) => p.name && p.excelRowNumber > 0));
          }
        } catch (e) { console.error(`[BG Proc ${catalogId}] Erro IA Excel bloco ${i/CHUNK_SIZE +1}:`, e); }
        if (i + CHUNK_SIZE < rawSheetData.length && openai) await new Promise(r => setTimeout(r, 1000));
      }
      rawExtractedProducts = produtos_excel_ia.map(p => ({ 
        name: p.name, 
        description: p.description,
        code: p.code,
        dimensions: p.sizes?.map((s:any) => s.label).join('; ') || p.dimensions, 
        category_hint: p.category,
        materials_hint: p.materials,
        colors_hint: p.colors
      }));
      extractionInfo += ` | Principal(Excel): ${rawExtractedProducts.length} produtos brutos da IA.`;
        savedLocalProducts = []; 
      for (const pData of produtos_excel_ia) { 
          try {
            let embeddingVector: number[] | null = null;
          const textForEmb = (`${pData.name || ''} ${pData.category || ''} ${pData.description || ''} ` +
                            `${pData.manufacturer || ''} ${(pData.colors || []).join(' ')} ` +
                            `${(pData.materials || []).join(' ')}`).replace(/s+/g, ' ').trim();
          if (textForEmb.length > 5 && openai) { 
              const embResp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: textForEmb, dimensions: 1536 });
              if (embResp.data?.length) embeddingVector = embResp.data[0].embedding;
          }
          const productToSave: InsertProduct = {
            userId: localUserIdNum, catalogId: catalogId, name: pData.name || 'Nome Indisponível',
            code: pData.code || null, description: pData.description || null,
            price: Math.round((typeof pData.price === 'number' ? pData.price : 0) * 100),
            category: pData.category || null, manufacturer: pData.manufacturer || null, 
            imageUrl: null, colors: pData.colors || [], materials: pData.materials || [], 
            sizes: pData.sizes || [], dimensions: pData.dimensions || null, 
            location: pData.location || null, stock: pData.stock || null,
            excelRowNumber: pData.excelRowNumber, isEdited: false, 
            embedding: embeddingVector, clipEmbedding: (pData.clipEmbedding as number[]|undefined) || null,
          };
          Object.keys(productToSave).forEach(k => (productToSave as any)[k] === undefined && delete (productToSave as any)[k]);
          const savedProd = await storage.createProduct(productToSave);
          savedLocalProducts.push(savedProd);
        } catch (dbError) { console.error(`[BG Proc ${catalogId}] Erro salvar produto Excel (Linha ${pData.excelRowNumber}):`, dbError); }
      }
      console.log(`[BG Proc ${catalogId}] ${savedLocalProducts.length} produtos do Excel Principal salvos.`);
      if (localTempFilePath) {
        console.log(`[BG Proc ${catalogId}] Extraindo imagens do Excel: ${localTempFilePath}...`);
        try {
          const pyResult = await runPythonImageRowExtractor(localTempFilePath);
          if (pyResult.images?.length) {
            const uploadPromises = pyResult.images.map(async (imgData: ExtractedImageData, index: number) => {
              const buffer = Buffer.from(imgData.image_base_64, 'base64');
              const imageName = `image_row${imgData.anchor_row}_idx${index}.png`;
              const s3ImgPath = `users/${localUserIdNum}/catalogs/${catalogId}/images/${imageName}`;
              const imgUrl = await uploadBufferToS3(buffer, s3ImgPath, 'image/png');
              return { imageUrl: imgUrl, anchorRow: imgData.anchor_row, sheetName: imgData.sheet_name };
            });
            const resolvedUploadedImages = (await Promise.all(uploadPromises)).filter(r => r !== null);
            uploadedImages = resolvedUploadedImages as UploadedImageInfo[];
            console.log(`[BG Proc ${catalogId}] Python extraiu e S3 upload concluiu para ${uploadedImages.length} imagens.`);
          } else {
            console.log(`[BG Proc ${catalogId}] Python não retornou imagens ou pyResult.images estava vazio.`);
          }
        } catch (pyErr) { 
            console.error(`[BG Proc ${catalogId}] Erro script Python imagem Excel:`, pyErr); 
            extractionInfo += " (Falha na extração de imagens Python)";
        }
      }
      if (savedLocalProducts.length > 0 && uploadedImages.length > 0 && openai) {
        console.log(`[BG Proc ${catalogId}] Iniciando Associação v5 (IA Vision + Fallback) e Embedding para ${uploadedImages.length} imagens e ${savedLocalProducts.length} produtos.`);
        let associatedCount = 0;
        const imageAssociatedFlags = new Map<string, boolean>(); 
        for (const product of savedLocalProducts) {
            const productRowAny: any = product.excelRowNumber;
            if (typeof productRowAny !== 'number' || isNaN(productRowAny) || productRowAny <= 0) {
                console.warn(`[Assoc v5] Produto ID ${product.id} (${product.name}) sem linha Excel (excelRowNumber) válida (${productRowAny}). Pulando associação de imagem.`);
                continue;
            }
            const productRow: number = productRowAny;
            const productDetailsForVision = {
                name: product.name,
                code: product.code,
                description: product.description,
                category: product.category,
                manufacturer: product.manufacturer,
                colors: product.colors as string[] | undefined, 
                materials: product.materials as string[] | undefined 
            };
            let associatedImageInfo: UploadedImageInfo | undefined = undefined;
            let visionConfirmedMatch = false;
            const candidateImages = uploadedImages.filter(img => img.anchorRow === productRow);
            if (candidateImages.length > 0) {
                const evaluatedCandidates: { image: UploadedImageInfo, result: { match: boolean, reason: string } | null }[] = [];
                for (const candidateImage of candidateImages) {
                    if (imageAssociatedFlags.has(candidateImage.imageUrl)) { continue; }
                    await new Promise(resolve => setTimeout(resolve, 1000)); 
                    const visionResult = await verifyImageMatchWithVision(productDetailsForVision, candidateImage.imageUrl);
                    evaluatedCandidates.push({ image: candidateImage, result: visionResult });
                }
                const matches = evaluatedCandidates.filter(c => c.result && c.result.match === true);
                if (matches.length === 1) {
                    console.log(`[Assoc v5]   >>> IA VISION CONFIRMOU MATCH ÚNICO na linha ${productRow} para produto ${product.id}! <<<`);
                    associatedImageInfo = matches[0].image;
                    visionConfirmedMatch = true;
                } else if (matches.length > 1) {
                    console.warn(`[Assoc v5]   AMBIGUIDADE IA na linha ${productRow} para produto ${product.id}: ${matches.length} imagens retornaram 'match: true'. Nenhuma será associada por IA nesta etapa.`);
                } 
            }
            if (!associatedImageInfo && candidateImages.length > 0) {
                const unusedCandidatesOnRow = candidateImages.filter(img => !imageAssociatedFlags.has(img.imageUrl));
                if (unusedCandidatesOnRow.length === 1) {
                    console.log(`[Assoc v5 Fallback] IA não confirmou, mas há EXATAMENTE UMA imagem não usada na linha ${productRow} para produto ${product.id}. Usando fallback.`);
                    associatedImageInfo = unusedCandidatesOnRow[0];
                } 
            }
            if (associatedImageInfo) {
                imageAssociatedFlags.set(associatedImageInfo.imageUrl, true);
                try {
                    await storage.updateProductImageUrl(product.id, associatedImageInfo.imageUrl);
                    associatedCount++;
                    const successLog = visionConfirmedMatch ? '[Assoc v5 SUCESSO (IA)]' : '[Assoc v5 SUCESSO (Fallback)]';
                    console.log(`${successLog}: Prod ID ${product.id} (${product.name}) -> Imagem da linha ${associatedImageInfo.anchorRow}, URL: ${associatedImageInfo.imageUrl}`);
                    console.log(`[Embedding CLIP] Tentando gerar embedding para Prod ID ${product.id} usando imagem: ${associatedImageInfo.imageUrl}`);
                    try {
                      const clipEmbeddingVector = await getClipEmbeddingFromImageUrl(associatedImageInfo.imageUrl);
                      if (clipEmbeddingVector && clipEmbeddingVector.length > 0) {
                        await storage.updateProduct(product.id, { clipEmbedding: clipEmbeddingVector as any });
                        console.log(`[Embedding CLIP] Embedding gerado e salvo para Prod ID ${product.id}.`);
                      } else {
                        console.warn(`[Embedding CLIP] Falha ao gerar embedding (vetor nulo ou vazio) para Prod ID ${product.id}`);
                      }
                    } catch (embeddingError) {
                      console.error(`[Embedding CLIP] ERRO ao gerar/salvar embedding para Prod ID ${product.id}:`, embeddingError);
                    }
                } catch (updateError) {
                    console.error(`[Assoc v5] ERRO DB ao atualizar Prod ID ${product.id} com imagem ${associatedImageInfo.imageUrl}:`, updateError);
                }
            } 
        }
        extractionInfo += ` | Associação Imagens Excel v5: ${associatedCount} produtos atualizados.`;
        console.log(`[BG Proc ${catalogId}] Associação v5 (IA Vision + Fallback) e Embedding concluída. ${associatedCount} produtos atualizados com imagem.`);
      } else if (savedLocalProducts.length > 0 && uploadedImages.length === 0 && fileType.startsWith('xls')) {
        extractionInfo += ` | Nenhuma imagem extraída do Excel para associar.`;
        console.log(`[BG Proc ${catalogId}] Nenhuma imagem foi extraída do Excel (uploadedImages vazio), embora ${savedLocalProducts.length} produtos tenham sido salvos.`);
      }
    } else if (fileType === 'pdf') {
      extractionInfo += " | Principal(PDF): Google Vision AI via GCS iniciado.";
      if (!visionClient || !gcsStorage || !GCS_BUCKET_NAME) {
        extractionInfo += " Google Vision/Storage Client ou GCS_BUCKET_NAME não inicializado/configurado.";
        console.error(`[BG Proc ${catalogId}] Google Vision/Storage Client ou GCS_BUCKET_NAME não inicializado/configurado. Verifique as credenciais e a variável de ambiente do bucket. VisionClient: ${!!visionClient}, GCSStorage: ${!!gcsStorage}, BucketName: ${GCS_BUCKET_NAME}`);
      } else {
        const gcsPdfFileName = `catalogs_to_ocr/${catalogId}-${Date.now()}-${fileName}`.replace(/[^a-zA-Z0-9_\-\.\/!]/g, '_');
        const gcsOutputPrefix = `ocr_results/${catalogId}-${Date.now()}/`;
        const gcsSourceUri = `gs://${GCS_BUCKET_NAME}/${gcsPdfFileName}`;
        const gcsDestinationUri = `gs://${GCS_BUCKET_NAME}/${gcsOutputPrefix}`;
        try {
          console.log(`[BG Proc ${catalogId}] Enviando PDF para GCS: ${gcsSourceUri}...`);
          await gcsStorage.bucket(GCS_BUCKET_NAME).file(gcsPdfFileName).save(fileBufferFromS3, { contentType: 'application/pdf' });
          console.log(`[BG Proc ${catalogId}] PDF enviado para GCS com sucesso.`);
          console.log(`[BG Proc ${catalogId}] Solicitando análise assíncrona do Google Vision AI...`);
          const [operation] = await visionClient.asyncBatchAnnotateFiles({
            requests: [{
              inputConfig: {
                gcsSource: { uri: gcsSourceUri },
                mimeType: 'application/pdf',
              },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              outputConfig: {
                gcsDestination: { uri: gcsDestinationUri },
                batchSize: 20, 
              },
            }],
          });
          console.log(`[BG Proc ${catalogId}] Operação Google Vision AI iniciada: ${operation.name}. Aguardando conclusão...`);
          await operation.promise(); 
          console.log(`[BG Proc ${catalogId}] Operação Google Vision AI concluída.`);
          const [outputFiles] = await gcsStorage.bucket(GCS_BUCKET_NAME).getFiles({ prefix: gcsOutputPrefix });
          console.log(`[BG Proc ${catalogId}] Encontrados ${outputFiles.length} arquivos de resultado OCR no GCS.`);
          extractionInfo += ` | Google Vision (GCS): ${outputFiles.length} arquivos de resultado.`;

          let allProductsFromPdfText: AIAVisionProductExtraction[] = []; 
          let pagesProcessedForOpenAI = 0;

          for (const outputFile of outputFiles) {
            if (outputFile.name.endsWith('.json')) {
              console.log(`[BG Proc ${catalogId}] Baixando e processando resultado OCR: ${outputFile.name}`);
              const [jsonData] = await outputFile.download();
              const ocrResult = JSON.parse(jsonData.toString());
              if (ocrResult.responses && Array.isArray(ocrResult.responses)) {
                for (const response of ocrResult.responses) {
                  if (response.fullTextAnnotation && response.fullTextAnnotation.pages && Array.isArray(response.fullTextAnnotation.pages)) {
                    for (const page of response.fullTextAnnotation.pages) {
                      if (pagesProcessedForOpenAI >= MAX_PAGES_TO_PROCESS_WITH_OPENAI) {
                        console.log(`[BG Proc ${catalogId}] Limite de ${MAX_PAGES_TO_PROCESS_WITH_OPENAI} páginas para envio ao OpenAI atingido.`);
                        break; 
                      }
                      let pageText = '';
                      if (page.blocks) {
                        page.blocks.forEach((block:any) => {
                          if (block.paragraphs) {
                            block.paragraphs.forEach((paragraph:any) => {
                              if (paragraph.words) {
                                paragraph.words.forEach((word:any) => {
                                  if (word.symbols) {
                                    word.symbols.forEach((symbol:any) => {
                                      pageText += symbol.text;
                                      if (symbol.property?.detectedBreak?.type === 'SPACE') pageText += ' ';
                                      else if (symbol.property?.detectedBreak?.type === 'EOL_SURE_SPACE') pageText += ' ';
                                      else if (symbol.property?.detectedBreak?.type === 'LINE_BREAK') pageText += '\n';
                                    });
                                  }
                                });
                              }
                            });
                          }
                        });
                      }
                      const effectivePageNumber = (ocrResult.responses.indexOf(response) * (ocrResult.responses[0].context?.pageNumber || 0)) + (response.context?.pageNumber || response.fullTextAnnotation.pages.indexOf(page) + 1);
                      
                      if (pagesProcessedForOpenAI < MAX_PAGES_TO_PROCESS_WITH_OPENAI) {
                        console.log(`\n--- [BG Proc ${catalogId}] TEXTO OCR COMPLETO (Página Efetiva ${effectivePageNumber}) A SER ENVIADO PARA OPENAI ---`);
                        console.log(pageText);
                        console.log(`--- FIM DO TEXTO OCR COMPLETO (Página Efetiva ${effectivePageNumber}) ---\n`);
                          
                        const productsFromThisPage = await extractProductsFromTextWithOpenAI(pageText, catalogId, effectivePageNumber);
                        
                        // Lógica para tentar usar nome da página anterior
                        if (productsFromThisPage.length > 0) {
                          for (const product of productsFromThisPage) {
                            if (product.name && (product.name.endsWith("(ver especificações)") || product.name === "Produto (ver especificações)")) {
                              if (potentialProductNameFromPreviousPage) {
                                console.log(`[Nome Atribuído] Usando nome '${potentialProductNameFromPreviousPage}' da pág. anterior para produto '${product.name}' na pág. ${effectivePageNumber}.`);
                                product.name = potentialProductNameFromPreviousPage; // Atribui o nome capturado
                                potentialProductNameFromPreviousPage = null; // Limpa para não usar de novo indevidamente
                              } else {
                                console.log(`[Nome Genérico] Produto '${product.name}' na pág. ${effectivePageNumber} não encontrou nome na pág. anterior.`);
                              }
                            } else if (product.name) { 
                              // Se o produto tem nome específico (não genérico), limpa qualquer nome pendente da pág. anterior.
                              potentialProductNameFromPreviousPage = null;
                            }
                          }
                          allProductsFromPdfText.push(...productsFromThisPage);
                        } else { // productsFromThisPage.length === 0
                          // Esta página NÃO rendeu produtos via OpenAI. Pode ser uma página que contém apenas o nome do modelo.
                          const trimmedPageText = pageText.trim();
                          const wordsInPage = trimmedPageText.split(/\s+/);
                          // Heurística: texto curto (ex: <= 7 palavras, < 60 chars), não é frase longa, e parece um nome.
                          if (wordsInPage.length > 0 && wordsInPage.length <= 7 && trimmedPageText.length < 60) {
                            let candidateName = trimmedPageText.split('\n')[0].trim(); // Pega a primeira linha como candidato
                            // Verifica se o candidato parece um nome de modelo válido
                            if (candidateName.length > 2 && candidateName.length < 40 && 
                                /^[A-Za-z0-9À-ÖØ-öø-ÿ\s'-]+$/.test(candidateName) && // Letras, números, espaços, hífens, apóstrofos
                                !/^\d+$/.test(candidateName) && // Não ser apenas números
                                candidateName.toLowerCase() !== "especificações" && 
                                candidateName.toLowerCase() !== "especificacoes" && 
                                candidateName.toLowerCase() !== "detalhes" &&
                                candidateName.toLowerCase() !== "medidas") {
                              potentialProductNameFromPreviousPage = candidateName;
                              console.log(`[Nome Candidato] Pág. ${effectivePageNumber} (0 produtos OpenAI). Capturado '${potentialProductNameFromPreviousPage}' como nome potencial.`);
                            } else {
                              potentialProductNameFromPreviousPage = null; // Candidato não parece um nome de modelo.
                            }
                          } else {
                            potentialProductNameFromPreviousPage = null; // Página não rendeu produto e texto não parece ser só um nome.
                          }
                        }
                        pagesProcessedForOpenAI++;
                      } else {
                        break; 
                      }
                    } 
                  } else { console.log(`[BG Proc ${catalogId}] Resposta OCR (${outputFile.name}) não contém fullTextAnnotation.pages válidas.`); }
                  if (pagesProcessedForOpenAI >= MAX_PAGES_TO_PROCESS_WITH_OPENAI) break; 
                }
              } else { console.log(`[BG Proc ${catalogId}] Arquivo de resultado OCR (${outputFile.name}) não tem o formato esperado (sem 'responses').`); }
            }
             if (pagesProcessedForOpenAI >= MAX_PAGES_TO_PROCESS_WITH_OPENAI && MAX_PAGES_TO_PROCESS_WITH_OPENAI > 0) break; 
          }
          rawExtractedProducts = allProductsFromPdfText; 
          extractionInfo += ` Texto OCR processado por OpenAI para ${pagesProcessedForOpenAI} página(s), resultando em ${rawExtractedProducts.length} produtos.`;
          console.log(`[BG Proc ${catalogId}] Total de ${rawExtractedProducts.length} produtos brutos extraídos do texto OCR via OpenAI de ${pagesProcessedForOpenAI} páginas.`);

          if (rawExtractedProducts.length > 0) {
            console.log(`[BG Proc ${catalogId}] Salvando ${rawExtractedProducts.length} produtos extraídos do PDF...`);
            if(uploadMode === 'separate') savedLocalProducts = []; 
            for (const pData of rawExtractedProducts) { 
              try {
                let embeddingVector: number[] | null = null;
                const textForEmb = (`${pData.name || ''} ${pData.description || ''} ${pData.category_hint || ''} ` +
                                    `${(pData.materials_hint || []).join(' ')} ${(pData.colors_hint || []).join(' ')}`).replace(/s+/g, ' ').trim();
                if (textForEmb.length > 5 && openai) { 
                    const embResp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: textForEmb, dimensions: 1536 });
                    if (embResp.data?.length) embeddingVector = embResp.data[0].embedding;
                }
                const productToSave: InsertProduct = {
                  userId: localUserIdNum, catalogId: catalogId, name: pData.name || 'Produto PDF s/ Nome',
                  code: pData.code || null, description: pData.description || null, 
                  price: 0, 
                  category: pData.category_hint || null, 
                  dimensions: pData.dimensions || null, 
                  imageUrl: null, 
                  colors: pData.colors_hint || [], 
                  materials: pData.materials_hint || [], 
                  sizes: [], 
                  embedding: embeddingVector, clipEmbedding: null, isEdited: false,
                  excelRowNumber: null, manufacturer: null, location: null, stock: null,
                };
                Object.keys(productToSave).forEach(k => (productToSave as any)[k] === undefined && delete (productToSave as any)[k]);
                const savedProd = await storage.createProduct(productToSave as InsertProduct);
                savedLocalProducts.push(savedProd);
              } catch (dbErr) { console.error(`[BG Proc ${catalogId}] Erro salvar produto PDF (Nome: ${pData.name}):`, dbErr); }
            }
            console.log(`[BG Proc ${catalogId}] ${savedLocalProducts.length} produtos do PDF salvos no banco.`);
          }
        } catch (visionError) {
          console.error(`[BG Proc ${catalogId}] Erro ao processar PDF com Google Vision AI via GCS:`, visionError);
          extractionInfo += ` | Erro Google Vision (GCS): ${visionError instanceof Error ? visionError.message : String(visionError)}.`;
        }
      } 
    } else { 
      console.warn(`[BG Proc ${catalogId}] Tipo de arquivo principal '${fileType}' não suportado para extração.`);
      extractionInfo += ` | Tipo de arquivo principal ${fileType} não processado.`;
    }

    // PARTE 2: Processar Arquivo de Preços Separado
    if (uploadMode === 'separate' && pricingFileS3Key) {
      console.log(`[BG Proc ${catalogId}] MODO SEPARADO: Processando arquivo de preços (S3Key: ${pricingFileS3Key})`);
      pricingDataResult = await processPricingFile(catalogId);
      if (pricingDataResult?.length) extractionInfo += ` | Arq.Preços: ${pricingDataResult.length} itens.`;
      else extractionInfo += ` | Arq.Preços: Nenhum item ou falha.`;
    } else if (uploadMode === 'separate' && !pricingFileS3Key) {
      extractionInfo += ` | Nenhum arq. preços separado fornecido.`;
    }

    // PARTE 3: Fusão de Dados
    if (savedLocalProducts.length > 0 || (pricingDataResult?.length || 0) > 0) {
      console.log(`[BG Proc ${catalogId}] Iniciando fusão: ${savedLocalProducts.length} prod. base, ${pricingDataResult?.length || 0} itens de preço.`);
      const fusionResult = await fuseCatalogData(catalogId, savedLocalProducts, pricingDataResult);
      extractionInfo += ` | Fusão: ${fusionResult.productsUpdatedWithPrice} prods. com preço atualizado.`;
    } else {
      extractionInfo += ` | Nada para fusão.`;
    }

    // PARTE 4: Placeholder para extração de IMAGENS LITERAIS de PDF (EXISTENTE - INALTERADO)
    if (fileType === 'pdf' && savedLocalProducts.length > 0) {
        console.log(`[BG Proc ${catalogId}] TODO: Implementar extração de IMAGENS de PDF e associação aos ${savedLocalProducts.length} produtos salvos (que foram extraídos do TEXTO OCR).`);
        extractionInfo += ` | Extração/associação de IMAGENS de PDF pendente.`;
    }

    await storage.updateCatalogStatus(catalogId, 'completed');
    console.log(`[BG Proc ${catalogId}] Processamento COMPLETO. Status: completed. Info: ${extractionInfo}`);

  } catch (error) {
      console.error(`[BG Proc ${catalogId}] ERRO GERAL:`, error);
    try {
          const errMsg = error instanceof Error ? error.message : String(error);
        await storage.updateCatalogStatus(catalogId, 'failed');
          console.log(`[BG Proc ${catalogId}] Status: 'failed'. Erro: ${errMsg}`);
      } catch (statusErr) { console.error(`[BG Proc ${catalogId}] FALHA CRÍTICA ao salvar status 'failed':`, statusErr); }
  } finally {
    if (localTempFilePath && fs.existsSync(localTempFilePath)) {
      try { fs.unlinkSync(localTempFilePath); console.log(`[BG Proc ${catalogId}] Temp arquivo ${localTempFilePath} removido.`); }
      catch (unlinkErr) { console.error(`[BG Proc ${catalogId}] Erro remover temp arquivo ${localTempFilePath}:`, unlinkErr); }
    }
  }
}