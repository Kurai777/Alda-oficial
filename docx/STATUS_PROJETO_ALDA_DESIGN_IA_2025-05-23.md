# Documentação e Status do Projeto Ald-a: Funcionalidade de Design com IA (23 de Maio de 2025)

## 1. Resumo do Projeto Ald-a (Foco: Design com IA)

O objetivo principal da funcionalidade "Design com IA" no projeto Ald-a é permitir que os usuários enviem uma imagem de um render de ambiente. A IA então analisa essa imagem para identificar os principais móveis presentes, e sugere produtos correspondentes do catálogo da empresa que poderiam substituir os itens fictícios do render. Isso visa auxiliar designers e clientes a visualizarem produtos reais em seus projetos de forma rápida e inteligente.

## 2. Progresso Realizado (Detalhado)

Até a presente data, foram implementados e refinados os seguintes componentes chave:

### 2.1. Identificação de Objetos e Características
*   **Análise de Imagem com IA de Visão:** Utilização da API OpenAI GPT-4o Vision para analisar a imagem de render fornecida pelo usuário.
*   **Extração de Dados:** O sistema extrai:
    *   Nomes dos móveis principais detectados (ex: "Sofá de 3 lugares", "Poltrona", "Mesa de centro").
    *   Descrições curtas para cada móvel (estilo, cor, material).
    *   Bounding Boxes (bbox) em coordenadas relativas para cada móvel identificado.
*   **Refinamento de Prompt:** O prompt enviado ao GPT-4o Vision foi iterativamente refinado para melhorar a precisão na classificação dos tipos de móveis (ex: distinção entre cadeira e poltrona) e para solicitar o formato específico da `bbox`.

### 2.2. Busca e Sugestão de Produtos do Catálogo
*   **Busca Textual (FTS - Full-Text Search):**
    *   Implementada uma busca textual no banco de dados de produtos (`products`) utilizando `tsvector` do PostgreSQL.
    *   A busca usa o nome e a descrição do móvel detectado pela IA de Visão.
    *   Inclui uma estratégia de fallback para queries com operador `OR` caso a busca inicial mais específica não retorne resultados suficientes.
*   **Busca por Similaridade Visual (Embeddings CLIP):**
    *   **Embeddings de Produtos do Catálogo:**
        *   Uma coluna `clipEmbedding` (vetor de 512 dimensões) foi adicionada à tabela `products`.
        *   Um script (`scripts/generate-product-embeddings.ts`) foi criado e executado para gerar embeddings CLIP (usando o modelo local `Xenova/clip-vit-base-patch32`) para todas as imagens de produtos no catálogo e popular esta coluna.
    *   **Extração de Região de Interesse (ROI) da Imagem do Cliente:**
        *   **Abordagem Atual (Fallback):** A `bbox` (retangular) retornada pelo GPT-4o Vision para cada objeto detectado é usada para recortar a ROI da imagem original do cliente.
        *   **Tentativa com Segment Anything Model (SAM):** Houve uma tentativa extensa de integrar o SAM (via API do Replicate, modelos `yyjim/segment-anything-tryout` e `schananas/grounded_sam`) para obter máscaras de segmentação precisas para a ROI. No entanto, esta integração está atualmente bloqueada devido a erros 422 (Unprocessable Entity) e 404 (Not Found) persistentes da API do Replicate, indicando problemas de versão, permissão ou endpoint do modelo. Esta frente de trabalho está temporariamente pausada.
    *   **Geração de Embedding CLIP para a ROI:** Um embedding CLIP é gerado para a ROI extraída (atualmente, da `bbox`).
    *   **Busca Vetorial:** O embedding da ROI é comparado com os `clipEmbedding` dos produtos no catálogo usando o operador de distância L2 (`<->`) do `pgvector` para encontrar os produtos visualmente mais similares.

### 2.3. Combinação de Scores e Apresentação das Sugestões
*   **Cálculo de Scores:**
    *   `textScore`: Derivado da relevância retornada pela FTS.
    *   `visualScore`: Derivado da similaridade do embedding CLIP (1 / (1 + distância L2)).
*   **Score Combinado:** Um `combinedScore` é calculado para cada produto candidato, utilizando pesos para os scores textual e visual.
    *   **Priorização Visual:** Atualmente, os pesos estão configurados para dar forte prioridade ao `visualScore` (`visualWeight = 0.99`, `textWeight = 0.01`) conforme solicitado pelo usuário para focar na fidelidade visual.
*   **Filtragem:** As sugestões são filtradas por:
    *   Um limiar mínimo para o `visualScore` (atualmente `0.135`) para garantir uma relevância visual básica.
    *   Um limiar mínimo para o `combinedScore` (atualmente `0.10`).
    *   Correspondência de categoria entre o item detectado e a categoria do produto.
*   **Apresentação na UI:**
    *   Os nomes corretos dos itens detectados (ex: "Mesa de jantar") são exibidos na UI.
    *   As sugestões de produtos, com imagem e nome, são exibidas.
    *   O backend formata até 3 das melhores sugestões para serem exibidas no chat, embora a UI atualmente pareça renderizar apenas a primeira sugestão principal.

### 2.4. Infraestrutura de Backend e Armazenamento de Dados
*   **Tabelas do Banco de Dados:**
    *   `design_projects`: Armazena informações sobre cada projeto de design iniciado pelo usuário.
    *   `design_project_items`: Armazena detalhes de cada objeto detectado pela IA dentro de um projeto, incluindo o nome, descrição, `bbox`, e os IDs e scores dos produtos sugeridos.
    *   `ai_design_chat_messages`: Armazena o histórico de conversas do chat para cada projeto.
*   **API Endpoints:**
    *   Implementadas rotas para criar e buscar projetos de design, fazer upload de imagens, e gerenciar mensagens de chat.
    *   A rota `PUT /api/ai-design-projects/:projectId/items/:itemId` e a função `storage.updateDesignProjectItem` existem e estão prontas para permitir que o usuário salve suas seleções/ajustes para os itens.
*   **WebSockets:** Integrado para atualizações em tempo real do status do processamento na interface do usuário.

## 3. Estrutura do Banco de Dados (Tabelas Chave para Design com IA)

A funcionalidade de Design com IA interage primariamente com as seguintes tabelas:

*   **`users`**: Tabela padrão de usuários.
    *   `id`, `email`, `name`, etc.
*   **`products`**: Catálogo de produtos da empresa.
    *   `id`, `userId`, `name`, `description`, `category`, `imageUrl`
    *   `embedding vector(1536)`: Para embeddings textuais (OpenAI).
    *   `clipEmbedding vector(512)`: Para embeddings visuais (CLIP).
    *   `search_tsv tsvector`: Para a busca textual FTS.
*   **`design_projects`**: Armazena cada novo projeto de design com IA.
    *   `id`, `userId`, `name` (do projeto), `status` (new, processing, awaiting_selection, completed, error), `clientRenderImageUrl`, `generatedRenderUrl`, `createdAt`, `updatedAt`.
*   **`design_project_items`**: Detalhes de cada móvel/objeto identificado pela IA em um `design_project`.
    *   `id`, `designProjectId` (FK para `design_projects.id`)
    *   `detectedObjectName: text` (Nome do objeto, ex: "Sofá")
    *   `detectedObjectDescription: text` (Descrição da IA)
    *   `detectedObjectBoundingBox: jsonb` (Coordenadas x_min, y_min, x_max, y_max)
    *   `suggestedProductId1: integer` (FK para `products.id`)
    *   `matchScore1: real`
    *   `suggestedProductId2: integer` (FK para `products.id`)
    *   `matchScore2: real`
    *   `suggestedProductId3: integer` (FK para `products.id`)
    *   `matchScore3: real`
    *   `selectedProductId: integer` (FK para `products.id` - Produto escolhido pelo usuário)
    *   `userFeedback: text` (Feedback do usuário sobre a sugestão/item)
    *   `generatedInpaintedImageUrl: text` (Para o render final com o produto substituído)
    *   `createdAt`, `updatedAt`.
*   **`ai_design_chat_messages`**: Mensagens trocadas no chat do projeto de design.
    *   `id`, `projectId` (FK para `design_projects.id`), `role` (user/assistant), `content`, `attachmentUrl`, `createdAt`.

*(Nota: Alguns campos podem ter sido adicionados/ajustados e esta lista reflete o entendimento atual).*

## 4. Situação Atual do Projeto (Funcionalidade Design com IA)

### 4.1. Funcionando Bem:
*   **Análise Inicial da Imagem:** O GPT-4o Vision está identificando objetos, suas descrições e bounding boxes de forma consistente (após a troca da imagem que causava recusa).
*   **Persistência de Dados:** Os nomes e `bbox` dos objetos detectados estão sendo corretamente salvos nos `DesignProjectItems`.
*   **Busca de Sugestões (Fallback):** O sistema de busca combinada (FTS + CLIP visual da `bbox`) está operacional e gerando sugestões que o usuário avaliou como "muito boas" no último teste.
*   **Priorização Visual:** A lógica de dar peso maior ao score visual está implementada.
*   **Exibição de Nomes Corretos:** A UI agora mostra os nomes corretos dos itens detectados.
*   **Fluxo de Backend Geral:** O processamento da imagem, criação de itens e envio de atualizações via WebSocket estão funcionando.

### 4.2. Pontos de Atenção e Desafios Atuais:
*   **Integração com Segment Anything Model (SAM):**
    *   **Problema:** A chamada à API do Replicate para o modelo `schananas/grounded_sam` (com ou sem hash de versão, usando `mask_prompt`) continua resultando em erro 422 ("Invalid version or not permitted").
    *   **Impacto:** Impede o uso de máscaras de segmentação precisas para a ROI, forçando o uso da `bbox` retangular, que é menos ideal para a extração de características visuais pelo CLIP.
    *   **Status:** Investigação pausada temporariamente para focar em melhorias com o sistema atual.
*   **Qualidade da ROI (Baseada na BBox):** Como consequência do problema com o SAM, a qualidade da ROI depende da precisão da `bbox` fornecida pelo GPT-4o. Embora geralmente boa, uma `bbox` menos precisa pode levar a embeddings CLIP menos representativos e, por sua vez, a sugestões visuais não ótimas.
*   **Exibição de Múltiplas Sugestões na UI:** O backend prepara até 3 sugestões formatadas por item, mas a interface do usuário (frontend) atualmente parece exibir apenas a primeira sugestão principal.

## 5. Próximos Passos e Funcionalidades Pendentes

Com base no `PROJECT_PLAN.md` e na nossa discussão, os próximos passos sugeridos são:

### 5.1. Prioridade Imediata (Frontend):
*   **Exibir Múltiplas Sugestões na UI:**
    *   **Tarefa:** Modificar o componente frontend (`client/src/pages/design-ai-project.tsx` e/ou subcomponentes) para renderizar até 3 das sugestões de produtos para cada item detectado.
    *   **Detalhe:** O backend já formata essas sugestões no `chatResponseContent`. O frontend pode parsear isso ou, idealmente, usar o estado atualizado dos `DesignProjectItems` (que contêm `suggestedProductId1/2/3`) para mostrar as opções.

### 5.2. Próxima Grande Funcionalidade (Backend + Frontend):
*   **Implementar UI para Ajuste e Seleção de Sugestões:**
    *   **Tarefa Principal:** `- [ ] Implementar UI para o usuário ver e ajustar as sugestões de DesignProjectItems (geradas pela IA).`
    *   **Backend:** A rota `PUT /api/ai-design-projects/:projectId/items/:itemId` e a função `storage.updateDesignProjectItem` já estão prontas para receber o `selectedProductId` e outros ajustes.
    *   **Frontend:**
        *   Permitir que o usuário clique em um botão "Selecionar" ao lado de uma das sugestões exibidas.
        *   Ao selecionar, o frontend deve chamar a API `PUT` para atualizar o `DesignProjectItem` correspondente com o `selectedProductId`.
        *   Considerar feedback visual na UI após a seleção.

### 5.3. Melhorias Contínuas e Outras Funcionalidades (Pós-UI de Seleção):
*   **Aumentar o Número de Sugestões Salvas/Exibidas (Opcional):**
    *   Se desejado, aumentar o número de sugestões que `findSuggestionsForItem` retorna (além de 5) e que `formatSuggestionsForChatItem` processa (além de 3).
    *   Isso exigiria possivelmente adicionar mais campos `suggestedProductIdN` e `matchScoreN` à tabela `design_project_items` ou armazenar as sugestões como um array JSON. (Considerar complexidade vs. benefício).
*   **Revisitar Integração SAM:** Periodicamente, verificar se há novos modelos SAM no Replicate, atualizações na documentação da API ou se o erro 422 pode ser resolvido. Uma segmentação precisa ainda é o ideal para a ROI.
*   **Refinar Qualidade do Render Final com Inpainting:** (Conforme `PROJECT_PLAN.md`)
*   **Integrar com "Gerar Orçamento" e "Criar Moodboard":** (Conforme `PROJECT_PLAN.md`)
*   **Melhorar Robustez da Busca Textual (FTS):** (Conforme `PROJECT_PLAN.md`)

Este documento deve fornecer uma boa base para sua equipe continuar o excelente trabalho no Ald-a! 