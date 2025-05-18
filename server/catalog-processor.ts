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
// import { getClipEmbeddingFromImageUrl } from './clip-service'; // Não vamos mais usar CLIP para embedding de produto aqui

// Adicionar imports para OpenAI e o modelo de embedding
import OpenAI from "openai";
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

/**
 * Processa um catálogo em background (extrai dados, imagens, associa).
 * Atualiza o status do catálogo no banco de dados.
 */
export async function processCatalogInBackground(data: CatalogJobData): Promise<void> {
  const { catalogId, userId, s3Key, processingFilePath: s3Url, fileName, fileType } = data;
  console.log(`[BG Proc ${catalogId}] INICIANDO background job para: ${fileName} (S3 Key: ${s3Key}, URL: ${s3Url})`);

  let localTempFilePath: string | null = null; // Caminho para o arquivo baixado
  let productsData: any[] = [];
  let savedLocalProducts: Product[] = []; // Definir tipo Product
  let uploadedImages: UploadedImageInfo[] = []; // Lista de imagens após upload
  let extractionInfo = `Iniciando processamento para ${fileType}`;

  try {
    // 0. Log de início e dados recebidos
    console.log(`[BG Proc ${catalogId}] Dados recebidos: ${JSON.stringify(data)}`);

    // 1. Baixar arquivo do S3 para local temporário
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    localTempFilePath = path.join(tempDir, `${catalogId}-${Date.now()}-${fileName}`);
    console.log(`[BG Proc ${catalogId}] Baixando arquivo S3 (${s3Key}) para ${localTempFilePath}...`);
    const fileBufferFromS3 = await downloadFileFromS3(s3Key);
    fs.writeFileSync(localTempFilePath, fileBufferFromS3);
    console.log(`[BG Proc ${catalogId}] Download do S3 concluído e salvo em ${localTempFilePath}.`);

    // 2. CORRIGIDO: Garantir que o status 'processing' é definido aqui
    await storage.updateCatalogStatus(catalogId, 'processing');
    console.log(`[BG Proc ${catalogId}] Status atualizado para 'processing'.`);

    if (fileType === 'xlsx' || fileType === 'xls') {
        // 3. Ler TODOS os dados do Excel (do arquivo local baixado)
        console.log(`[BG Proc ${catalogId}] Lendo arquivo Excel local: ${localTempFilePath}`);
        const workbook = XLSX.read(fileBufferFromS3, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: null });
        console.log(`[BG Proc ${catalogId}] Total de ${rawData.length} linhas lidas do Excel.`);

        // 4. Processamento IA em Blocos
        const CHUNK_SIZE = 25;
        let allAiProducts: any[] = [];

        for (let i = 0; i < rawData.length; i += CHUNK_SIZE) {
            const chunk = rawData.slice(i, i + CHUNK_SIZE);
            const currentBlockNum = i / CHUNK_SIZE + 1;
            console.log(`[BG Proc ${catalogId}] Processando bloco ${currentBlockNum} (Linhas ${i + 1} a ${i + chunk.length})...`);
            const chunkWithRowNumbers = chunk.map((row: any, index: number) => ({
                excelRowNumber: i + index + 1,
                ...(typeof row === 'object' && row !== null ? row : {})
            }));

            try {
                const aiResult = await processExcelWithAI(chunkWithRowNumbers);
                if (aiResult && aiResult.products) {
                  console.log(`[BG Proc ${catalogId}] IA retornou ${aiResult.products.length} produtos para o bloco.`);
                  const cleanedProducts = aiResult.products.map((p: any, idx: number) => ({
                      ...p,
                      excelRowNumber: p.excelRowNumber || (i + idx + 1)
                  })).filter((p: any) => p.name && p.excelRowNumber > 0);

                  allAiProducts.push(...cleanedProducts);
                  console.log(`Amostra da IA:`, cleanedProducts[0]);
                  console.log(`Total de produtos válidos após limpeza no bloco: ${cleanedProducts.length}`);
                } else {
                  console.warn(`[BG Proc ${catalogId}] IA não retornou produtos para o bloco ${currentBlockNum}.`);
                }
            } catch (aiError) {
                console.error(`[BG Proc ${catalogId}] Erro no processamento IA do bloco ${currentBlockNum}:`, aiError);
            }
            if (i + CHUNK_SIZE < rawData.length) {
              console.log(`[BG Proc ${catalogId}] Pausando por 1 segundo antes do próximo bloco...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        productsData = allAiProducts;
        extractionInfo = `IA processou ${rawData.length} linhas em blocos e extraiu ${productsData.length} produtos.`;
        console.log(`[BG Proc ${catalogId}] ${extractionInfo}`);

        if (productsData.length === 0) {
            throw new Error("Falha da IA: Nenhum produto foi extraído.");
        }

        // --- Salvar Produtos no Banco (PG) ---
        console.log(`[BG Proc ${catalogId}] Salvando ${productsData.length} produtos no DB...`);
        savedLocalProducts = []; 
        const localUserIdNum = typeof userId === 'number' ? userId : parseInt(userId.toString());
        
        for (const productData of productsData) {
          try {
            let embeddingVector: number[] | null = null;
            const textForEmbedding = (`${productData.name || ''} ${productData.category || ''} ${productData.description || ''} ` +
                                      `${productData.manufacturer || ''} ${(productData.colors || []).join(' ')} ` +
                                      `${(productData.materials || []).join(' ')}`).replace(/\s+/g, ' ').trim();
            if (textForEmbedding && textForEmbedding.length > 5) {
                try {
                    const embeddingResponse = await openai.embeddings.create({
                        model: EMBEDDING_MODEL,
                        input: textForEmbedding,
                        dimensions: 1536 
                    });
                    if (embeddingResponse.data && embeddingResponse.data.length > 0) {
                        embeddingVector = embeddingResponse.data[0].embedding;
                    }
                } catch (embeddingError) {
                    console.error(`[Embedding Gen ${catalogId}] Erro ao gerar embedding para "${productData.name}":`, embeddingError);
                }
            }

            // 1. Crie o objeto base com os campos definidos em InsertProduct, omitindo os problemáticos para o linter
            const productBase: Omit<InsertProduct, 'embedding' | 'search_tsv'> = {
              userId: localUserIdNum,
              catalogId: catalogId,
              name: productData.name || 'Nome Indisponível',
              code: productData.code || null,
              description: productData.description || null,
              price: Math.round((typeof productData.price === 'number' ? productData.price : 0) * 100),
              category: productData.category || null,
              manufacturer: productData.manufacturer || null,
              imageUrl: null, 
              colors: productData.colors || [], 
              materials: productData.materials || [], 
              sizes: productData.sizes || [], 
              location: productData.location || null,
              stock: productData.stock || null,
              excelRowNumber: productData.excelRowNumber,
              isEdited: false,
              // createdAt e updatedAt são omitidos
            };

            // 2. Crie um novo objeto que inclua embedding e search_tsv, e faça a asserção de tipo.
            const productToSave = {
                ...productBase,
                embedding: embeddingVector,      // Pode ser number[] ou null
                search_tsv: null                 // Definido como null para o trigger do banco lidar
            } as InsertProduct; // Afirma que o objeto final corresponde a InsertProduct (confiando que Drizzle trata)
            
            // Remover chaves explicitamente undefined ANTES de passar para storage.createProduct
            Object.keys(productToSave).forEach(key => {
                const K = key as keyof InsertProduct;
                if ((productToSave as any)[K] === undefined) { // Usar 'as any' para acesso genérico na checagem
                     delete (productToSave as any)[K];
                }
            });
            
            const savedProduct = await storage.createProduct(productToSave);
            savedLocalProducts.push(savedProduct);
          } catch (dbError) {
            console.error(`[BG Proc ${catalogId}] Erro ao salvar produto (linha ${productData.excelRowNumber}) no PG:`, dbError);
          }
        }
        console.log(`[BG Proc ${catalogId}] ${savedLocalProducts.length} produtos salvos no PG com seus embeddings (ou null).`);
        if (savedLocalProducts.length === 0) {
             throw new Error("Nenhum produto pôde ser salvo no banco de dados.");
        }

        // --- Extrair e Fazer Upload de TODAS as Imagens (usar arquivo local) ---
        console.log(`[BG Proc ${catalogId}] Extraindo TODAS as imagens e suas âncoras via Python (usando ${localTempFilePath})...`);
        try {
            const pythonResult = await runPythonImageRowExtractor(localTempFilePath!);
            const extractedRawImages: ExtractedImageData[] = pythonResult.images || [];
            console.log(`[BG Proc ${catalogId}] Python extraiu ${extractedRawImages.length} imagens com linha.`);

            if (extractedRawImages.length > 0) {
                console.log(`---> Fazendo upload de ${extractedRawImages.length} imagens extraídas...`);
                const uploadPromises = extractedRawImages.map(async (imgData, index) => {
                    try {
                        const buffer = Buffer.from(imgData.image_base64, 'base64');
                        const imageName = `image_row${imgData.anchor_row}_idx${index}`;
                        const s3Path = `users/${userId}/catalogs/${catalogId}/images/${imageName}.png`;
                        const imageUrl = await uploadBufferToS3(buffer, s3Path, 'image/png');
                        return { imageUrl: imageUrl, anchorRow: imgData.anchor_row, sheetName: imgData.sheet_name };
                    } catch (uploadErr) {
                        console.error(`Erro no upload da imagem da linha ${imgData.anchor_row} (idx ${index}):`, uploadErr);
                        return null;
                    }
                });
                const results = await Promise.all(uploadPromises);
                uploadedImages = results.filter(r => r !== null) as UploadedImageInfo[];
                console.log(`---> ${uploadedImages.length} imagens enviadas com sucesso para S3.`);
            }
        } catch (pyError) {
            console.error(`[BG Proc ${catalogId}] Erro CRÍTICO ao executar/processar script Python de extração de imagem:`, pyError);
            extractionInfo += " (Falha na extração de imagens Python)";
        }

        // --- Associação Inteligente com IA Vision + Fallback (v5) ---
        console.log(`---> Associando ${uploadedImages.length} imagens a ${savedLocalProducts.length} produtos (IA Vision v4 + Fallback Linha Exata Única)...`);
        let associatedCount = 0;
        const imageAssociatedFlags = new Map<string, boolean>(); // Para não reutilizar imagens
        for (const product of savedLocalProducts) {
            const productRowAny: any = product.excelRowNumber;
            if (typeof productRowAny !== 'number' || isNaN(productRowAny) || productRowAny <= 0) {
                console.warn(`[Assoc v5] Produto ID ${product.id} (${product.name}) sem linha válida (${productRowAny}). Pulando.`);
                continue;
            }
            const productRow: number = productRowAny;
            const productDetailsForVision = {
                name: product.name,
                code: product.code,
                description: product.description,
                category: product.category,
                manufacturer: product.manufacturer,
                colors: product.colors,
                materials: product.materials
            };
            console.log(`\n[Assoc v5] Tentando associar para Prod ID ${product.id} (Linha ${productRow}) - ${product.name}`);

            let associatedImage: UploadedImageInfo | undefined = undefined;
            let visionConfirmedMatch = false; // Flag para saber se a IA confirmou
            const candidateImages = uploadedImages.filter(img => img.anchorRow === productRow);

            if (candidateImages && candidateImages.length > 0) {
                console.log(`[Assoc v5]   Encontradas ${candidateImages.length} imagens candidatas na linha ${productRow}`);
                const evaluatedCandidates: { image: UploadedImageInfo, result: { match: boolean, reason: string } | null }[] = [];

                // 1. Avaliar TODAS as candidatas da linha com a IA
                for (const candidateImage of candidateImages) {
                    if (imageAssociatedFlags.has(candidateImage.imageUrl)) {
                        console.log(`[Assoc v5]     Pulando imagem já usada: ${candidateImage.imageUrl.substring(candidateImage.imageUrl.lastIndexOf('/') + 1)}`);
                        continue;
                    }
                    console.log(`[Assoc v5]     Aguardando 1s antes de chamar Vision Compare...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const visionResult = await verifyImageMatchWithVision(productDetailsForVision, candidateImage.imageUrl);
                    evaluatedCandidates.push({ image: candidateImage, result: visionResult });
                }
                // 2. Analisar resultados e escolher SOMENTE se houver EXATAMENTE UM match da IA
                const matches = evaluatedCandidates.filter(c => c.result && c.result.match === true);
                
                if (matches.length === 1) {
                    console.log(`[Assoc v5]   >>> IA VISION CONFIRMOU MATCH ÚNICO na linha ${productRow}! <<<`);
                    associatedImage = matches[0].image;
                    visionConfirmedMatch = true; // Marcar que a IA confirmou
                } else if (matches.length > 1) {
                    console.warn(`[Assoc v5]   AMBIGUIDADE IA: ${matches.length} imagens retornaram 'match: true'. Nenhuma será associada por IA.`);
                    matches.forEach((m, idx) => console.log(`   -> Match Ambíguo ${idx+1}: ${m.image.imageUrl.substring(m.image.imageUrl.lastIndexOf('/') + 1)} (Razão: ${m.result?.reason})`));
                } else { // matches.length === 0
                    console.log(`[Assoc v5]   Nenhum match confirmado pela IA na linha ${productRow}.`);
                }
            } else {
                console.log(`[Assoc v5]   Nenhuma imagem encontrada ancorada na linha ${productRow}.`);
            }

            // 3. *** FALLBACK: Se a IA não confirmou, mas existe EXATAMENTE UMA imagem não usada na linha ***
            if (!associatedImage && candidateImages && candidateImages.length > 0) {
                const unusedCandidates = candidateImages.filter(img => !imageAssociatedFlags.has(img.imageUrl));
                if (unusedCandidates.length === 1) {
                    console.log(`[Assoc v5 Fallback]   IA não confirmou, mas há EXATAMENTE UMA imagem não usada na linha ${productRow}. Usando fallback.`);
                    associatedImage = unusedCandidates[0];
                    // visionConfirmedMatch continua false
                } else if (unusedCandidates.length > 1) {
                     console.log(`[Assoc v5 Fallback]   IA não confirmou e há ${unusedCandidates.length} imagens não usadas na linha ${productRow}. Impossível usar fallback.`);
                } // Se unusedCandidates.length === 0, não faz nada
            }

            // 4. Associar se associatedImage foi definido (pela IA ou pelo Fallback)
            if (associatedImage) {
                imageAssociatedFlags.set(associatedImage.imageUrl, true); // Marcar como usada
                try {
                    await storage.updateProductImageUrl(product.id, associatedImage.imageUrl);
                    associatedCount++;
                    const successLog = visionConfirmedMatch ? '[Assoc v5 SUCESSO (IA)]' : '[Assoc v5 SUCESSO (Fallback)]';
                    console.log(`${successLog}: Prod ID ${product.id} -> Imagem da linha ${associatedImage.anchorRow}, URL: ${associatedImage.imageUrl.substring(associatedImage.imageUrl.lastIndexOf('/') + 1)}`);
                } catch (updateError) {
                    console.error(`[Assoc v5] ERRO DB ao atualizar Imagem do Prod ID ${product.id}:`, updateError);
                }
            } else {
                // Logar falha
                 console.warn(`[Assoc v5 FALHA FINAL]: Nenhuma imagem associada para Prod ID ${product.id} (Linha ${productRow}).`);
            }
        }
        console.log(`---> Associação v5 (IA Vision + Fallback) concluída. ${associatedCount} produtos atualizados com imagens.`);
    } else {
      // CORRIGIDO: Fechar template literal
      throw new Error(`Tipo de arquivo não suportado para processamento de imagem: ${fileType}`);
    }

    // Se chegou aqui sem erro, marca como completo
    await storage.updateCatalogStatus(catalogId, 'completed');
    console.log(`[BG Proc ${catalogId}] Processamento concluído com sucesso. Status: completed. Info: ${extractionInfo}`);

  } catch (error) {
    console.error(`[BG Proc ${catalogId}] ERRO GERAL no processamento background:`, error);
    try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await storage.updateCatalogStatus(catalogId, 'failed');
        console.log(`[BG Proc ${catalogId}] Status atualizado para 'failed'. Erro: ${errorMessage}`);
    } catch (statusUpdateError) {
        console.error(`[BG Proc ${catalogId}] FALHA CRÍTICA ao atualizar status para failed:`, statusUpdateError);
    }
  } finally {
    // Limpar arquivo temporário baixado do S3 (se existir)
    if (localTempFilePath && fs.existsSync(localTempFilePath)) {
      try {
        fs.unlinkSync(localTempFilePath);
        console.log(`[BG Proc ${catalogId}] Arquivo temporário ${localTempFilePath} removido.`);
      } catch (unlinkError) {
        console.error(`[BG Proc ${catalogId}] Erro ao remover arquivo temporário ${localTempFilePath}:`, unlinkError);
      }
    }
  }
}