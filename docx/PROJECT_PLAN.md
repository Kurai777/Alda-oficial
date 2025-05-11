# Plano do Projeto Ald-a (Task Master)

Este documento rastreia as tarefas de desenvolvimento, bugs e melhorias para o projeto Ald-a. Use a sintaxe Markdown de lista de tarefas (`- [ ]` pendente, `- [x]` concluído).

Refira-se ao `README.md` para detalhes sobre as funcionalidades.

## Tarefas Gerais / Melhorias

- [x] Refinar tratamento de erros em todas as rotas da API.
- [ ] Adicionar mais testes automatizados (unitários, integração).
- [ ] Melhorar logs do servidor para depuração.
- [ ] Configurar CI/CD básico no Replit (se aplicável).

## Funcionalidade: Upload e Processamento de Catálogos

- [x] Implementar upload de arquivos Excel para S3.
- [x] Implementar processamento em background para Excel.
- [x] Implementar extração de dados Excel com IA (OpenAI).
- [x] Implementar extração de imagens de Excel (Python).
- [x] Implementar associação de imagens com IA Vision + Fallback.
- [ ] Implementar processamento para PDF (usando OCR/Visão IA).
- [ ] Implementar processamento para Imagens (usando Visão IA).
- [ ] Adicionar suporte para mais formatos de catálogo (CSV?).
- [ ] Melhorar tratamento de erros específicos de processamento (ex: Excel corrompido).
- [ ] Otimizar performance do processamento em background.
- [ ] Adicionar opção de reprocessar um catálogo falho.

## Funcionalidade: Enriquecimento com IA

- [x] Implementar serviço `ai-catalog-enhancer`.
- [x] Integrar enriquecimento opcional no fluxo de processamento do Excel.
- [x] Avaliar e refinar os prompts da IA para melhor qualidade de enriquecimento (foco em categoria, cores, materiais, dimensões).

## Funcionalidade: Visualização e Busca de Produtos

- [x] Criar Dashboard para exibir produtos.
- [x] Implementar busca textual no frontend.
- [x] Implementar filtros (categoria, preço, etc.) no frontend.
- [x] Corrigir busca de produtos por `catalogId`.
- [ ] Implementar paginação eficiente no backend (em vez de buscar tudo).
- [ ] Implementar funcionalidade completa da Busca Visual por IA (`VisualSearch.tsx`).
- [ ] Adicionar mais opções de ordenação.
- [ ] Melhorar performance da exibição de muitos produtos.

## Funcionalidade: Geração de Orçamentos

- [x] Criar interface para adicionar itens ao orçamento.
- [x] Implementar cálculo de totais e sub-totais.
- [x] Implementar geração de PDF básica (`pdf-lib`).
- [x] Adicionar logo e informações da empresa ao PDF.
- [x] Adicionar imagens dos produtos ao PDF.
- [x] Adicionar detalhes de pagamento/desconto/prazo ao PDF.
- [x] Corrigir layout e sobreposição no PDF.
- [x] Implementar salvamento do orçamento no banco de dados.
- [ ] Melhorar layout visual do PDF (fontes, cores, espaçamento).
- [ ] Permitir personalização do template PDF pelo usuário?
- [ ] Adicionar opção de enviar PDF por email.

## Funcionalidade: Gerenciamento de Perfil

- [x] Criar página de perfil.
- [x] Implementar formulário para editar dados da empresa.
- [x] Implementar upload de logo para S3.
- [x] Corrigir salvamento/exibição dos dados e logo no frontend.
- [ ] Adicionar opção de alterar senha.
- [ ] Adicionar mais opções de configuração da empresa.

## Funcionalidade: Moodboards

- [ ] Implementar backend (rotas, storage) para Moodboards.
- [ ] Implementar frontend para criação/visualização de Moodboards.
- [ ] Integrar produtos do catálogo na criação de Moodboards.

## Funcionalidade: Design com IA

- [x] Definir escopo e fluxo da funcionalidade (Análise de render, busca híbrida texto/visual, UI).
- [x] Implementar backend (rotas, storage) para Projetos de Design.
  - [x] Definir e aplicar schema do banco de dados (storage) (`designProjects`, `designProjectItems`, coluna `embedding` em `products`, `aiDesignChatMessages` referenciando `designProjects`).
  - [x] Implementar métodos de storage (`get/create/update/deleteDesignProject`, `get/createDesignProjectItems`, `findRelevantProducts`, `createAiDesignChatMessage`, `getAiDesignChatMessages`).
  - [x] Implementar rotas API (`POST /api/ai-design-projects`, `GET /api/ai-design-projects/:id`).
  - [x] Implementar rota `POST /api/ai-design-projects/:id/upload-render`.
  - [x] Implementar rota `POST /api/ai-design-projects/:id/attachments` (para anexos de chat).
  - [x] Implementar rotas `GET` e `POST` para `/api/ai-design-projects/:id/messages` (para chat).
  - [ ] Implementar rota `PUT /api/ai-design-projects/:id/items/:itemId` - **Parcialmente implementada** (rota existe, `storage.updateDesignProjectItem` precisa ser criado/corrigido).
- [x] Implementar lógica de busca por similaridade visual (embeddings).
  - [x] Criar script `scripts/generate-product-embeddings.ts`.
  - [x] Popular coluna `embedding` nos produtos - **CONCLUÍDO!** Script depurado e executado com sucesso para todos os produtos.
  - [ ] Implementar função `storage.findProductsByEmbedding(userId, imageEmbeddingVector, limit)` - **Implementada em `server/storage.ts` (usa embedding da descrição por enquanto, precisa de embedding da imagem).**
  - [ ] Integrar busca por embedding no `ai-design-processor.ts` - **Iniciado (usa embedding da descrição do móvel detectado). Próximo passo é usar embedding da imagem de input.**
- [-] Implementar frontend para interface de Design com IA.
  - [x] Criar página de listagem (`design-ai.tsx`) com busca mock.
  - [x] Criar página do projeto (`design-ai-project.tsx`) com dados mock, upload simulado e seleção simulada.
  - [x] Chat funcional (`ai-design-chat.tsx`) com envio de texto e anexos de imagem.
  - [x] Resposta da IA no chat com sugestões de produtos (incluindo imagens dos produtos sugeridos renderizadas via Markdown) e lógica de foco no pedido do usuário.
  - [ ] Conectar frontend às rotas reais do backend (quando disponíveis) - **Em progresso, a maioria conectada e funcional.**
  - [ ] Implementar busca de detalhes dos produtos sugeridos na UI.
  - [ ] Implementar UI para o usuário ver e ajustar as sugestões de `DesignProjectItems` (geradas pela IA).
- [x] Implementar lógica de processamento de IA (`ai-design-processor.ts`):
  - [x] Análise de imagem (OpenAI GPT-4o Vision) para identificar móveis e suas descrições.
  - [x] Busca textual de produtos (`storage.findRelevantProducts`).
  - [x] Criação de `DesignProjectItems` com sugestões baseadas na busca textual.
  - [x] Geração de embeddings para as descrições dos móveis detectados (via OpenAI `text-embedding-3-small`).
  - [x] Chamada inicial para `storage.findProductsByEmbedding` usando os embeddings das descrições.
  - [x] Feedback no chat para o usuário com as sugestões (incluindo imagens e foco no pedido do usuário).
- [ ] Integrar com APIs de IA para geração de planta baixa/render (escopo futuro).

## Bugs Conhecidos / Impedimentos Atuais

- [ ] **Erros de Tipo Drizzle (`storage.ts`):** Métodos `create/update` para `products`, `quotes`, `moodboards` apresentam erros "No overload matches this call" relacionados a tipos JSON/array. Métodos temporariamente comentados, quebrando funcionalidades existentes. **PRECISA SER INVESTIGADO.**
- [ ] Linter error persistente em `App.tsx` sobre a prop `component` em `ProtectedRoute` (provavelmente falso positivo).
- [ ] Falta de declarações de tipo para módulos `.js` (`s3-service.js`, `catalog-s3-manager.js`, etc.) - Causa `tsc` a falhar com Exit Code 1 se não ignorado. (Ignorados temporariamente com `// @ts-ignore` em `server/routes.ts` e `server/index.ts` onde aplicável).

## Bugs Corrigidos / Progresso da Sessão Atual (09 de Maio de 2025 - Exemplo)

- **Estabilidade do Servidor e Rotas:**
  - Resolvido erro `EADDRINUSE: address already in use 0.0.0.0:5000` comentando temporariamente o `WebSocketServer` manual em `server/index.ts` para evitar conflito com Vite.
  - Resolvida instabilidade ao editar `server/routes.ts`; rotas da API de "Design com IA" foram implementadas e corrigidas (`/api/ai-design-projects/...`).
- **Conexão com Banco de Dados e Schema:**
  - Corrigido erro `column "embedding" does not exist` na tabela `products`. Garantido que a `DATABASE_URL` correta do NeonDB (com a extensão `pgvector` habilitada) está sendo usada e que as queries em `server/storage.ts` selecionam a coluna `embedding`.
  - Corrigida a constraint de chave estrangeira em `ai_design_chat_messages.projectId` para referenciar corretamente `design_projects.id`.
  - Corrigida a sintaxe de input para vetores na função `storage.findProductsByEmbedding` (removidas aspas simples extras).
- **Funcionalidade de Design com IA (Chat e Análise):**
  - Criação de projetos de design via UI funcionando.
  - Upload de anexos (imagens) nas mensagens de chat funcionando e salvando no S3.
  - Envio de mensagens de texto e com anexos no chat funcionando.
  - A IA de Visão (OpenAI GPT-4o) agora é chamada para analisar a imagem anexada pelo usuário.
  - Produtos similares são buscados no catálogo (atualmente via busca textual e uma busca inicial por embedding da descrição do móvel detectado).
  - `DesignProjectItems` são criados para armazenar os móveis detectados e as sugestões.
  - O assistente de IA responde no chat com os móveis detectados e as sugestões de produtos, incluindo as imagens dos produtos sugeridos (renderizadas via `react-markdown`).
  - A resposta da IA no chat agora tenta focar no tipo de móvel que o usuário especificou em sua mensagem.
- **Script de Geração de Embeddings (`scripts/generate-product-embeddings.ts`):**
  - Script foi depurado e executado com sucesso, populando a coluna `embedding` para todos os produtos no banco de dados usando o modelo `text-embedding-3-small` da OpenAI.
- **Correções de Linter/Tipo Diversas:**
  - Resolvido erro `Property 'text' does not exist on type 'ContentBlock'` em `ai-design-processor.ts` (Anthropic SDK).
  - Corrigidos erros de tipo e referências em `server/routes.ts`, `server/ai-design-processor.ts` e `server/storage.ts` ao longo do desenvolvimento.

## Próximos Passos Imediatos

1.  **Implementar Busca por Similaridade Visual Real (Embedding da Imagem de Input):**
    *   **Objetivo:** Melhorar drasticamente a relevância das sugestões de produtos, comparando visualmente a imagem enviada pelo usuário com as imagens dos produtos do catálogo.
    *   **Em `server/ai-design-processor.ts` (função `processDesignProjectImage`):**
        *   Após a IA de Visão analisar a `imageUrlToProcess`, obter o embedding vetorial *desta imagem*. Isso pode exigir uma chamada a um modelo de embedding de imagem da OpenAI (ex: modelos multimodais como o próprio GPT-4o com inputs específicos ou APIs de embedding de imagem se disponíveis via SDK) ou um modelo de embedding de imagem de terceiros.
        *   Passar este `imageEmbeddingVector` para `await storage.findProductsByEmbedding(project.userId, imageEmbeddingVector)`. 
    *   **Em `server/storage.ts` (função `findProductsByEmbedding`):**
        *   Garantir que a função esteja otimizada para buscar usando o embedding da imagem (a estrutura atual já é um bom começo).
    *   **Em `server/ai-design-processor.ts` (função `processDesignProjectImage`):**
        *   Desenvolver uma estratégia para **combinar e priorizar** os resultados da busca textual (`relevantProductsTextual`) com os resultados da busca por embedding visual (`similarProductsFromEmbedding`). Por exemplo, dar mais peso aos matches visuais ou usar a busca textual como um primeiro filtro e depois refinar com a visual.
        *   Atualizar a criação dos `DesignProjectItem` e a mensagem de chat para usar essas sugestões combinadas/priorizadas.

2.  **Refinar Lógica de Foco e Resposta da IA:**
    *   Melhorar a extração de intenção/palavras-chave do texto do usuário em `processDesignProjectImage` (talvez com uma chamada a um LLM mais simples para parsear o pedido do usuário de forma estruturada).
    *   Ajustar o prompt da IA de Visão para, opcionalmente, focar em tipos específicos de móveis de forma mais eficaz se solicitado pelo usuário.
    *   Permitir que o usuário explicitamente peça para a IA analisar a "imagem toda" ou "outros itens" se o foco inicial não foi satisfatório.

3.  **Implementar Funcionalidade de `storage.updateDesignProjectItem`:**
    *   Criar o método `updateDesignProjectItem(itemId: number, data: Partial<DesignProjectItem>)` em `server/storage.ts` para permitir que o usuário modifique as sugestões (ex: aceitar um produto, rejeitar, adicionar notas).
    *   Descomentar e finalizar a lógica na rota `PUT /api/ai-design-projects/:projectId/items/:itemId` em `server/routes.ts`.
    *   No frontend (`ai-design-chat.tsx` ou um novo componente), implementar a UI para o usuário interagir com os `DesignProjectItems` e disparar essa atualização.

4.  **Resolver Problemas de Tipo do Drizzle (`storage.ts`):**
    *   Investigar e corrigir os erros "No overload matches this call" nos métodos `createProduct`, `updateProduct`, `createQuote`, `updateQuote`, `createMoodboard`, `updateMoodboard`.

5.  **Tratar Declarações de Tipo para Módulos `.js`:**
    *   Converter os arquivos `.js` problemáticos para `.ts` ou criar os arquivos de declaração `.d.ts` correspondentes para remover a necessidade dos comentários `// @ts-ignore`.

---
*Última atualização: [DATA_ATUAL]* 