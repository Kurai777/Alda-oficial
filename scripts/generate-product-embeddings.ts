import OpenAI from 'openai';
import { db } from '../server/db'; // Path correto
import { products } from '../shared/schema'; // Path correto
import { eq, isNull } from 'drizzle-orm';

console.log("[SCRIPT START] Iniciando generate-product-embeddings.ts...");

// Configurar cliente OpenAI
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const EMBEDDING_MODEL = 'text-embedding-3-small';

async function generateEmbeddings() {
  console.log("===> [generateEmbeddings] Função iniciada.");
  if (!openai) {
    console.error('!!! Chave da API OpenAI não configurada. Abortando. !!!');
    process.exit(1); // Sair explicitamente se a chave não estiver configurada
    return; // Adicionado para satisfazer o linter sobre possível não saída
  }
  console.log("===> [generateEmbeddings] Chave OpenAI verificada (OK).");

  console.log("===> [generateEmbeddings] Buscando produtos sem embedding do DB...");
  let productsToProcess;
  try {
    productsToProcess = await db.select({
        id: products.id,
        name: products.name,
        description: products.description,
        category: products.category
      })
      .from(products)
      .where(isNull(products.embedding));
      
    console.log(`===> [generateEmbeddings] Produtos buscados. Encontrados: ${productsToProcess.length}`);

    if (productsToProcess.length === 0) {
      console.log('===> [generateEmbeddings] Nenhum produto novo para gerar embeddings. Saindo educadamente.');
      return; 
    }
    
    const productsToProcessInThisRun = productsToProcess.slice(0, 50); 
    console.log(`===> [generateEmbeddings] Encontrados ${productsToProcess.length} produtos no total. Processando os primeiros ${productsToProcessInThisRun.length} nesta execução...`);

    let processedCount = 0;
    for (const product of productsToProcessInThisRun) {
      console.log(`---> Processando produto ID: ${product.id} - Nome: ${product.name}`);

      const inputText = `Nome: ${product.name || ''}\nCategoria: ${product.category || ''}\nDescrição: ${product.description || ''}`;
      
      if (!inputText.trim() || inputText.trim() === "Nome: \nCategoria: \nDescrição:"){
        console.warn(`     Produto ID: ${product.id} tem texto de input vazio ou apenas labels. Pulando.`);
        continue;
      }

      try {
        console.log(`     Chamando OpenAI API para embedding do produto ID: ${product.id}...`);
        // console.log(`     Texto de input: "${inputText.substring(0, 150)}..."`); // Log opcional do texto
        
        const embeddingResponse = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: inputText,
        });

        const embeddingVector = embeddingResponse.data[0]?.embedding;
        
        if (!embeddingVector) {
          console.error(`     !!! Falha ao gerar embedding para produto ID: ${product.id}. Resposta da API não continha vetor. !!!`);
          continue; 
        }
        console.log(`     Embedding recebido da OpenAI para ID: ${product.id}. Dimensões: ${embeddingVector.length}.`);

        console.log(`     Salvando embedding no banco de dados para ID: ${product.id}...`);
        await db.update(products)
          .set({ embedding: embeddingVector })
          .where(eq(products.id, product.id));

        console.log(`     ---> Embedding salvo com sucesso para produto ID: ${product.id}.`);
        processedCount++;

        // Adicionar um pequeno delay para evitar rate limiting da API OpenAI
        if (productsToProcessInThisRun.length > 1 && processedCount < productsToProcessInThisRun.length) { // Não adicionar delay após o último item
            console.log("     Aguardando 200ms antes do próximo produto...");
            await new Promise(resolve => setTimeout(resolve, 200)); 
        }

      } catch (error: any) {
        console.error(`     !!! Erro ao processar produto ID: ${product.id} (durante chamada OpenAI ou DB update): !!!`, error.message || error);
        // Continuar para o próximo produto em caso de erro individual
      }
    }
    console.log(`===> [generateEmbeddings] Loop de processamento concluído. ${processedCount} produtos tiveram embeddings gerados e salvos nesta execução.`);

  } catch (dbError) {
    console.error('!!! Erro durante a lógica principal de generateEmbeddings (provavelmente DB): !!!', dbError);
    process.exit(1); // Sair explicitamente em caso de erro no DB
    return; // Adicionado para linter
  }
}

console.log("[SCRIPT FLOW] Chamando generateEmbeddings()...");
generateEmbeddings().then(() => {
  console.log("[SCRIPT FLOW] generateEmbeddings() PROMISE resolvida.");
  // Não sair aqui ainda, deixar o script terminar naturalmente se tudo der certo dentro da função,
  // ou a própria função chamará process.exit()
  // Se chegou aqui e não houve process.exit(1) antes, é um sucesso para esta etapa.
  console.log("===> SUCESSO PARCIAL: Script chegou ao final do .then() sem erros fatais nesta etapa.");
  process.exit(0); // Sucesso explícito para esta etapa
}).catch(err => {
  console.error("!!! [SCRIPT FLOW] Erro INESPERADO pego pelo .catch() final: !!!", err);
  process.exit(1); // Falha explícita
}); 