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
- [-] Implementar backend (rotas, storage) para Projetos de Design.
  - [x] Definir e aplicar schema do banco de dados (storage) (`designProjects`, `designProjectItems`, coluna `embedding` em `products`).
  - [x] Implementar métodos de storage (`get/create/update/deleteDesignProject`, `get/createDesignProjectItems`, `findRelevantProducts`).
  - [-] Implementar rotas API (`POST /design-projects`, `GET /design-projects/:id`) - **BLOQUEADO** (Instabilidade em `server/routes.ts`).
  - [ ] Implementar rota `POST /design-projects/:id/upload-render` - **BLOQUEADO**.
  - [ ] Implementar rota `PUT /design-projects/:id/items/:itemId` - **BLOQUEADO**.
- [ ] Implementar lógica de busca por similaridade visual (embeddings).
  - [x] Criar script `scripts/generate-product-embeddings.ts`.
  - [-] Popular coluna `embedding` nos produtos - **BLOQUEADO** (Erro na execução do script).
  - [ ] Implementar função `storage.findProductsByEmbedding`.
  - [ ] Integrar busca por embedding no `ai-design-processor.ts`.
- [-] Implementar frontend para interface de Design com IA.
  - [x] Criar página de listagem (`design-ai.tsx`) com busca mock.
  - [x] Criar página do projeto (`design-ai-project.tsx`) com dados mock, upload simulado e seleção simulada.
  - [ ] Conectar frontend às rotas reais do backend (quando disponíveis).
  - [ ] Implementar busca de detalhes dos produtos sugeridos.
- [x] Implementar lógica inicial de processamento de IA (`ai-design-processor.ts`) - análise de imagem e busca textual.
- [ ] Integrar com APIs de IA para geração de planta baixa/render (escopo futuro).

## Bugs Conhecidos / Impedimentos Atuais

- [ ] **Instabilidade `server/routes.ts`:** Falhas recorrentes ao tentar editar o arquivo para adicionar/modificar rotas. Causa erros de sintaxe ou edições não aplicadas. Impede a criação das rotas API para Design com IA.
- [ ] **Erros de Tipo Drizzle (`storage.ts`):** Métodos `create/update` para `products`, `quotes`, `moodboards` apresentam erros "No overload matches this call" relacionados a tipos JSON/array. Métodos temporariamente comentados, quebrando funcionalidades existentes.
- [ ] **Falha na Execução do Script de Embeddings:** O script `scripts/generate-product-embeddings.ts` falha ao executar via `tsx` ou `tsc`/`node` no ambiente Replit (Exit Code 1 sem output), impedindo a geração de embeddings necessários para a busca visual.
- [ ] Linter errors persistentes em `ai-design-processor.ts` relacionados ao acesso `.text` na API do Anthropic.
- [ ] Linter error persistente em `App.tsx` sobre a prop `component` em `ProtectedRoute` (provavelmente falso positivo).

## Bugs Corrigidos Recentemente (Sessão YYYY-MM-DD)

- [x] Erro `TypeError: response.text is not a function` ao excluir catálogo (corrigido em `client/src/lib/queryClient.ts`).
- [x] Duplicação da barra de busca e lista/grade de produtos no Dashboard (corrigido em `client/src/pages/dashboard.tsx`).
- [x] Erro de tipo `QuoteItem` (faltava `quantity`) no Dashboard (corrigido em `client/src/pages/dashboard.tsx`).

---
*Última atualização: [Data]* 