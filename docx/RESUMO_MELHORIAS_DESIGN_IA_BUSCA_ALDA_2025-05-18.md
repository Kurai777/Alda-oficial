# Resumo de Alterações e Melhorias no Projeto Ald-a (Foco: Design com IA & Busca) - 18 de Maio de 2025

Este documento resume as principais alterações, correções e melhorias implementadas recentemente no projeto Ald-a, com ênfase nas funcionalidades de Design com Inteligência Artificial e no sistema de busca de produtos. O objetivo é fornecer um contexto claro para a equipe de desenvolvimento sobre o estado atual e os trabalhos realizados.

## I. Alterações no Banco de Dados (PostgreSQL com NeonDB)

1.  **Coluna de Embedding de Produtos Aprimorada:**
    *   **O quê:** A coluna `embedding` na tabela `products` foi alterada do tipo `vector(512)` para `vector(1536)`.
    *   **Por quê:** Para suportar os vetores de embedding gerados pelo modelo `text-embedding-3-small` da OpenAI, que produz vetores de 1536 dimensões. Isso permite uma representação semântica mais rica dos produtos para a busca por similaridade visual/textual.
    *   **Como:** A alteração foi feita no schema Drizzle (`shared/schema.ts`) e aplicada ao banco de dados através de uma migração gerada por `npx drizzle-kit generate` e aplicada com `npx drizzle-kit migrate`.

2.  **Automação da Indexação para Busca Textual (FTS):**
    *   **O quê:** Foi criada (ou verificada a existência e corrigida) uma função SQL chamada `update_products_search_tsv()` e um trigger associado `products_search_tsv_update_trigger` na tabela `products`.
    *   **Por quê:** Para garantir que a coluna `search_tsv` (do tipo `tsvector`) seja populada e atualizada automaticamente toda vez que um produto é inserido (`INSERT`) ou modificado (`UPDATE`). Esta coluna é essencial para a funcionalidade de Busca Textual de Texto Completo (FTS) do PostgreSQL.
    *   **Como:** A função SQL concatena campos textuais relevantes do produto (nome, descrição, categoria, fabricante, e elementos de arrays como cores e materiais) e os converte para `tsvector` usando a configuração de idioma `'portuguese'`. O trigger executa esta função `BEFORE INSERT OR UPDATE` em cada linha da tabela `products`.
    *   **Índice:** Confirmada a existência de um índice GIN na coluna `search_tsv` (`idx_gin_products_search_tsv`) para otimizar a performance das queries FTS.

## II. Melhorias no Módulo de Design com IA (`server/ai-design-processor.ts`)

### A. Detecção de Objetos e Atributos pela IA de Visão (GPT-4o)

1.  **Refinamento de Prompt:**
    *   **O quê:** O prompt do sistema enviado ao modelo GPT-4o Vision (para a análise inicial da imagem do ambiente e detecção de móveis) foi iterativamente refinado.
    *   **Por quê:** Para melhorar a precisão na classificação dos tipos de móveis (ex: fazer distinções mais claras entre "cadeira" e "poltrona") e para encorajar a IA a gerar bounding boxes (`bbox`) mais precisas e que envolvam melhor os objetos detectados.
    *   **Como:** Foram adicionadas instruções mais explícitas, exemplos e dicas de diferenciação no prompt.

2.  **Parsing Robusto da Resposta da IA:**
    *   **O quê:** A lógica no backend que faz o parse da resposta JSON da IA de Visão foi tornada mais flexível.
    *   **Por quê:** Observou-se que a API da OpenAI podia retornar os dados dos móveis detectados em formatos ligeiramente diferentes (um array de objetos, um único objeto JSON, ou um objeto JSON com uma chave `"furniture"` encapsulando o array).
    *   **Como:** O código de parsing agora verifica múltiplos formatos possíveis e tenta extrair os campos `name` (ou `nome`), `description` (ou `descrição`), e `bbox` (ou `bounding_box`) de forma mais resiliente.

### B. Lógica de Sugestão de Produtos (`findSuggestionsForItem`)

Esta função, que antes era um placeholder, foi implementada para fornecer sugestões de produtos relevantes para cada item detectado pela IA.

1.  **Geração de Embedding Textual para Itens Detectados:**
    *   **O quê:** Para cada item de design detectado pela IA (ex: "sofá cinza claro, estilo moderno"), um embedding vetorial é gerado.
    *   **Por quê:** Para permitir a busca por similaridade semântica no catálogo de produtos.
    *   **Como:** O nome e a descrição do item detectado são combinados em uma string de texto, que é então enviada para a API da OpenAI para gerar um embedding de 1536 dimensões usando o modelo `text-embedding-3-small`.

2.  **Busca Híbrida (Textual FTS + Similaridade Visual/Semântica):**
    *   **Busca Textual (FTS):** A função `storage.searchProducts` (que foi aprimorada, veja Seção III) é chamada com o texto do item detectado para encontrar produtos correspondentes com base em palavras-chave.
    *   **Busca por Similaridade de Embedding:** A função `storage.findProductsByEmbedding` é chamada com o embedding de 1536D do item detectado para encontrar produtos no catálogo que tenham embeddings textuais vetoriais semanticamente similares.

3.  **Combinação e Ranking de Scores:**
    *   **O quê:** Os resultados das buscas textual e visual são combinados e classificados.
    *   **Por quê:** Para fornecer uma lista unificada e priorizada de sugestões.
    *   **Como:**
        *   Os scores de relevância da FTS (`relevance` do `ts_rank_cd`) são normalizados para uma escala de 0-1 (baseado no score máximo da leva atual de resultados FTS).
        *   Os scores de distância da busca por embedding (onde menor distância é melhor) são convertidos para um score de similaridade (0-1, maior é melhor) usando a fórmula `(MAX_POSSIBLE_DISTANCE - distance) / MAX_POSSIBLE_DISTANCE`.
        *   Um `combinedScore` é calculado para cada produto sugerido, aplicando pesos configuráveis aos scores normalizados de texto e visual (inicialmente definidos como `textWeight = 0.5` e `visualWeight = 0.5`).
        *   As sugestões são então ordenadas pelo `combinedScore` em ordem decrescente.

4.  **Filtragem Estrita por Categoria:**
    *   **O quê:** Após o ranking inicial, uma etapa de filtragem por categoria é aplicada.
    *   **Por quê:** Para remover sugestões que, apesar de terem um bom score textual ou visual, pertencem a uma categoria de produto claramente diferente do item detectado pela IA (ex: não sugerir uma mesa para uma luminária).
    *   **Como:** O nome do objeto detectado pela IA é comparado com a categoria do produto sugerido. A lógica inclui matches diretos, parciais e um sistema de mapeamento para sinônimos comuns ou categorias relacionadas (ex: "poltrona" e "cadeira" podem ser consideradas equivalentes em certos contextos). Produtos com categoria nula ou vazia no banco são geralmente rejeitados por este filtro.

5.  **Logging:** Foram adicionados logs detalhados para cada etapa da função, facilitando a depuração e o ajuste fino da relevância.

## III. Melhorias na Busca Textual FTS (`server/storage.ts`)

A função `storage.searchProducts` foi significativamente refatorada para melhorar a robustez e a relevância dos resultados da FTS:

1.  **Normalização de Texto Aprimorada:** Mantém caracteres como `.` e `-` (úteis para dimensões e nomes compostos) e substitui outros caracteres não alfanuméricos por espaços.
2.  **Tokenização Ajustada:** O filtro de comprimento mínimo do token foi ligeiramente reduzido, e o número de palavras-chave consideradas foi aumentado.
3.  **Estratégia de Busca em Camadas:**
    *   **Tentativa 1: `websearch_to_tsquery()`:** Utilizada como primeira abordagem, pois é mais flexível com a sintaxe de busca do usuário (similar a uma busca web) e geralmente produz bons resultados com operadores AND implícitos.
    *   **Tentativa 2: `plainto_tsquery()`:** Utilizada como fallback se `websearch_to_tsquery` retornar poucos resultados. Também impõe uma lógica AND.
    *   **Tentativa 3: `to_tsquery()` com Operador OR (`|`):** Utilizada como fallback final se as buscas anteriores (baseadas em AND) falharem em encontrar resultados suficientes. Esta abordagem é mais abrangente, mas pode ser menos precisa.
4.  **Fallback para Keyword Única:** Se o processo de tokenização e filtro de stopwords não resultar em nenhuma palavra-chave válida, o sistema agora tenta usar todo o texto de busca normalizado como uma única palavra-chave.
5.  **Logging:** Adicionado logging detalhado para cada etapa da query FTS.

## IV. Automação da Geração de Embeddings de Produto (`server/catalog-processor.ts`)

1.  **Geração de Embedding na Criação do Produto:**
    *   **O quê:** A lógica para gerar embeddings textuais para os produtos foi integrada diretamente ao fluxo de processamento de catálogos (`processCatalogInBackground`).
    *   **Por quê:** Para garantir que todos os novos produtos adicionados através do upload de catálogos tenham seus embeddings gerados e salvos automaticamente, eliminando a necessidade de rodar scripts manuais.
    *   **Como:** Quando um produto é extraído dos dados do catálogo (Excel), uma string combinando seus campos textuais (nome, categoria, descrição, fabricante, cores, materiais) é criada. Essa string é usada para gerar um embedding de 1536 dimensões através do modelo `text-embedding-3-small` da OpenAI. O vetor de embedding resultante é então salvo na coluna `products.embedding` junto com os outros dados do produto quando `storage.createProduct` é chamado.
    *   A lógica anterior que gerava embeddings baseados em imagem (CLIP 512D) durante a associação de imagens foi removida para focar nos embeddings textuais de 1536D para consistência.

## V. Sistema de Notificação em Tempo Real (WebSockets)

Foram feitas várias correções e melhorias no sistema WebSocket cliente-servidor para garantir que a interface do usuário (UI) seja atualizada automaticamente após a conclusão do processamento de design com IA.

1.  **Backend (`server/index.ts`, `server/websocket-service.ts`):**
    *   Centralização do gerenciamento de conexões no `WebSocketManagerService` (`webSocketManager`).
    *   Garantia de que o `projectId` (enviado pelo cliente na URL de conexão WebSocket) seja corretamente lido e usado para associar a conexão WebSocket ao projeto específico dentro do `webSocketManager`.
    *   A função `broadcastToProject` em `server/index.ts` foi simplificada para usar exclusivamente o `webSocketManager` e para passar corretamente o `eventType` e `payload` da mensagem original.
    *   Os `WebSocketEventType` no servidor foram atualizados para incluir os novos tipos de eventos específicos do processamento de IA (ex: `AI_PROCESSING_COMPLETE`).

2.  **Frontend (`client/lib/websocketService.ts`, `client/src/pages/design-ai-project.tsx`):**
    *   Os `WebSocketEventType` no cliente foram atualizados para corresponder aos do servidor.
    *   A lógica de conexão no `WebSocketService` do cliente foi aprimorada para lidar melhor com mudanças de `projectId` e reconexões, garantindo que a conexão seja estabelecida com o `projectId` correto na URL.
    *   O hook `useWebSocket` foi integrado à página `DesignAiProjectPage` para se inscrever nos eventos WebSocket relevantes (como `AI_PROCESSING_COMPLETE`). Ao receber tal evento para o projeto atual, o hook agora dispara a invalidação da query do React Query (`queryClient.invalidateQueries({ queryKey: ['designProject', projectId] })`), o que força o frontend a buscar os dados mais recentes do projeto e atualizar a UI.

## VI. Status Atual e Próximos Passos Recomendados

*   **Funcionalidade Principal:** A análise de imagem pela IA, a criação de itens de design, a geração de embeddings textuais para produtos (automaticamente no upload) e para itens detectados (em tempo real), a busca híbrida (FTS + Vetorial), a combinação de scores, e a filtragem por categoria estão implementadas.
*   **UI:** As sugestões estão sendo exibidas na UI. A atualização da UI via WebSocket após o processamento da IA ainda está sendo validada nos últimos testes.
*   **Qualidade das Sugestões:** Melhorou significativamente com o filtro de categoria e a inclusão da busca vetorial, mas ainda há um campo vasto para aprimoramentos na relevância.
*   **Recomendações:**
    1.  **Validação Final do WebSocket:** Confirmar que a UI está atualizando automaticamente do status "Processando..." para exibir as sugestões sem necessidade de recarregar a página.
    2.  **Tratamento de UI para "Nenhuma Sugestão":** Garantir que a UI mostre uma mensagem clara (ex: "Nenhuma sugestão encontrada para este item") quando o backend, após todos os filtros, não retornar nenhuma sugestão para um item detectado (como no caso da "luminária de chão").
    3.  **Refinamento da Precisão da IA de Visão:** Continuar ajustando o prompt do GPT-4o em `processDesignProjectImage` para melhorar a classificação de objetos (ex: cadeira vs. poltrona) e a qualidade das bounding boxes.
    4.  **Ajuste Fino da Lógica de Relevância em `findSuggestionsForItem`:**
        *   Experimentar com os pesos `textWeight` e `visualWeight`.
        *   Implementar um limiar de `matchScore` mínimo para exibir uma sugestão.
        *   Refinar a forma como os scores de FTS (especialmente da query OR) são normalizados e contribuem.
        *   Considerar a criação de um `searchText` mais conciso para as queries FTS do tipo AND (`websearch_to_tsquery`, `plainto_tsquery`) para aumentar a chance de obter resultados mais precisos dessas buscas.
    5.  **Qualidade dos Dados de Categoria:** Revisar e padronizar os dados no campo `category` da tabela `products` para melhorar a eficácia do filtro de categoria.
    6.  **Estratégia de Fusão Multimodal Avançada (Próximo Nível):** Se os refinamentos acima não forem suficientes, implementar a estratégia de gerar embeddings CLIP para regiões da imagem de referência e para as imagens dos produtos, e combinar similaridade visual (CLIP) com similaridade textual (OpenAI embeddings) de forma mais direta.

Este resumo deve ajudar a sua equipe a se atualizar sobre os recentes desenvolvimentos. 