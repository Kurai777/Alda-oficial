/**
 * Serviço de enriquecimento de catálogos com IA
 * 
 * Este serviço utiliza modelos de IA para melhorar os dados de produtos extraídos
 * de catálogos, incluindo:
 * - Correção de nomes incompletos
 * - Enriquecimento de descrições
 * - Categorização automática
 * - Inferência de dimensões, materiais e preços quando ausentes
 */

import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

config(); // Carrega variáveis de ambiente

// Inicializar clientes de IA
// Importante: o modelo mais recente da Anthropic é "claude-3-7-sonnet-20250219" que foi lançado em 24 de fevereiro de 2025
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Importante: o modelo mais recente da OpenAI é "gpt-4o" que foi lançado em 13 de maio de 2024
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Verifica se um produto tem dados inconsistentes ou incompletos
 * @param {Object} product - Objeto do produto
 * @returns {Object} - Resultado da análise com campos inconsistentes
 */
function analyzeProductConsistency(product) {
  const issues = {
    hasIssues: false,
    incompleteFields: [],
    fieldsToEnrich: []
  };

  // Verificar nome
  if (!product.name || product.name.length < 5 || /^(item|produto|imagem)\s*\d+$/i.test(product.name)) {
    issues.hasIssues = true;
    issues.incompleteFields.push('name');
  }

  // Verificar código
  if (!product.code) {
    issues.hasIssues = true;
    issues.incompleteFields.push('code');
  }

  // Verificar descrição
  if (!product.description || product.description.length < 20) {
    issues.hasIssues = true;
    issues.fieldsToEnrich.push('description');
  }

  // Verificar categoria
  if (!product.category || product.category === 'Outros' || product.category.length < 3) {
    issues.hasIssues = true;
    issues.fieldsToEnrich.push('category');
  }

  // Verificar preço
  if (!product.price || product.price <= 0) {
    issues.hasIssues = true;
    issues.incompleteFields.push('price');
  }

  // Verificar dimensões
  if (!product.sizes || product.sizes.length === 0) {
    issues.hasIssues = true;
    issues.fieldsToEnrich.push('dimensions');
  }

  // Verificar materiais
  if (!product.materials || product.materials.length === 0) {
    issues.hasIssues = true;
    issues.fieldsToEnrich.push('materials');
  }

  return issues;
}

/**
 * Solicita à IA o enriquecimento de um produto com dados inconsistentes
 * @param {Object} product - Objeto do produto
 * @param {Object} issues - Problemas detectados no produto
 * @returns {Promise<Object>} - Produto enriquecido
 */
async function enrichProductWithAI(product, issues) {
  try {
    // Preparar prompt para a IA
    const systemPrompt = `
Você é um especialista em mobiliário e decoração.
Sua tarefa é enriquecer dados de produtos de um catálogo de móveis que estão incompletos ou inconsistentes.
Forneça informações precisas, técnicas e comerciais, sem exageros ou imprecisões.
`;

    const productData = JSON.stringify(product, null, 2);
    const issuesData = JSON.stringify(issues, null, 2);

    const userPrompt = `
Enriqueça os dados deste produto de um catálogo de móveis com base nas informações disponíveis.
Dados atuais do produto:
${productData}

Campos que precisam de atenção:
${issuesData}

Retorne um JSON completo com todos os campos originais mais os campos melhorados.
Se for necessário inferir alguma informação (como dimensões, material ou preço), faça isso de forma razoável com base no tipo de produto, mas indique claramente que é uma inferência.
Para dimensões, use o formato "LxAxP" (Largura x Altura x Profundidade) em centímetros.
Para o preço, se não houver valor, use a string "Sob Consulta".
`;

    // Determinar qual modelo de IA usar (baseado em disponibilidade de chaves API)
    let enhancedProduct;

    if (process.env.ANTHROPIC_API_KEY) {
      // Usar Claude da Anthropic
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Extrair o JSON da resposta
      const content = response.content[0].text;
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      enhancedProduct = jsonMatch 
        ? JSON.parse(jsonMatch[1]) 
        : JSON.parse(content);
    } 
    else if (process.env.OPENAI_API_KEY) {
      // Usar GPT-4o da OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      });

      enhancedProduct = JSON.parse(response.choices[0].message.content);
    } 
    else {
      // Fallback sem IA - apenas estruturar melhor o produto sem modificações
      console.warn("Nenhuma chave de API para IA configurada. Usando fallback sem enriquecimento.");
      
      enhancedProduct = {
        ...product,
        description: product.description || `${product.name || 'Produto'} de alta qualidade.`,
        category: product.category || "Móveis",
        materials: product.materials || ["Material não especificado"],
        sizes: product.sizes || []
      };
    }

    // Garantir que campos essenciais estejam presentes
    enhancedProduct.name = enhancedProduct.name || product.name;
    enhancedProduct.code = enhancedProduct.code || product.code;
    enhancedProduct.price = enhancedProduct.price || product.price;
    enhancedProduct.catalogId = product.catalogId;
    enhancedProduct.userId = product.userId;
    enhancedProduct.imageUrl = product.imageUrl;
    enhancedProduct.isAIEnhanced = true; // Marcar produto como enriquecido por IA

    return enhancedProduct;
  } catch (error) {
    console.error('Erro ao enriquecer produto com IA:', error);
    // Retornar produto original se houver erro
    return { ...product, isAIEnhanced: false };
  }
}

/**
 * Processa um lote de produtos e enriquece aqueles com dados inconsistentes
 * @param {Array} products - Lista de produtos a processar
 * @returns {Promise<Array>} - Lista de produtos processados
 */
async function processProductBatch(products) {
  const processedProducts = [];
  
  for (const product of products) {
    // Analisar consistência
    const issues = analyzeProductConsistency(product);
    
    if (issues.hasIssues) {
      // Produto precisa de enriquecimento
      console.log(`Enriquecendo produto "${product.name || product.code}" com IA`);
      const enhancedProduct = await enrichProductWithAI(product, issues);
      processedProducts.push(enhancedProduct);
    } else {
      // Produto já está ok
      processedProducts.push(product);
    }
  }
  
  return processedProducts;
}

/**
 * Enriquece um catálogo completo usando IA
 * @param {Array} products - Lista de produtos do catálogo
 * @returns {Promise<Array>} - Lista de produtos enriquecidos
 */
async function enhanceCatalogWithAI(products) {
  console.log(`Iniciando enriquecimento de ${products.length} produtos com IA`);
  
  // Processar em lotes para evitar muitas requisições simultâneas
  const batchSize = 5;
  const enhancedProducts = [];
  
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const processedBatch = await processProductBatch(batch);
    enhancedProducts.push(...processedBatch);
    console.log(`Processado lote ${Math.floor(i/batchSize) + 1} de ${Math.ceil(products.length/batchSize)}`);
  }
  
  console.log(`Enriquecimento concluído. ${enhancedProducts.length} produtos processados.`);
  return enhancedProducts;
}

export { 
  analyzeProductConsistency, 
  enrichProductWithAI, 
  enhanceCatalogWithAI 
};