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
  - [x] Definir e aplicar schema do banco de dados (storage) (`designProjects`, `designProjectItems`, coluna `embedding` e `search_tsv` em `products`, `aiDesignChatMessages` referenciando `designProjects`).
  - [x] Implementar métodos de storage (`get/create/update/deleteDesignProject`, `get/createDesignProjectItems`, `findRelevantProducts` - agora com FTS, `createAiDesignChatMessage`, `getAiDesignChatMessages`).
  - [x] Implementar rotas API (`POST /api/ai-design-projects`, `GET /api/ai-design-projects/:id`).
  - [x] Implementar rota `POST /api/ai-design-projects/:id/upload-render`.
  - [x] Implementar rota `POST /api/ai-design-projects/:id/attachments` (para anexos de chat).
  - [x] Implementar rotas `GET` e `POST` para `/api/ai-design-projects/:id/messages` (para chat).
  - [ ] Implementar rota `PUT /api/ai-design-projects/:id/items/:itemId` - **Parcialmente implementada** (rota existe, `storage.updateDesignProjectItem` precisa ser criado/corrigido).
- [x] Implementar lógica de busca por similaridade visual (embeddings).
  - [x] Criar script `scripts/generate-product-embeddings.ts`.
  - [x] Popular coluna `embedding` nos produtos - **CONCLUÍDO!** Script depurado e executado com sucesso para todos os produtos.
  - [x] Implementar função `storage.findProductsByEmbedding(userId, imageEmbeddingVector, limit)` - **Implementada em `server/storage.ts`.**
  - [x] Integrar busca por embedding no `ai-design-processor.ts` (busca visual global e por região).
- [-] Implementar frontend para interface de Design com IA.
  - [x] Criar página de listagem (`design-ai.tsx`) com busca mock.
  - [x] Criar página do projeto (`design-ai-project.tsx`) com dados mock, upload simulado e seleção simulada.
  - [x] Chat funcional (`ai-design-chat.tsx`) com envio de texto e anexos de imagem.
  - [x] Resposta da IA no chat com sugestões de produtos (incluindo imagens dos produtos sugeridos renderizadas via Markdown) e lógica de foco no pedido do usuário.
  - [x] Conectar frontend às rotas reais do backend (quando disponíveis) - **Em progresso, a maioria conectada e funcional.**
  - [x] Implementar busca de detalhes dos produtos sugeridos na UI. **(Erro 400 - ID Inválido resolvido)**
  - [ ] Implementar UI para o usuário ver e ajustar as sugestões de `DesignProjectItems` (geradas pela IA).
  - [ ] **Novo:** Integrar funcionalidade de "Gerar Orçamento" para produtos selecionados na UI de Design com IA.
  - [ ] **Novo:** Integrar funcionalidade de "Criar Moodboard" para produtos selecionados na UI de Design com IA.
- [x] Implementar lógica de processamento de IA (`ai-design-processor.ts`):
  - [x] Análise de imagem (OpenAI GPT-4o Vision) para identificar móveis e suas descrições.
  - [x] Busca textual de produtos (`storage.findRelevantProducts` - **agora usa FTS com `ts_vector` e fallback OR**).
  - [x] Criação de `DesignProjectItems` com sugestões baseadas na busca textual e visual.
  - [x] Geração de embeddings para as descrições dos móveis detectados (via OpenAI `text-embedding-3-small`).
  - [x] Chamada inicial para `storage.findProductsByEmbedding` usando os embeddings das descrições.
  - [x] Feedback no chat para o usuário com as sugestões (incluindo imagens e foco no pedido do usuário).
  - [x] **Refinada lógica de combinação de sugestões (visual regional filtrada, visual global filtrada, FTS filtrada, fallback visual não filtrado com checagem de categoria).**
- [ ] Integrar com APIs de IA para geração de planta baixa/render (escopo futuro).
- [x] Aperfeiçoar a busca por similaridade visual de produtos a partir de imagens enviadas pelo usuário, integrando embedding visual real (CLIP/HuggingFace) ao fluxo de sugestão.
- [ ] **Novo:** Refinar qualidade e precisão do Render Final com IA (inpainting).
  - [ ] Investigar e corrigir o "esticamento" da imagem.
  - [ ] Melhorar o prompt enviado ao Replicate para o inpainting.
  - [ ] Avaliar a qualidade do inpainting para BBoxes de diferentes tamanhos.
- [x] **Novo:** Melhorar precisão da IA de Visão (GPT-4o) na identificação de tipos de móveis (ex: Cadeira vs. Poltrona) e na qualidade das Bounding Boxes.
  - [x] Refinar prompt do GPT-4o.
- [ ] **Novo:** Melhorar robustez e relevância da Busca Textual FTS.
  - [ ] Diagnosticar por que ainda falha para alguns termos.
  - [x] Refinar tokenização e estratégia de query no `storage.searchProducts`.

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

## Próximos Passos Imediatos (Revisado para 17 de Maio de 2025)

1.  **Refinar Precisão da Busca Textual FTS:**
    *   **Objetivo:** Garantir que a FTS retorne resultados relevantes consistentemente.
    *   **Ação:** Diagnosticar falhas atuais da FTS (quando retorna 0 resultados), analisar conteúdo dos `tsvector`s e refinar a construção da query em `storage.searchProducts`.

2.  **Melhorar Qualidade e Precisão da IA de Visão (GPT-4o):**
    *   **Objetivo:** Reduzir erros de classificação de móveis e obter Bounding Boxes mais úteis.
    *   **Ação:** Experimentar com o prompt enviado ao GPT-4o em `ai-design-processor.ts`.

3.  **Aperfeiçoar o Render Final com Inpainting:**
    *   **Objetivo:** Obter um render final que aplique as substituições de produtos de forma clara e visualmente correta.
    *   **Ação:** Investigar o "esticamento" da imagem, analisar os parâmetros enviados ao Replicate, e avaliar a qualidade do inpainting especialmente para BBoxes menores (agora que a restrição foi removida).

4.  **Implementar Funcionalidade de `storage.updateDesignProjectItem` e Rota PUT correspondente:**
    *   Permitir que o usuário interaja com as sugestões (aceitar/rejeitar/adicionar notas).

5.  **Resolver Problemas de Tipo do Drizzle (`storage.ts`):** (Movido para Bugs Conhecidos, mas ainda importante)
    *   Investigar e corrigir os erros "No overload matches this call".

---
*Última atualização: 17 de Maio de 2025* 