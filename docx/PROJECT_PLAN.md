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

### Etapa 1: Upload Inteligente de Catálogos (Foco Atual)
- [x] Permitir upload de arquivo artístico (PDF/Imagem) e arquivo de preços (Excel/PDF) na UI e Backend (armazenar referências separadas).

- [-] Etapa 1.1: Implementar processamento robusto do Arquivo Artístico (PDF)
    - [x] Refinar prompt da IA (`extractProductsFromTextWithOpenAI` em `catalog-processor.ts`) para extrair detalhes técnicos das páginas de especificações.
    - [x] Implementar lógica em `catalog-processor.ts` para capturar nome do modelo de página "capa" e atribuir a especificações da página seguinte.
    - [ ] Extrair texto de todas as páginas do PDF via OCR (Google Cloud Vision API) - **Funcionando, mas precisa de refinamento para identificar blocos de texto por produto.**
    - [ ] **DESAFIO ATUAL:** Extrair imagens de produtos do PDF artístico.
        - Tentativa inicial com `pdf-export-images` não está extraindo imagens como esperado (imagens ausentes ou incorretas nos logs).
        - **PRÓXIMO PASSO:** Pesquisar e implementar alternativas mais robustas para extração de imagens de PDF, potencialmente utilizando bibliotecas Python (ex: PyMuPDF, OpenCV) ou serviços de IA mais avançados para segmentação de layout, conforme sugestão do roadmap.
    - [ ] Investigar e melhorar a extração de códigos de produto do PDF artístico (quando presentes e bem formatados) - **Pendente (aguardando catálogo de teste).**
    - [ ] (Roadmap Futuro) Usar IA para analisar o layout da página do PDF e identificar onde estão as imagens dos produtos e seus respectivos textos descritivos, para uma associação mais precisa.
    - [ ] (Roadmap Futuro Chave) Implementar associação inteligente das imagens PDF extraídas aos produtos corretos.
    - [ ] Aumentar `MAX_PAGES_TO_PROCESS_WITH_OPENAI` em `catalog-processor.ts` para permitir o processamento de mais páginas (ou de todo o catálogo PDF) após a qualidade da extração por página ser considerada satisfatória.

- [-] Etapa 1.2: Implementar processamento robusto do Arquivo de Preços (Planilha Excel)
    - [x] Refinar prompt da IA (`processPricingFile` em `pricing-file-processor.ts`) para extrair o nome completo da variação do produto (coluna "MODELO" da planilha) como `name`.
    - [x] Instruir a IA a extrair o "Nome do Modelo Base" (ex: "BORA" de "BORA C/ASSENTO 0,63") como um campo separado (`model_base`).
    - [x] Instruir a IA a extrair a "Descrição da Variação" (ex: "C/ASSENTO 0,63" ou da coluna "DESCRIÇÃO") como `variation_description`.
    - [x] Ajustar interfaces (`ExtractedPriceItem`, `AIPriceExtractionResponse`) e código de mapeamento para os novos campos (`model_base`, `variation_description`).
    - [x] Revisar e refinar a extração de `model_base` para casos complexos (ex: nomes com números romanos como "Chesterfield I") para garantir consistência.
    - [x] Implementar o processamento e armazenamento das `classDefinitions` (definições das classes de preço/tecido) que a IA já pode extrair da planilha.
    - [x] **NOVO:** Refinar o prompt da IA (`analyzeSheetStructureWithAI`) para extrair `classDefinitions` com detalhes aninhados (ex: "Cor 1: AMARELO", "Cor 2: AREIA") diretamente da análise estrutural da planilha, incluindo a detecção de tabelas de legenda/cores.

- [-] Etapa 1.3: Implementar Mecanismo de Mesclagem (Fusion Layer - `catalog-fusion-service.ts`)
    - [x] Manter match primário por código de produto (se disponível em ambas as fontes).
    - [x] Implementar fallback de match por nome, comparando `product.name` (do PDF) com `priceItem.model_base` (da planilha) para correspondência exata (após normalização).
    - [x] Implementar segundo nível de fallback por nome, usando similaridade de Dice (limiar 0.80) entre `product.name` (do PDF) e `priceItem.name` (nome completo da variação da planilha), caso o match por `model_base` falhe.
    - [x] Adicionar logs detalhados (`[FusionService Nome Check]`) para depurar as comparações de nomes.
    - [x] Investigar por que alguns produtos (ex: "Chesterfield I, II, X") ainda não recebem preços, analisando os logs de `model_base` e `name` extraídos da planilha e a lógica de similaridade.
    - [x] (Roadmap Futuro Chave) Refatorar a lógica de fusão e o schema do banco de dados para suportar a relação um-para-muitos: um produto base do PDF pode ter múltiplas variações de preço/tamanho da planilha. Isso envolve armazenar variações de produto (com suas dimensões e múltiplos `PriceInfo` por classe) de forma estruturada.
        - [x] **NOVO:** Criada tabela `product_variations` no schema (`shared/schema.ts`) com campos para `productId`, `name`, `variationDescription`, `dimensionsLabel`, `priceClasses` (jsonb), `sku`.
        - [x] **NOVO:** Implementados métodos `createProductVariation` e `getProductVariationsByProductId` em `server/storage.ts`.
        - [x] **NOVO:** Refatorado `catalog-fusion-service.ts` para criar registros em `product_variations` para cada variação de preço encontrada na planilha que corresponda a um produto do PDF.
        - [x] **NOVO:** Campo `classDefinitions` (jsonb) adicionado à tabela `catalogs` para armazenar as definições de classe extraídas pela IA.

- [x] Etapa 1.4: Garantir que o produto final no DB contenha informações consolidadas (imagem, descrição, PREÇO e suas variações).
    - [x] Atualmente, apenas o primeiro preço da primeira classe correspondente é salvo. A estrutura precisa suportar múltiplas variações e classes. **CONCLUÍDO com a introdução de `product_variations` e `classDefinitions`**
    - [x] **NOVO:** Backend agora armazena preços em CENTAVOS consistentemente.

- [ ] Implementar processamento para PDF (usando OCR/Visão IA). // Esta tarefa parece redundante com Etapa 1.1, será revisada/removida

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
- [x] **NOVO:** Implementar exibição de variações de produto e classes de preço nos cards de produto (`product-card.tsx`) e na página de detalhes do produto (`product-detail.tsx`).
    - [x] **NOVO:** Adicionados seletores (dropdowns) para variações e classes de preço.
    - [x] **NOVO:** Preço do produto atualiza dinamicamente com base na seleção de variação/classe.
    - [x] **NOVO:** Frontend busca e exibe as `classDefinitions` (cores, materiais) associadas a cada classe de preço.
    - [x] **NOVO:** Melhoria visual na página de detalhes do produto com bolinhas de cores interativas para `classDefinitions` que especificam cores, com tooltip mostrando o nome da cor.
    - [x] **NOVO:** Padronizada a formatação de preços (R$) em todo o frontend para exibir corretamente os valores armazenados em centavos.

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
- [ ] **NOVO:** Permitir seleção de variação de produto, classe de preço e cor/material ao adicionar/editar itens no orçamento.
- [ ] **NOVO:** Permitir adicionar o mesmo produto múltiplas vezes com configurações (variação, classe, cor) diferentes ao orçamento.

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
- [ ] **NOVO:** Investigar e corrigir erro de tipo em `storage.searchProducts` (função temporariamente desabilitada).
- [ ] **NOVO (Secundário):** Otimizar `server/pricing-file-processor.ts` para detectar com precisão a última linha com dados relevantes na planilha de preços, evitando o processamento de linhas vazias ou "fantasma" e chamadas desnecessárias à IA. (Ainda processando até a linha 411 em alguns testes, mesmo com planilha menor).

## Roadmap Futuro / Melhorias Avançadas

- [ ] **Pipeline Híbrido de Extração (IA + Algoritmo Avançado):** Implementar um fluxo de processamento de catálogos mais robusto e flexível, inspirado nas seguintes etapas:
    - **1. Pré-processamento Genérico:** Converter todas as entradas (PDFs, imagens) para um formato de imagem padronizado (ex: usando `pdf2image` ou IA Vision para detectar áreas de produto por página).
    - **2. Segmentação Inteligente do Layout:** Usar `layoutparser` (com modelos como YOLOv8 ou Detectron2, possivelmente fine-tuned) para detectar automaticamente blocos visuais de: Nome do modelo, Imagem do produto, Bloco de descrição técnica, Dimensões (tabela ou esquema), Preços (se houver).
    - **3. OCR Preciso dos Blocos de Texto:** Usar um motor de OCR robusto (ex: `PaddleOCR` com modo structure layout) nos blocos de texto identificados.
    - **4. Interpretação do Conteúdo com LLM:** Enviar os dados segmentados (texto OCR e referências de imagem) para um LLM (GPT-4o ou similar) com prompt estruturado para montar o JSON final do produto.
    - **5. Validação e Normalização:** Usar scripts com regras de negócio e, opcionalmente, IA Vision para confirmar a coerência dos dados extraídos e agrupar variações.

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
  - `