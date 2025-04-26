/**
 * Serviço de Aprimoramento de Catálogos via OpenAI
 * 
 * Este serviço recebe dados brutos de produtos após o mapeamento inicial
 * e usa a OpenAI para corrigir, complementar e estruturar melhor os dados.
 */

import OpenAI from 'openai';

// Inicializar cliente OpenAI
// o modelo mais recente do OpenAI é "gpt-4o" que foi lançado em 13 de maio de 2024. não altere isso a menos que seja explicitamente solicitado pelo usuário
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Prompt base para o assistente de catalogação
 */
const CATALOG_ASSISTANT_PROMPT = `Você é um Assistente de Catalogação de Produtos de Alto Padrão.

Receberá um input contendo dados extraídos de um Excel ou PDF de catálogo. Esses dados podem estar incompletos, bagunçados ou parcialmente corrompidos.

Sua missão é:
1. Identificar Nome, Código, Preço, Categoria, Descrição, Materiais, Dimensões.
2. Corrigir nomes genéricos (ex: "Item 1", "Imagem 2") para um nome descritivo baseado no texto.
3. Corrigir descrições curtas.
4. Inferir categoria correta (Sofá, Mesa, Cadeira, Armário, etc.).
5. Inferir materiais do produto (Madeira, Couro, Tecido, Metal, etc.).
6. Corrigir preços (formato R$ X.XXX,XX).
7. Se faltar dados, preencher como "Sob Consulta".

Formato de saída esperado (sempre JSON):

[
  {
    "nome": "",
    "codigo": "",
    "descricao": "",
    "preco": "",
    "categoria": "",
    "dimensoes": "",
    "material": "",
    "imagem": "",
    "local": "",
    "fornecedor": ""
  }
]`;

/**
 * Aprimora um conjunto de produtos com a IA
 * 
 * @param {Array} products Lista de produtos extraídos do processador universal
 * @returns {Promise<Array>} Lista de produtos aprimorados pela IA
 */
export async function enhanceCatalogWithAI(products) {
  if (!products || products.length === 0) {
    console.log("Nenhum produto para aprimorar com IA");
    return products;
  }
  
  try {
    console.log(`\n=== INICIANDO APRIMORAMENTO COM IA PARA ${products.length} PRODUTOS ===`);
    
    // Limitar o número de produtos para evitar tokens excessivos na API
    const BATCH_SIZE = 50;
    const enhancedProducts = [];
    
    // Processar em lotes para evitar exceder o limite de tokens
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      console.log(`Processando lote ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(products.length/BATCH_SIZE)} (${batch.length} produtos)`);
      
      // Converter produtos para o formato esperado pela IA
      const productsForAI = batch.map(p => ({
        nome: p.name || "",
        codigo: p.code || "",
        descricao: p.description || p.name || "",
        preco: p.price ? `R$ ${(p.price/100).toFixed(2)}` : "",
        categoria: p.category || "",
        dimensoes: p.dimensions || "",
        material: Array.isArray(p.materials) ? p.materials.join(", ") : p.materials || "",
        imagem: p.imageUrl || "",
        local: p.location || "",
        fornecedor: p.manufacturer || ""
      }));
      
      // Enviar para OpenAI
      const response = await processWithOpenAI(productsForAI);
      
      // Processar resposta e converter de volta para o formato da aplicação
      if (response && Array.isArray(response)) {
        const processedBatch = response.map((enhancedProduct, index) => {
          const originalProduct = batch[index];
          
          // Calcular preço em centavos a partir do preço formatado
          let priceInCents = originalProduct.price || 0;
          if (enhancedProduct.preco && enhancedProduct.preco !== "Sob Consulta") {
            const priceStr = enhancedProduct.preco.replace("R$", "").trim();
            const normalizedPrice = priceStr.replace(".", "").replace(",", ".");
            const price = parseFloat(normalizedPrice);
            if (!isNaN(price)) {
              priceInCents = Math.round(price * 100);
            }
          }
          
          // Converter materiais de string para array
          let materials = originalProduct.materials || [];
          if (enhancedProduct.material && typeof enhancedProduct.material === 'string') {
            materials = enhancedProduct.material
              .split(",")
              .map(m => m.trim())
              .filter(m => m && m !== "Sob Consulta");
          }
          
          return {
            ...originalProduct,
            name: enhancedProduct.nome || originalProduct.name,
            code: enhancedProduct.codigo || originalProduct.code,
            description: enhancedProduct.descricao || originalProduct.description,
            category: enhancedProduct.categoria || originalProduct.category,
            price: priceInCents,
            materials: materials,
            dimensions: enhancedProduct.dimensoes || originalProduct.dimensions,
            manufacturer: enhancedProduct.fornecedor || originalProduct.manufacturer,
            location: enhancedProduct.local || originalProduct.location,
          };
        });
        
        enhancedProducts.push(...processedBatch);
        console.log(`Lote ${Math.floor(i/BATCH_SIZE) + 1} processado com sucesso`);
      } else {
        // Se houver erro no processamento do lote, manter os produtos originais
        console.log(`Erro no processamento do lote ${Math.floor(i/BATCH_SIZE) + 1}, mantendo produtos originais`);
        enhancedProducts.push(...batch);
      }
      
      // Aguardar um momento para evitar rate limiting
      if (i + BATCH_SIZE < products.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`=== APRIMORAMENTO COM IA CONCLUÍDO ===`);
    console.log(`${enhancedProducts.length} produtos processados pela IA`);
    
    return enhancedProducts;
    
  } catch (error) {
    console.error("Erro ao aprimorar catálogo com IA:", error);
    // Em caso de erro, retornar os produtos originais
    return products;
  }
}

/**
 * Processa um lote de produtos com a OpenAI
 * 
 * @param {Array} productsData Dados dos produtos a serem processados
 * @returns {Promise<Array>} Produtos aprimorados
 */
async function processWithOpenAI(productsData) {
  try {
    console.log(`Enviando ${productsData.length} produtos para OpenAI...`);
    
    // Preparar mensagens para a API
    const messages = [
      { 
        role: "system", 
        content: CATALOG_ASSISTANT_PROMPT 
      },
      { 
        role: "user", 
        content: JSON.stringify(productsData, null, 2) 
      }
    ];
    
    // Chamar a API da OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o",  // modelo mais recente
      messages: messages,
      temperature: 0.2,  // baixa temperatura para resultados mais consistentes
      max_tokens: 4096,  // limite generoso para acomodar muitos produtos
      response_format: { type: "json_object" }  // forçar resposta em JSON
    });
    
    // Extrair e processar a resposta
    const result = response.choices[0].message.content;
    
    // Verificar se a resposta é um JSON válido
    try {
      // Parse da resposta JSON
      const parsedResult = JSON.parse(result);
      
      // Verificar se a resposta contém um array de produtos
      if (Array.isArray(parsedResult)) {
        return parsedResult;
      } else if (parsedResult && Array.isArray(parsedResult.products)) {
        return parsedResult.products;
      } else if (parsedResult && typeof parsedResult === 'object') {
        // Procurar qualquer array na resposta
        for (const key in parsedResult) {
          if (Array.isArray(parsedResult[key])) {
            return parsedResult[key];
          }
        }
      }
      
      console.log("Resposta da IA não contém um array de produtos:", parsedResult);
      return productsData;
      
    } catch (parseError) {
      console.error("Erro ao fazer parse da resposta da IA:", parseError);
      console.log("Resposta bruta da IA:", result);
      return productsData;
    }
    
  } catch (error) {
    console.error("Erro na chamada da API OpenAI:", error);
    return productsData;
  }
}