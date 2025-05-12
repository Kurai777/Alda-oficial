import { db } from '../server/db'; 
import { products } from '../shared/schema'; 
import { eq, isNull, sql } from 'drizzle-orm'; // Adicionado sql para possível delete futuro
import { getClipEmbeddingFromImageUrl, initializeClipModel } from '../server/clip-service'; // Importar novo serviço

console.log("[SCRIPT START] Iniciando generate-product-embeddings.ts (VERSÃO PIPELINE/LOCAL MODEL)...");

// DEBUG: Verificar DATABASE_URL
console.log(`[DEBUG] DATABASE_URL usada pelo script: ${process.env.DATABASE_URL ? 'Definida (verifique Secrets)' : 'NÃO DEFINIDA'}`);
if(process.env.DATABASE_URL) {
    try {
        const url = new URL(process.env.DATABASE_URL);
        console.log(`[DEBUG] Host da DATABASE_URL: ${url.hostname}, Usuário: ${url.username}`);
    } catch (e) {
        console.log(`[DEBUG] DATABASE_URL parece estar mal formatada.`);
    }
}

async function generateClipEmbeddingsForProducts() {
  console.log("===> [generateClipEmbeddings] Função iniciada para modelo local.");

  // DEBUG: Verificar colunas do schema products que o script está vendo
  console.log("[DEBUG] Colunas conhecidas para 'products' pelo Drizzle (do shared/schema.ts):");
  console.log(Object.keys(products));
  // @ts-ignore
  if (products.embedding) {
    // @ts-ignore
    console.log(`[DEBUG] Detalhes da coluna 'embedding': type=${products.embedding.dataType}, dimensions=${(products.embedding as any).dimensions}`); 
  } else {
    console.log("[DEBUG] A coluna 'embedding' NÃO FOI ENCONTRADA no objeto 'products' importado!");
  }

  try {
    // TESTE DE SANIDADE: Contar todos os produtos
    const allProductsCountResult = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(products);
    const totalProductsInDb = allProductsCountResult[0]?.count ?? 0;
    console.log(`[DEBUG] Total de produtos na tabela 'products' (via script): ${totalProductsInDb}`);

    if (totalProductsInDb === 0 && process.env.NODE_ENV !== 'test') { // Não abortar se for ambiente de teste que pode ter DB vazio
        console.error("!!! [DEBUG] A tabela 'products' parece estar vazia ou inacessível pelo script. Verifique a conexão/dados no NeonDB e a DATABASE_URL nos Secrets do Replit.");
        // process.exit(1); // Comentar para permitir que o resto do script tente rodar para mais logs
        // return; 
    }

    console.log("===> [generateClipEmbeddings] Buscando produtos COM imageUrl (ignorando status do embedding por enquanto)...");
    let productsToProcess = await db.select({
        id: products.id,
        name: products.name,
        imageUrl: products.imageUrl,
        embedding: products.embedding // Selecionar o embedding para debug
      })
      .from(products)
      .where(sql`${products.imageUrl} IS NOT NULL AND ${products.imageUrl} != ''`);
      
    console.log(`===> [generateClipEmbeddings] Produtos buscados com imageUrl (sem filtro de embedding NULL). Encontrados: ${productsToProcess.length}`);

    if (productsToProcess.length > 0) {
      console.log(`[DEBUG] Amostra dos produtos encontrados (sem filtro de embedding NULL):`);
      productsToProcess.slice(0, 5).forEach(p => { 
        // @ts-ignore 
        const embeddingPreview = p.embedding ? (Array.isArray(p.embedding) ? `Array[${p.embedding.length}]` : typeof p.embedding) : 'NULL';
        console.log(`  ID: ${p.id}, Nome: ${p.name}, ImageURL: ${p.imageUrl ? 'Presente' : 'Ausente'}, Embedding: ${embeddingPreview}`);
      });
    }

    if (productsToProcess.length === 0 && totalProductsInDb > 0) {
      console.log('===> [generateClipEmbeddings] Nenhum produto com imageUrl válida encontrado, embora existam produtos na tabela. Verifique os dados das imageUrls.');
      // Não retorna aqui, para que o filtro de productsNeedingClipEmbedding seja testado
    } else if (productsToProcess.length === 0) {
        console.log('===> [generateClipEmbeddings] Nenhum produto com imageUrl válida encontrado.');
        return; // Se não há produtos com imagem, não há o que processar.
    }
    
    const productsNeedingClipEmbedding = productsToProcess.filter(p => {
      // @ts-ignore
      return !(Array.isArray(p.embedding) && p.embedding.length === 512);
    });
    
    console.log(`===> [generateClipEmbeddings] Destes, ${productsNeedingClipEmbedding.length} produtos precisam de embedding CLIP (não são NULL ou não têm 512 dimensões).`);

    if (productsNeedingClipEmbedding.length === 0) {
      console.log('===> [generateClipEmbeddings] Todos os produtos com imagem já parecem ter embedding CLIP (512 dims) ou nenhum produto com imagem foi encontrado. Saindo.');
      return;
    }

    const BATCH_SIZE = 10;
    const productsToProcessInThisRun = productsNeedingClipEmbedding.slice(0, BATCH_SIZE); 
    console.log(`===> [generateClipEmbeddings] Processando os primeiros ${productsToProcessInThisRun.length} de ${productsNeedingClipEmbedding.length} produtos que precisam de embedding...`);

    let processedCount = 0;
    let successCount = 0;
    for (const product of productsToProcessInThisRun) {
      processedCount++;
      console.log(`---> (${processedCount}/${productsToProcessInThisRun.length}) Processando produto ID: ${product.id} - Nome: ${product.name}`);

      if (!product.imageUrl) {
        console.warn(`     Produto ID: ${product.id} não tem imageUrl (não deveria acontecer após o filtro). Pulando.`);
        continue;
      }

      try {
        console.log(`     Chamando CLIP Service (local) para imagem: ${product.imageUrl.substring(0, 70)}...`);
        
        const clipEmbeddingVector = await getClipEmbeddingFromImageUrl(product.imageUrl);
        
        if (!clipEmbeddingVector || clipEmbeddingVector.length !== 512) { 
          console.error(`     !!! Falha ao gerar/validar embedding CLIP para produto ID: ${product.id}. Vetor inválido ou dimensão incorreta. Esperado 512, recebido: ${clipEmbeddingVector?.length}`);
          continue; 
        }
        console.log(`     Embedding CLIP recebido para ID: ${product.id}. Dimensões: ${clipEmbeddingVector.length}.`);

        console.log(`     Salvando embedding CLIP no banco de dados para ID: ${product.id}...`);
        await db.update(products)
          .set({ embedding: clipEmbeddingVector as any })
          .where(eq(products.id, product.id));

        console.log(`     ---> Embedding CLIP salvo com sucesso para produto ID: ${product.id}.`);
        successCount++;

        if (processedCount < productsToProcessInThisRun.length) {
            const delayMs = 1000; 
            console.log(`     Aguardando ${delayMs}ms antes do próximo produto...`);
            await new Promise(resolve => setTimeout(resolve, delayMs)); 
        }

      } catch (error: any) {
        console.error(`     !!! Erro ao processar embedding CLIP para produto ID: ${product.id}: !!!`, error.message || error);
      }
    }
    console.log(`===> [generateClipEmbeddings] Loop de processamento concluído. ${successCount} de ${processedCount} produtos tiveram embeddings CLIP gerados e salvos nesta execução.`);

  } catch (dbError) {
    console.error('!!! Erro durante a lógica principal de generateClipEmbeddings (provavelmente DB): !!!', dbError);
    process.exit(1);
    // return; // Comentado para evitar erro de unreachable code se process.exit(1) estiver ativo
  }
}

async function main() {
    console.log("[SCRIPT FLOW] Chamando initializeClipModel() do script...");
    try {
        await initializeClipModel(); // Garante que o modelo/pipeline seja carregado no clip-service
        console.log("[SCRIPT FLOW] Modelo CLIP local inicializado pelo script.");
        await generateClipEmbeddingsForProducts();
    } catch (error) {
        console.error("!!! [SCRIPT FLOW] Erro INESPERADO durante a execução do script main:", error);
        process.exit(1);
    }
}

console.log("[SCRIPT FLOW] Iniciando execução da função main() do script...");
main().then(() => {
  console.log("[SCRIPT FLOW] Função main() PROMISE resolvida.");
  console.log("===> SUCESSO: Script de geração de embeddings CLIP (local) chegou ao final do .then() sem erros fatais.");
  process.exit(0); 
}).catch(err => {
  console.error("!!! [SCRIPT FLOW] Erro INESPERADO pego pelo .catch() final ao rodar main():", err);
  process.exit(1);
}); 