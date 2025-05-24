import xlsx from 'xlsx';
import { storage } from './storage.js'; // To get catalog details
// @ts-ignore
import { downloadFileFromS3 } from './s3-service.js'; // To download the file from S3
import { Catalog } from '@shared/schema'; // Type for catalog

interface ExtractedPriceItem {
  code?: string;
  name?: string;
  price?: number;
  // Add other fields you might want to extract, e.g., model, description
}

/**
 * Extracts the S3 key from a full S3 URL.
 * Example: https://bucket-name.s3.region.amazonaws.com/users/1/catalogs/2/file.xlsx -> users/1/catalogs/2/file.xlsx
 * @param s3Url Full S3 URL
 * @returns S3 key or null if URL is invalid
 */
function extractS3KeyFromUrl(s3Url: string): string | null {
  if (!s3Url || !s3Url.startsWith('http')) {
    // If it's not a URL, it might already be a key or an invalid value
    // For now, let's assume if not a URL, it's not something we can directly parse a key from here.
    // Depending on how URLs/keys are stored, this logic might need adjustment.
    // If pricingFileUrl can sometimes be a key, we could return s3Url here.
    console.warn(`[extractS3KeyFromUrl] Provided s3Url does not seem to be a full URL: ${s3Url}`);
    // Attempt to see if it's a path-like key (e.g. users/...)
    if (s3Url.includes('/') && !s3Url.startsWith('http') && !s3Url.startsWith('data:')) {
        return s3Url; // Assume it's already a key
    }
    return null;
  }
  try {
    const url = new URL(s3Url);
    // The pathname starts with a '/', so we remove it.
    // Example: /users/1/catalogs/2/file.xlsx -> users/1/catalogs/2/file.xlsx
    const key = decodeURIComponent(url.pathname.substring(1));
    return key;
  } catch (error) {
    console.error(`[extractS3KeyFromUrl] Error parsing S3 URL ${s3Url}:`, error);
    return null;
  }
}

export async function processPricingFile(catalogId: number): Promise<ExtractedPriceItem[] | null> {
  console.log(`[PricingProcessor] Iniciando processamento do arquivo de preços para o catálogo ID: ${catalogId}`);
  let catalog: Catalog | undefined;

  try {
    catalog = await storage.getCatalog(catalogId);
    if (!catalog) {
      console.error(`[PricingProcessor] Catálogo com ID ${catalogId} não encontrado.`);
      return null;
    }

    if (!catalog.pricingFileUrl) {
      console.log(`[PricingProcessor] Catálogo ID ${catalogId} não possui arquivo de preços (pricingFileUrl está vazio).`);
      return null; // No pricing file to process
    }

    const fileUrl = catalog.pricingFileUrl;
    const fileExtension = fileUrl.substring(fileUrl.lastIndexOf('.')).toLowerCase();

    if (fileExtension !== '.xlsx' && fileExtension !== '.xls') {
      console.log(`[PricingProcessor] Arquivo de preços para o catálogo ID ${catalogId} não é um arquivo Excel suportado (recebido: ${fileExtension}). Pulando processamento de preços.`);
      // TODO: Adicionar suporte para PDF de preços aqui no futuro
      return null;
    }
    
    const s3Key = extractS3KeyFromUrl(fileUrl);
    if (!s3Key) {
        console.error(`[PricingProcessor] Não foi possível extrair a chave S3 do pricingFileUrl: ${fileUrl} para o catálogo ID: ${catalogId}`);
        return null;
    }

    console.log(`[PricingProcessor] Baixando arquivo de preços do S3: ${s3Key}`);
    const fileBuffer = await downloadFileFromS3(s3Key);

    if (!fileBuffer || !(fileBuffer instanceof Buffer)) {
        console.error(`[PricingProcessor] Falha ao baixar ou buffer inválido para o arquivo de preços do S3: ${s3Key}`);
        return null;
    }
    
    console.log(`[PricingProcessor] Arquivo de preços baixado (${(fileBuffer.length / 1024).toFixed(2)} KB). Lendo com xlsx...`);

    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convertendo para JSON. header: 1 significa que a primeira linha é o cabeçalho.
    // A opção defval: null garante que células vazias sejam null em vez de undefined.
    const jsonData: any[] = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    if (jsonData.length === 0) {
      console.log(`[PricingProcessor] Planilha de preços para o catálogo ID ${catalogId} está vazia ou não pôde ser lida como JSON.`);
      return [];
    }

    // Assume que a primeira linha são os cabeçalhos
    const headers: string[] = jsonData[0]?.map((header: any) => String(header || '').trim().toLowerCase()) || [];
    const dataRows = jsonData.slice(1);

    console.log(`[PricingProcessor] Cabeçalhos detectados: ${headers.join(', ')}`);

    // Heurística para encontrar as colunas relevantes
    // TODO: Tornar isso mais robusto ou configurável
    const codeHeaderKeywords = ['código', 'codigo', 'cod.', 'sku', 'item', 'ref', 'referência', 'referencia'];
    const nameHeaderKeywords = ['nome', 'produto', 'descrição', 'descricao', 'desc'];
    const priceHeaderKeywords = ['preço', 'preco', 'valor', 'price', 'cost'];

    let codeColIndex = -1;
    let nameColIndex = -1;
    let priceColIndex = -1;

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (codeHeaderKeywords.some(keyword => header.includes(keyword)) && codeColIndex === -1) codeColIndex = i;
        if (nameHeaderKeywords.some(keyword => header.includes(keyword)) && nameColIndex === -1) nameColIndex = i;
        if (priceHeaderKeywords.some(keyword => header.includes(keyword)) && priceColIndex === -1) priceColIndex = i;
    }

    if (priceColIndex === -1) {
      console.warn(`[PricingProcessor] Coluna de PREÇO não encontrada na planilha do catálogo ID ${catalogId}. Não é possível extrair preços.`);
      // Poderia retornar itens sem preço se código/nome forem encontrados, ou null/[] se preço é crucial.
      // Por ora, se não há preço, não há muito o que fazer para a mesclagem de preços.
      return []; 
    }
     console.log(`[PricingProcessor] Mapeamento de colunas: Código Idx: ${codeColIndex}, Nome Idx: ${nameColIndex}, Preço Idx: ${priceColIndex}`);

    const extractedItems: ExtractedPriceItem[] = [];
    for (const row of dataRows) {
      if (!row || row.every((cell: any) => cell === null || String(cell).trim() === '')) continue; // Pular linhas completamente vazias

      const priceString = row[priceColIndex] !== null ? String(row[priceColIndex]) : null;
      let priceNumber: number | undefined = undefined;

      if (priceString) {
        // Tenta limpar e converter o preço. Ex: "R$ 1.234,56" -> 1234.56
        const cleanedPrice = priceString.replace(/[^0-9.,]/g, '').replace('.', '').replace(',', '.');
        priceNumber = parseFloat(cleanedPrice);
        if (isNaN(priceNumber)) {
            console.warn(`[PricingProcessor] Valor de preço inválido ('${priceString}') na linha para o catálogo ID ${catalogId}. Pulando preço.`);
            priceNumber = undefined; // Reset se não for um número válido
        }
      }
      
      // Se a coluna de preço foi encontrada, mas o valor do preço na linha é inválido ou vazio, ainda podemos extrair código/nome
      // mas o item não terá preço. A mesclagem decidirá o que fazer.
      // No entanto, a checagem anterior (priceColIndex === -1) já pararia se a *coluna* de preço não existe.

      const item: ExtractedPriceItem = {
        code: codeColIndex !== -1 && row[codeColIndex] !== null ? String(row[codeColIndex]).trim() : undefined,
        name: nameColIndex !== -1 && row[nameColIndex] !== null ? String(row[nameColIndex]).trim() : undefined,
        price: priceNumber,
      };
      
      // Adicionar o item apenas se tiver um código ou nome, e um preço válido (ou se permitirmos itens sem preço)
      // Por enquanto, vamos adicionar se tiver pelo menos código ou nome, mesmo que o preço seja undefined após tentativa de parse.
      // A lógica de mesclagem precisará lidar com preços ausentes.
      if (item.code || item.name) {
        extractedItems.push(item);
      }
    }

    console.log(`[PricingProcessor] Extraídos ${extractedItems.length} itens da planilha de preços para o catálogo ID ${catalogId}.`);
    // console.log(JSON.stringify(extractedItems.slice(0, 5), null, 2)); // Log de exemplo dos primeiros 5 itens

    return extractedItems;

  } catch (error) {
    console.error(`[PricingProcessor] Erro ao processar arquivo de preços para o catálogo ID ${catalogId}:`, error);
    // Se der erro, atualiza status do catálogo para falha no processamento de preços?
    // await storage.updateCatalogStatus(catalogId, 'failed_pricing'); // Exemplo
    return null;
  }
} 