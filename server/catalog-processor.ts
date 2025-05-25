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

// Adicionar imports para OpenAI e o modelo de embedding
import OpenAI from "openai";
// @ts-ignore
import { processPricingFile, ExtractedPriceItem } from './pricing-file-processor.js'; // Importando a nova função
// @ts-ignore
import { fuseCatalogData } from './catalog-fusion-service.js'; // Importando a função de fusão
import { fromBuffer } from "pdf2pic"; // ADICIONAR ESTA IMPORTAÇÃO
// import { getDocumentInfo } from 'pdf-lib'; // Para tentar obter o número de páginas -- REMOVER ESTA LINHA

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = 'text-embedding-3-small'; // Mesmo modelo usado em ai-design-processor

// Interface para dados do Python (linha + base64 + sheet_name)
interface ExtractedImageData {
  anchor_row: number;
  image_base64: string;
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

/**
 * Processa um catálogo em background (extrai dados, imagens, associa).
 * Atualiza o status do catálogo no banco de dados.
 */
export async function processCatalogInBackground(jobData: CatalogJobData): Promise<void> {
  const { catalogId, userId, s3Key, fileName, fileType, uploadMode, pricingFileS3Key } = jobData;
  console.log(`[BG Proc ${catalogId}] INICIANDO: ${fileName}, Tipo: ${fileType}, ModoUpload: ${uploadMode}, ArqPreçoS3: ${pricingFileS3Key || 'N/A'}`);

  let localTempFilePath: string | null = null;
  let rawExtractedProducts: any[] = []; // Mantido como any[] para flexibilidade inicial, mas os produtos de PDF serão AIAVisionProductExtraction
  let savedLocalProducts: Product[] = [];
  let uploadedImages: UploadedImageInfo[] = [];
  let extractionInfo = `Upload modo '${uploadMode}'. Artístico/Principal: ${fileType}.`;
  let pricingDataResult: ExtractedPriceItem[] | null = null;
  const MAX_PDF_PAGES_TO_PROCESS = 5; // Definindo o máximo de páginas a processar para PDFs

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
      rawExtractedProducts = produtos_excel_ia;
      extractionInfo += ` | Principal(Excel): ${rawExtractedProducts.length} produtos brutos da IA.`;

        savedLocalProducts = []; 
      for (const pData of rawExtractedProducts) { 
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
              const buffer = Buffer.from(imgData.image_base64, 'base64');
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
      extractionInfo += " | Principal(PDF): IA Vision iniciada (multi-página).";
      if (!openai) { 
          console.error(`[BG Proc ${catalogId}] OpenAI client indisponível para PDF.`); 
          extractionInfo += " OpenAI off."; 
      } else {
        const allPdfProducts: AIAVisionProductExtraction[] = [];
        const pdfOptions = { density: 150, savePath: tempDir, saveFilename: `pg_${catalogId}_${Date.now()}`, format: "png", width: 1024, height: 1024 };
        const convert = fromBuffer(fileBufferFromS3, pdfOptions);
        
        let actualPagesToProcess = MAX_PDF_PAGES_TO_PROCESS;
        for (let pageNum = 1; pageNum <= actualPagesToProcess; pageNum++) {
          try {
            console.log(`[BG Proc ${catalogId}] Convertendo PDF página ${pageNum}...`);
            const pageImageResult = await convert(pageNum, { responseType: "base64" });
            
            // NOVO LOG AQUI:
            console.log(`[BG Proc ${catalogId}] Resultado da conversão para página ${pageNum}:`, JSON.stringify(pageImageResult, null, 2));

            if (!pageImageResult || !pageImageResult.base64) { // Modificado para pageImageResult
              console.warn(`[BG Proc ${catalogId}] Falha ao converter PDF página ${pageNum} para imagem (resultado inválido ou sem base64) ou página não existe. Interrompendo processamento de páginas.`);
              break; // Interrompe o loop se uma página não puder ser convertida
            }
            const pageImage = pageImageResult; // Continuar usando pageImage depois da checagem
            
            let systemPromptForPdfPage = `Você é um especialista em analisar páginas de catálogos de móveis artísticos.
Analise a imagem da página fornecida e identifique CADA MÓVEL principal individualmente.

Para CADA MÓVEL identificado, forneça os seguintes detalhes em um objeto JSON:
- "name": O nome do produto como exibido ou o mais descritivo possível (ex: "Poltrona Concha", "Mesa Lateral Cubo").
- "description": Uma breve descrição do estilo ou característica marcante (ex: "Estofado em veludo azul, pés palito", "Tampo de mármore, base metálica dourada").
- "code": Se um código de produto estiver claramente associado e visível PRÓXIMO ao móvel, extraia-o. Caso contrário, deixe como null.
- "dimensions": Se as dimensões (Altura, Largura, Profundidade) estiverem claramente associadas e visíveis PRÓXIMO ao móvel (ex: "A: 80cm L: 120cm P: 60cm" ou "120x60x80"), extraia a string original. Caso contrário, deixe como null.
- "category_hint": Se puder inferir a categoria principal do móvel (ex: "Sofá", "Poltrona", "Mesa de Jantar", "Luminária"), forneça como string. Caso contrário, null.
- "materials_hint": Se materiais forem mencionados ou claramente visíveis (ex: "Madeira Carvalho", "Aço Inox", "Veludo"), liste-os em um array de strings. Caso contrário, null.
- "colors_hint": Se cores forem proeminentes ou mencionadas (ex: "Azul Marinho", "Branco Gelo"), liste-as em um array de strings. Caso contrário, null.

RESPONDA APENAS com um objeto JSON contendo uma chave "products". O valor de "products" deve ser um ARRAY de objetos, onde cada objeto representa um móvel identificado na página.
Se NENHUM móvel for identificável na página, retorne { "products": [] }.

Exemplo de resposta para uma página com dois móveis:
{
  "products": [
    {
      "name": "Sofá Sereno 3 Lugares",
      "description": "Linho cinza claro, design minimalista.",
      "code": "SF-SER-3L-CZ",
      "dimensions": "220x90x85cm",
      "category_hint": "Sofá",
      "materials_hint": ["Linho", "Madeira"],
      "colors_hint": ["Cinza Claro"]
    },
    {
      "name": "Mesa de Centro Fluss",
      "description": "Madeira natural com detalhes em resina.",
      "code": null,
      "dimensions": "D: 90cm A: 40cm",
      "category_hint": "Mesa de Centro",
      "materials_hint": ["Madeira", "Resina"],
      "colors_hint": ["Natural", "Transparente"]
    }
  ]
}`;
            // Nota: Se uploadMode === 'complete', o prompt precisaria pedir preços também.
            // Isso não está implementado nesta iteração para manter o foco no PDF artístico.

            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
              { role: "system", content: systemPromptForPdfPage }, 
              { role: "user", content: [ { type: "text", text: `Analise a imagem da página ${pageNum} do catálogo PDF.` }, { type: "image_url", image_url: { url: `data:image/png;base64,${pageImage.base64}` } } ] }
            ];
            console.log(`[BG Proc ${catalogId}] Enviando página ${pageNum} para IA Vision...`);
            const aiVisionResponse = await openai.chat.completions.create({ model: "gpt-4o", messages, max_tokens: 4000, response_format: { type: "json_object" }, temperature: 0.2 });
            const respContent = aiVisionResponse.choices[0]?.message?.content;

            if (!respContent) {
                console.warn(`[BG Proc ${catalogId}] Resposta IA Vision (PDF página ${pageNum}) vazia.`);
                continue; 
            }
            const parsedResp = JSON.parse(respContent) as AIAVisionExtractionResponse;
            if (parsedResp.error) {
                console.warn(`[BG Proc ${catalogId}] IA Vision (PDF página ${pageNum}) erro: ${parsedResp.error}`);
                continue;
            }
            if (parsedResp.products?.length) {
              console.log(`[BG Proc ${catalogId}] IA Vision PDF página ${pageNum}: ${parsedResp.products.length} produtos extraídos.`);
              allPdfProducts.push(...parsedResp.products);
            } else {
              console.log(`[BG Proc ${catalogId}] IA Vision PDF página ${pageNum}: Nenhum produto extraído.`);
            }
            // Delay para não sobrecarregar a API
            if (pageNum < actualPagesToProcess) await new Promise(resolve => setTimeout(resolve, 1500));

          } catch (pageProcessingError: any) { // Modificado para :any para melhor log
            console.error(`[BG Proc ${catalogId}] ERRO DETALHADO ao processar/converter PDF página ${pageNum}:`, pageProcessingError);
            // Logar a mensagem e o stack se disponível
            if (pageProcessingError instanceof Error) {
                console.error(`[BG Proc ${catalogId}] Mensagem do Erro: ${pageProcessingError.message}`);
                if (pageProcessingError.stack) {
                    console.error(`[BG Proc ${catalogId}] Stack do Erro: ${pageProcessingError.stack}`);
                }
            }
            
            const errorMsgStr = pageProcessingError instanceof Error ? pageProcessingError.message : String(pageProcessingError);
            if (errorMsgStr.includes("page number out of range") || 
                errorMsgStr.includes("Invalid page range") || 
                errorMsgStr.includes("PageCount") || 
                errorMsgStr.toLowerCase().includes("cannot open file")) { // Adicionada checagem genérica de erro de arquivo
                 console.log(`[BG Proc ${catalogId}] Erro indica página fora do intervalo ou falha ao abrir/processar o arquivo PDF para a página ${pageNum}. Interrompendo processamento de páginas do PDF.`);
                 break;
            }
            console.warn(`[BG Proc ${catalogId}] Continuando para a próxima página (se houver) após erro no processamento/conversão da página ${pageNum}.`);
        }
        } // Fim do loop de páginas

        rawExtractedProducts = allPdfProducts;
        extractionInfo += ` | IA Vision PDF (multi-página): ${rawExtractedProducts.length} produtos brutos no total.`;
        
        savedLocalProducts = [];
        for (const pData of rawExtractedProducts as AIAVisionProductExtraction[]) { // Cast aqui
          if (!pData.name) { console.warn(`[BG Proc ${catalogId}] PDF produto sem nome.`); continue; }
          try {
            let embeddingVector: number[] | null = null;
            const textForEmb = (`${pData.name || ''} ${pData.description || ''} ${pData.category_hint || ''} ` + 
                                `${(pData.materials_hint || []).join(' ')} ${(pData.colors_hint || []).join(' ')}`).replace(/\s+/g, ' ').trim();

            if (textForEmb.length > 5 && openai) { 
                const embResp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: textForEmb, dimensions: 1536 });
                if (embResp.data?.length) embeddingVector = embResp.data[0].embedding;
            }
            const productToSave: InsertProduct = {
              userId: localUserIdNum, catalogId: catalogId, name: pData.name,
              code: pData.code || null, description: pData.description || null, 
              price: (uploadMode === 'complete' && typeof (pData as any).price === 'number') ? Math.round((pData as any).price * 100) : 0, // Preço do PDF completo ainda não implementado no prompt
              category: pData.category_hint || null, 
              dimensions: pData.dimensions || null, 
              imageUrl: null, // Será preenchido depois se as imagens forem extraídas do PDF e associadas
              colors: pData.colors_hint || [], 
              materials: pData.materials_hint || [], 
              sizes: [], // O campo 'dimensions' é uma string, 'sizes' é um array estruturado. Mapear se necessário.
              embedding: embeddingVector as any, clipEmbedding: null, isEdited: false,
              excelRowNumber: null, manufacturer: null, location: null, stock: null,
            };
            Object.keys(productToSave).forEach(k => (productToSave as any)[k] === undefined && delete (productToSave as any)[k]);
            const savedProd = await storage.createProduct(productToSave as InsertProduct);
            savedLocalProducts.push(savedProd);
          } catch (dbErr) { console.error(`[BG Proc ${catalogId}] Erro salvar produto PDF (Nome: ${pData.name}):`, dbErr); }
        }
        console.log(`[BG Proc ${catalogId}] ${savedLocalProducts.length} produtos PDF (multi-página) salvos.`);
      }
    } else { // Fim do if (fileType === 'pdf')
      console.warn(`[BG Proc ${catalogId}] Tipo de arquivo principal \\\'${fileType}\\\' não suportado para extração.`);
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

    // PARTE 4: Tentativa de extrair e associar imagens se o arquivo principal foi um PDF
    // Esta parte é um placeholder e precisaria de uma lógica robusta de extração de imagem de PDF
    if (fileType === 'pdf' && savedLocalProducts.length > 0) {
        console.log(`[BG Proc ${catalogId}] TODO: Implementar extração de imagens de PDF e associação aos ${savedLocalProducts.length} produtos salvos.`);
        // Exemplo de lógica futura:
        // 1. Usar uma biblioteca (como pdf-image-extractor ou similar) para extrair todas as imagens do PDF para arquivos temporários.
        // 2. Para cada imagem extraída:
        //    a. Fazer upload para S3, obtendo uma URL.
        //    b. Tentar associar essa imagem a um dos savedLocalProducts (ex: por proximidade na página, por descrição da IA, etc.).
        //    c. Se associado, atualizar o imageUrl do produto no banco.
        extractionInfo += ` | Extração/associação de imagens de PDF pendente.`;
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