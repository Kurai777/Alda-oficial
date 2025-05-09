import OpenAI from 'openai';
import { db } from '../server/db'; // Path correto
import { products } from '../shared/schema'; // Path correto
import { eq, isNull } from 'drizzle-orm';

console.log("[SCRIPT START] Iniciando generate-product-embeddings.ts...");

// Configurar cliente OpenAI
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const EMBEDDING_MODEL = 'text-embedding-3-small';

async function generateEmbeddings() {
  console.log("[SCRIPT LOGIC] Dentro de generateEmbeddings(). Verificando OpenAI key...");
  if (!openai) {
    console.error('Chave da API OpenAI não configurada. Abortando.');
    process.exit(1);
  }
  console.log("[SCRIPT LOGIC] Chave OpenAI OK. Conectando ao DB...");

  console.log('Buscando produtos sem embedding...');
  try {
    const productsToProcess = await db.select({
        id: products.id,
        name: products.name,
        description: products.description,
        category: products.category
      })
      .from(products)
      .where(isNull(products.embedding)); // Processar apenas os que não têm embedding

    console.log(`[SCRIPT LOGIC] Consulta ao DB concluída. Encontrados ${productsToProcess.length} produtos.`);

    if (productsToProcess.length === 0) {
      console.log('Nenhum produto novo para gerar embeddings.');
      return;
    }

    console.log(`Encontrados ${productsToProcess.length} produtos para processar. Iniciando loop...`);

    for (const product of productsToProcess) {
      console.log(`Processando produto ID: ${product.id} - ${product.name}`);

      // 1. Criar texto descritivo
      // Ajustar campos conforme relevância para similaridade
      const inputText = `Nome: ${product.name || ''}\nCategoria: ${product.category || ''}\nDescrição: ${product.description || ''}`;
      
      if (!inputText.trim() || inputText.trim() === "Nome: \nCategoria: \nDescrição:"){
        console.warn(`   Produto ID: ${product.id} tem texto vazio. Pulando.`);
        continue;
      }

      try {
        console.log(`   Chamando OpenAI API para ID: ${product.id}...`);
        // 2. Gerar embedding com OpenAI
        console.log(`   Gerando embedding para: "${inputText.substring(0, 100)}..."`);
        const embeddingResponse = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: inputText,
        });

        const embeddingVector = embeddingResponse.data[0]?.embedding;
        console.log(`   OpenAI respondeu para ID: ${product.id}. Vetor ${embeddingVector ? 'OK' : 'NULO'}.`);

        if (!embeddingVector) {
          console.error(`   Falha ao gerar embedding para produto ID: ${product.id}. Resposta da API não continha vetor.`);
          continue; // Pular para o próximo produto
        }

        // 3. Salvar vetor no banco de dados
        console.log(`   Salvando embedding (${embeddingVector.length} dimensões) no banco de dados...`);
        await db.update(products)
          .set({ embedding: embeddingVector })
          .where(eq(products.id, product.id));

        console.log(`   Embedding salvo com sucesso para produto ID: ${product.id}.`);

        // Adicionar um pequeno delay para evitar rate limiting da API OpenAI
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

      } catch (error: any) {
        console.error(`   Erro ao processar produto ID: ${product.id}:`, error.message || error);
        // Continuar para o próximo produto em caso de erro individual
      }
    }

    console.log('Processamento de embeddings concluído.');

  } catch (dbError) {
    console.error('Erro ao buscar produtos do banco de dados:', dbError);
    process.exit(1);
  }
}

console.log("[SCRIPT START] Chamando generateEmbeddings()...");
generateEmbeddings().then(() => {
  console.log("[SCRIPT END] generateEmbeddings() concluído com sucesso.");
  process.exit(0);
}).catch(err => {
  console.error("[SCRIPT END] Erro inesperado durante a geração de embeddings:", err);
  process.exit(1);
}); 