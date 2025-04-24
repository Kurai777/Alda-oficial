import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { determineProductCategory, extractMaterialsFromDescription } from './utils';

// Promisified functions
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Configurar Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Processador alternativo de catálogos usando Claude-3-7-Sonnet
 * Utilizado como backup quando o processador principal (GPT-4o) falha
 */
export async function processImageWithClaude(
  imagePath: string,
  fileName: string,
  userId: number,
  catalogId: number,
  pageNumber: number = 1
): Promise<any[]> {
  try {
    console.log(`Iniciando processamento com Claude AI: ${fileName} (página ${pageNumber})`);
    
    // Ler a imagem como base64
    const imageBuffer = await readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Determinar se é um catálogo Fratini
    const isFratiniCatalog = fileName.toLowerCase().includes("fratini");
    
    // Definir o prompt para extração de produtos
    const systemPrompt = isFratiniCatalog
      ? `Você é um especialista em extrair informações detalhadas sobre produtos de móveis da marca Fratini.
         Sua tarefa é analisar imagens de páginas de catálogos/tabelas de preço e extrair todos os produtos visíveis.
         
         ESPECIFICAÇÕES DA MARCA FRATINI:
         1. Fratini é uma empresa brasileira de móveis para escritório, especialmente cadeiras, poltronas e banquetas
         2. Os códigos de produtos Fratini geralmente seguem o padrão 1.XXXXX.XX.XXXX onde dígitos do meio indicam cores
         3. Os preços são mostrados em Reais (R$)
         4. Cada produto geralmente tem nome comercial, descrição, códigos de referência, cores e preços
         
         FORMATAÇÃO ESPERADA:
         - Para cada produto visível na imagem, extraia: nome, descrição, código, preço, cores disponíveis e materiais
         - Retorne os dados em formato estruturado JSON com produtos em um array
         - Converta os preços para centavos (R$ 750,00 = 75000)
         - Os códigos devem ser extraídos exatamente como aparecem na imagem
         - Não tente adivinhar informações que não estão visíveis na imagem`
      : `Você é um especialista em extrair informações sobre produtos de móveis a partir de imagens de catálogos.
         Sua tarefa é analisar detalhadamente a imagem fornecida e identificar todos os produtos de móveis visíveis.
         
         Para cada produto, forneça as seguintes informações:
         1. Nome completo do produto
         2. Descrição detalhada
         3. Código/referência do produto (se visível)
         4. Preço em formato numérico (converta para centavos, ex: R$ 1.234,56 → 123456)
         5. Categoria (Sofá, Mesa, Cadeira, Estante, Poltrona, etc.)
         6. Materiais utilizados na fabricação
         7. Cores disponíveis
         8. Dimensões (largura, altura, profundidade em cm)
         
         IMPORTANTE:
         - Extraia TODOS os produtos visíveis na imagem, não apenas os mais prominentes
         - Se uma informação não estiver disponível na imagem, use null
         - Não adicione informações que não estejam visíveis na imagem
         - Retorne os dados em formato estruturado JSON com a chave "products" contendo um array de produtos`;
    
    // Prompt específico para o usuário
    const userPrompt = isFratiniCatalog
      ? "Analise esta imagem de um catálogo Fratini e extraia TODOS os produtos visíveis com suas informações completas (nome, descrição, código, preço, cores, materiais). Inclua TODOS os produtos mostrados, mesmo que sejam muitos. Não pule nenhum produto visível."
      : "Analise esta imagem de um catálogo de móveis e extraia TODOS os produtos visíveis com todas as informações disponíveis. Inclua TODOS os produtos mostrados na imagem, não apenas os principais. Não pule nenhum item.";
    
    console.log(`Enviando imagem para análise com Claude-3-7-Sonnet (Página ${pageNumber})...`);
    
    // Fazer a chamada para a Anthropic com a imagem
    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219", // o modelo mais recente da Anthropic foi lançado depois do seu conhecimento
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: userPrompt
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
    });
    
    // Extrair e processar a resposta
    const contentBlock = response.content[0];
    const responseContent = typeof contentBlock === 'object' && 'text' in contentBlock 
      ? contentBlock.text 
      : JSON.stringify(contentBlock);
    console.log(`Resposta recebida do Claude (tamanho: ${responseContent.length} caracteres)`);
    
    // Tentar analisar a resposta como JSON
    try {
      // Extrair apenas o JSON da resposta (pode vir com texto adicional)
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : responseContent;
      
      const parsedResponse = JSON.parse(jsonString);
      
      // Verificar se a resposta contém produtos
      if (parsedResponse && parsedResponse.products && Array.isArray(parsedResponse.products)) {
        const products = parsedResponse.products;
        console.log(`Claude extraiu ${products.length} produtos da imagem (Página ${pageNumber})`);
        
        // Salvar a imagem base64 em cada produto
        const imagePathForUrl = `data:image/jpeg;base64,${base64Image}`;
        
        // Adicionar atributos especiais a cada produto e retornar
        return processExtractedProducts(
          products.map((product: any) => ({
            ...product,
            imageUrl: imagePathForUrl,
            pageNumber
          })),
          userId,
          catalogId
        );
      } else if (parsedResponse && Array.isArray(parsedResponse)) {
        console.log(`Claude retornou array direto com ${parsedResponse.length} produtos`);
        
        // Se a resposta for um array, usar diretamente
        const imagePathForUrl = `data:image/jpeg;base64,${base64Image}`;
        
        // Adicionar atributos especiais a cada produto e retornar
        return processExtractedProducts(
          parsedResponse.map((product: any) => ({
            ...product,
            imageUrl: imagePathForUrl,
            pageNumber
          })),
          userId,
          catalogId
        );
      } else {
        console.warn("Resposta do Claude não contém array de produtos no formato esperado");
        console.log("Resposta original:", responseContent);
        
        // Criar produto único baseado na imagem
        return processExtractedProducts([{
          name: `Produto da Página ${pageNumber}`,
          description: "Produto extraído automaticamente da imagem do catálogo",
          code: `IMG-${pageNumber}-${Date.now().toString().slice(-5)}`,
          price: 0,
          category: "Não categorizado",
          colors: [],
          materials: [],
          sizes: [],
          imageUrl: `data:image/jpeg;base64,${base64Image}`,
          pageNumber
        }], userId, catalogId);
      }
    } catch (parseError) {
      console.error("Erro ao analisar resposta JSON do Claude:", parseError);
      console.log("Conteúdo da resposta:", responseContent);
      
      // Não gerar mais produtos fictícios, propagar o erro
      throw new Error(`Falha ao processar resposta do modelo Claude. A resposta não pôde ser interpretada corretamente. Detalhes: ${parseError instanceof Error ? parseError.message : 'Erro ao analisar resposta JSON'}`);
      
    }
  } catch (error) {
    console.error("Erro no processamento com Claude AI:", error);
    throw error;
  }
}

/**
 * Processa produtos extraídos para garantir que estejam no formato esperado pela aplicação
 */
function processExtractedProducts(products: any[], userId: number, catalogId: number): any[] {
  return products.map(product => {
    // Determinar a categoria com base no nome do produto se não estiver definida
    const category = product.category || determineProductCategory(product.name || '');
    
    // Extrair materiais da descrição se não estiverem definidos
    const materials = Array.isArray(product.materials) && product.materials.length > 0 
      ? product.materials 
      : extractMaterialsFromDescription(product.description || '');
    
    // Processar dimensões para o formato esperado
    let sizes = product.sizes || product.dimensions || [];
    if (!Array.isArray(sizes) && typeof sizes === 'object') {
      // Converter objeto de dimensões para array
      sizes = [sizes];
    } else if (typeof sizes === 'string') {
      // Tentar extrair dimensões de uma string
      const dimensions = extractDimensionsFromString(sizes);
      sizes = dimensions ? [dimensions] : [];
    }
    
    // Retornar o produto no formato esperado
    return {
      userId,
      catalogId,
      name: product.name || "Produto sem nome",
      description: product.description || "",
      code: product.code || `UNKNOWN-CODE`,
      price: typeof product.price === 'number' ? product.price : 
            typeof product.price === 'string' ? parseInt(product.price.replace(/\D/g, '')) : 0,
      category: category || "Não categorizado",
      colors: Array.isArray(product.colors) ? product.colors : 
              typeof product.colors === 'string' ? [product.colors] : [],
      materials: materials,
      sizes: Array.isArray(sizes) ? sizes : [],
      imageUrl: product.imageUrl || ""
    };
  });
}

/**
 * Extrai dimensões de uma string no formato "LxAxP" ou similar
 */
function extractDimensionsFromString(dimensionString: string): any | null {
  try {
    // Padrões comuns: "120x75x40cm", "L120 x A75 x P40 cm", etc.
    const dimensions = dimensionString.toLowerCase().replace(/\s+/g, '');
    const match = dimensions.match(/(\d+)[x×](\d+)[x×](\d+)/);
    
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        depth: parseInt(match[3]),
        label: dimensionString
      };
    }
    
    // Padrão alternativo: "L: 120cm, A: 75cm, P: 40cm"
    const widthMatch = dimensions.match(/l[:]?(\d+)/);
    const heightMatch = dimensions.match(/a[:]?(\d+)/);
    const depthMatch = dimensions.match(/p[:]?(\d+)/);
    
    if (widthMatch || heightMatch || depthMatch) {
      return {
        width: widthMatch ? parseInt(widthMatch[1]) : null,
        height: heightMatch ? parseInt(heightMatch[1]) : null,
        depth: depthMatch ? parseInt(depthMatch[1]) : null,
        label: dimensionString
      };
    }
    
    return null;
  } catch (error) {
    console.error("Erro ao extrair dimensões:", error);
    return null;
  }
}