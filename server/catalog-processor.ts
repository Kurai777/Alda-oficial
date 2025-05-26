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

    const systemPromptForTextExtraction = `Você é um especialista em analisar o texto extraído (OCR) de páginas de catálogos de móveis.
O texto a seguir é o conteúdo OCR de UMA PÁGINA de um catálogo. Sua tarefa é identificar CADA MÓVEL principal individualmente mencionado ou descrito neste texto.

Para CADA MÓVEL identificado, forneça os seguintes detalhes em um objeto JSON:
- "name": O nome do produto (ex: "Poltrona Concha", "Mesa Lateral Cubo"). Tente ser o mais completo possível com base no texto.
- "description": Uma breve descrição do estilo, característica marcante ou detalhes adicionais fornecidos no texto.
- "code": Se um código de produto estiver claramente associado ao móvel no texto, extraia-o. Caso contrário, deixe como null.
- "dimensions": Se as dimensões (Altura, Largura, Profundidade) estiverem claramente associadas ao móvel no texto (ex: "A: 80cm L: 120cm P: 60cm" ou "120x60x80"), extraia a string original. Caso contrário, deixe como null.
- "category_hint": Com base no nome e descrição, infira a categoria principal do móvel (ex: "Sofá", "Poltrona", "Mesa de Jantar", "Luminária"). Se não puder inferir com confiança, deixe como null.
- "materials_hint": Se materiais forem mencionados no texto em associação com o móvel (ex: "Madeira Carvalho", "Aço Inox", "Veludo"), liste-os em um array de strings. Caso contrário, deixe como null ou um array vazio.
- "colors_hint": Se cores forem mencionadas no texto em associação com o móvel (ex: "Azul Marinho", "Branco Gelo"), liste-as em um array de strings. Caso contrário, deixe como null ou um array vazio.

RESPONDA APENAS com um objeto JSON contendo uma chave "products". O valor de "products" deve ser um ARRAY de objetos, onde cada objeto representa um móvel identificado no texto da página.
Se NENHUM móvel for identificável no texto da página, retorne { "products": [] }.

Certifique-se de que o JSON seja válido. Analise cuidadosamente todo o texto fornecido.`;

    try {
        console.log(`[OpenAI Text Extractor - Cat ${catalogId}, Pg ${pageNumberForContext}] Enviando texto OCR para ${OPENAI_TEXT_EXTRACTION_MODEL} para extração de produtos... (Primeiros 300 chars do texto: ${pageText.substring(0,300).replace(/\n/g, ' ')}...`);
        const response = await openai.chat.completions.create({
            model: OPENAI_TEXT_EXTRACTION_MODEL,
            messages: [
                { role: "system", content: systemPromptForTextExtraction },
                { role: "user", content: `Aqui está o texto OCR da página do catálogo:\n\n${pageText}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1, // Baixa temperatura para respostas mais determinísticas e factuais
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
  let rawExtractedProducts: AIAVisionProductExtraction[] = []; // Alterado para tipo específico
  let savedLocalProducts: Product[] = [];
  let uploadedImages: UploadedImageInfo[] = [];
  let extractionInfo = `Upload modo '${uploadMode}'. Artístico/Principal: ${fileType}.`;
  let pricingDataResult: ExtractedPriceItem[] | null = null;
  const MAX_PAGES_TO_PROCESS_PDF_TEXT = 5; // Limite de páginas OCR a enviar para OpenAI para extração de produtos

  // Inicializar Google Vision Client
  let visionClient: ImageAnnotatorClient | null = null;
  let gcsStorage: Storage | null = null;
  const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
  const gcpCredentialsJsonString = process.env.GCP_CREDENTIALS_JSON;

  if (fileType === 'pdf') {
      if (gcpCredentialsJsonString) {
          try {
              const credentials = JSON.parse(gcpCredentialsJsonString);
              visionClient = new ImageAnnotatorClient({ credentials });
              gcsStorage = new Storage({ credentials }); // Inicializa Storage com as mesmas creds
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

    // PARTE 1: Processar o Arquivo Principal (Artístico ou Completo)
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
      // rawExtractedProducts agora é AIAVisionProductExtraction[], então precisamos de um cast ou mapeamento
      rawExtractedProducts = produtos_excel_ia.map(p => ({ 
        name: p.name, 
        description: p.description,
        code: p.code,
        dimensions: p.sizes?.map((s:any) => s.label).join('; ') || p.dimensions, // Ajuste para sizes
        category_hint: p.category,
        materials_hint: p.materials,
        colors_hint: p.colors
      }));
      extractionInfo += ` | Principal(Excel): ${rawExtractedProducts.length} produtos brutos da IA.`;
        savedLocalProducts = []; 
      for (const pData of produtos_excel_ia) { // Iterar sobre produtos_excel_ia para ter todos os campos originais
          try {
            let embeddingVector: number[] | null = null;
          const textForEmb = (`${pData.name || ''} ${pData.category || ''} ${pData.description || ''} ` +
                            `${pData.manufacturer || ''} ${(pData.colors || []).join(' ')} ` +
                            `${(pData.materials || []).join(' ')}`).replace(/\s+/g, ' ').trim();
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

      // LÓGICA DE ASSOCIAÇÃO DE IMAGENS E EMBEDDING (BASEADA NO CÓDIGO ANTIGO FORNECIDO)
      if (savedLocalProducts.length > 0 && uploadedImages.length > 0 && openai) {
        console.log(`[BG Proc ${catalogId}] Iniciando Associação v5 (IA Vision + Fallback) e Embedding para ${uploadedImages.length} imagens e ${savedLocalProducts.length} produtos.`);
        let associatedCount = 0;
        const imageAssociatedFlags = new Map<string, boolean>(); // Para não reutilizar imagens

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
                colors: product.colors as string[] | undefined, // Cast para o tipo esperado
                materials: product.materials as string[] | undefined // Cast para o tipo esperado
            };
            // console.log(`\n[Assoc v5] Tentando associar para Prod ID ${product.id} (Linha ${productRow}) - ${product.name}`);

            let associatedImageInfo: UploadedImageInfo | undefined = undefined;
            let visionConfirmedMatch = false;
            const candidateImages = uploadedImages.filter(img => img.anchorRow === productRow);

            if (candidateImages.length > 0) {
                // console.log(`[Assoc v5]   Encontradas ${candidateImages.length} imagens candidatas na linha ${productRow}`);
                const evaluatedCandidates: { image: UploadedImageInfo, result: { match: boolean, reason: string } | null }[] = [];

                for (const candidateImage of candidateImages) {
                    if (imageAssociatedFlags.has(candidateImage.imageUrl)) {
                        // console.log(`[Assoc v5]     Pulando imagem já usada: ${candidateImage.imageUrl.substring(candidateImage.imageUrl.lastIndexOf('/') + 1)}`);
                        continue;
                    }
                    // console.log(`[Assoc v5]     Aguardando 1s antes de chamar Vision Compare para ${candidateImage.imageUrl}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Delay antes de cada chamada à Vision API
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
                    // matches.forEach((m, idx) => console.log(`   -> Match Ambíguo ${idx+1}: ${m.image.imageUrl.substring(m.image.imageUrl.lastIndexOf('/') + 1)} (Razão: ${m.result?.reason})`));
                } else {
                    // console.log(`[Assoc v5]   Nenhum match confirmado pela IA na linha ${productRow} para produto ${product.id}.`);
                }
            }
            // else {
            //     console.log(`[Assoc v5]   Nenhuma imagem encontrada ancorada na linha ${productRow} para produto ${product.id}.`);
            // }

            if (!associatedImageInfo && candidateImages.length > 0) {
                const unusedCandidatesOnRow = candidateImages.filter(img => !imageAssociatedFlags.has(img.imageUrl));
                if (unusedCandidatesOnRow.length === 1) {
                    console.log(`[Assoc v5 Fallback] IA não confirmou, mas há EXATAMENTE UMA imagem não usada na linha ${productRow} para produto ${product.id}. Usando fallback.`);
                    associatedImageInfo = unusedCandidatesOnRow[0];
                } 
                // else if (unusedCandidatesOnRow.length > 1) {
                //      console.log(`[Assoc v5 Fallback] IA não confirmou e há ${unusedCandidatesOnRow.length} imagens não usadas na linha ${productRow}. Impossível usar fallback.`);
                // }
            }

            if (associatedImageInfo) {
                imageAssociatedFlags.set(associatedImageInfo.imageUrl, true);
                try {
                    await storage.updateProductImageUrl(product.id, associatedImageInfo.imageUrl);
                    associatedCount++;
                    const successLog = visionConfirmedMatch ? '[Assoc v5 SUCESSO (IA)]' : '[Assoc v5 SUCESSO (Fallback)]';
                    console.log(`${successLog}: Prod ID ${product.id} (${product.name}) -> Imagem da linha ${associatedImageInfo.anchorRow}, URL: ${associatedImageInfo.imageUrl}`);

                    // Gerar e salvar CLIP embedding para a imagem associada
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
            // else {
            //    console.warn(`[Assoc v5 FALHA FINAL]: Nenhuma imagem associada para Prod ID ${product.id} (Linha ${productRow}).`);
            // }
        }
        extractionInfo += ` | Associação Imagens Excel v5: ${associatedCount} produtos atualizados.`;
        console.log(`[BG Proc ${catalogId}] Associação v5 (IA Vision + Fallback) e Embedding concluída. ${associatedCount} produtos atualizados com imagens.`);

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
        const gcsPdfFileName = `catalogs_to_ocr/${catalogId}-${Date.now()}-${fileName}`.replace(/[^a-zA-Z0-9_\-\.\/!]/g, '_'); // Nome de arquivo seguro para GCS
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
                batchSize: 20, // Processa N páginas por arquivo JSON de saída. Ajuste conforme necessário.
              },
            }],
          });
          console.log(`[BG Proc ${catalogId}] Operação Google Vision AI iniciada: ${operation.name}. Aguardando conclusão...`);
          await operation.promise(); 
          console.log(`[BG Proc ${catalogId}] Operação Google Vision AI concluída.`);

          const [outputFiles] = await gcsStorage.bucket(GCS_BUCKET_NAME).getFiles({ prefix: gcsOutputPrefix });
          console.log(`[BG Proc ${catalogId}] Encontrados ${outputFiles.length} arquivos de resultado OCR no GCS.`);
          extractionInfo += ` | Google Vision (GCS): ${outputFiles.length} arquivos de resultado.`;

          let allProductsFromPdfText: AIAVisionProductExtraction[] = []; // Para acumular produtos de todas as páginas
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
                      if (pagesProcessedForOpenAI >= MAX_PAGES_TO_PROCESS_PDF_TEXT) {
                        console.log(`[BG Proc ${catalogId}] Limite de ${MAX_PAGES_TO_PROCESS_PDF_TEXT} páginas para envio ao OpenAI atingido.`);
                        break; // Sai do loop de páginas desta resposta
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
                      
                      if (pagesProcessedForOpenAI < MAX_PAGES_TO_PROCESS_PDF_TEXT) {
                          console.log(`\n--- [BG Proc ${catalogId}] Texto OCR (GCS) da Página Efetiva ${effectivePageNumber} (Para OpenAI) ---`);
                          // Log limitado para OpenAI, o texto completo vai para a função
                          console.log(pageText.substring(0, 300) + (pageText.length > 300 ? '... (texto truncado para log)' : ''));
                          console.log(`--- Fim do preview do Texto OCR da Página Efetiva ${effectivePageNumber} ---\n`);
                          
                          const productsFromThisPage = await extractProductsFromTextWithOpenAI(pageText, catalogId, effectivePageNumber);
                          allProductsFromPdfText.push(...productsFromThisPage);
                          pagesProcessedForOpenAI++;
                      }
                    } // Fim do loop page
                  } else { console.log(`[BG Proc ${catalogId}] Resposta OCR (${outputFile.name}) não contém fullTextAnnotation.pages válidas.`); }
                  if (pagesProcessedForOpenAI >= MAX_PAGES_TO_PROCESS_PDF_TEXT) break; // Sai do loop de responses
                }
              } else { console.log(`[BG Proc ${catalogId}] Arquivo de resultado OCR (${outputFile.name}) não tem o formato esperado (sem 'responses').`); }
            }
          }
          rawExtractedProducts = allProductsFromPdfText; // Agora rawExtractedProducts contém itens do tipo AIAVisionProductExtraction
          extractionInfo += ` Texto OCR de ${allProductsFromPdfText.length} produtos (de ${pagesProcessedForOpenAI} páginas) extraído via OpenAI.`;
          console.log(`[BG Proc ${catalogId}] Total de ${rawExtractedProducts.length} produtos brutos extraídos do texto OCR via OpenAI.`);

          // Salvar produtos extraídos do PDF
          if (rawExtractedProducts.length > 0) {
            console.log(`[BG Proc ${catalogId}] Salvando ${rawExtractedProducts.length} produtos extraídos do PDF...`);
            // savedLocalProducts já foi declarado no escopo da função, pode ser reutilizado ou usar um nome diferente.
            // Vamos garantir que está zerado para produtos de PDF.
            // savedLocalProducts = []; // Comentar se quiser adicionar aos produtos do Excel em modo 'complete' com PDF.
            // Em modo 'separate', savedLocalProducts deve vir apenas do arquivo artístico.
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
                  price: 0, // Preços virão do arquivo de preços para modo 'separate'
                  category: pData.category_hint || null, 
                  dimensions: pData.dimensions || null, 
                  imageUrl: null, // TODO: Extrair imagens literais do PDF e associar
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
      } // Fim do else (visionClient && gcsStorage && GCS_BUCKET_NAME)
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