# Changelog - 16 de Maio de 2025

Este documento resume as principais alterações, melhorias e correções realizadas no projeto Ald-a nesta data.

## Sessão de 16/05/2025

**Foco Principal:** Estabilização do fluxo de "Design com IA", correção de bugs críticos de frontend/backend e melhoria da robustez das sugestões de produtos.

**Novas Funcionalidades e Melhorias:**

1.  **Criação de Projetos de Design AI (Frontend):**
    *   Implementado modal e formulário para criação de novos projetos de design AI na página `/design-ai`.
    *   Conectada a funcionalidade ao endpoint real do backend (`POST /api/ai-design-projects`).
    *   Adicionado feedback ao usuário (toasts) e redirecionamento para a página do projeto recém-criado.
    *   Arquivos afetados: `client/src/pages/design-ai.tsx`, `client/src/lib/apiClient.ts`.

2.  **Listagem Real de Projetos de Design AI (Frontend):**
    *   A página `/design-ai` agora busca e exibe a lista de projetos de design reais do usuário logado, utilizando o endpoint `GET /api/ai-design-projects`.
    *   Removida a listagem mockada.
    *   Melhorada a exibição dos cards de projeto para incluir thumbnail (se disponível) e data de criação.
    *   Arquivos afetados: `client/src/pages/design-ai.tsx`, `client/src/lib/apiClient.ts`, `server/routes.ts`.

3.  **Busca Visual por Região do Objeto (Backend):**
    *   Refatorada a função `processDesignProjectImage` (`server/ai-design-processor.ts`) para:
        *   Se uma `bounding_box` for fornecida pela IA para um objeto detectado, recortar essa região da imagem original usando `sharp`.
        *   Salvar o recorte como arquivo temporário.
        *   Gerar um embedding CLIP para o recorte.
        *   Buscar produtos no catálogo por similaridade visual com o embedding da região (`storage.findProductsByEmbedding`).
        *   Filtrar os resultados por nome/categoria do objeto detectado.
        *   Usar esses resultados como sugestões prioritárias para o `DesignProjectItem`.
        *   A busca textual agora serve como fallback.
    *   Adicionados logs detalhados para depuração desse fluxo.

4.  **Busca de Detalhes de Produtos em Batch (Backend e Frontend):**
    *   Adicionada rota `GET /api/products/batch` no backend para buscar detalhes de múltiplos produtos por seus IDs, utilizando `storage.getProductsDetails`.
    *   Adicionada função `getProductsDetailsApi` em `client/src/lib/apiClient.ts`.
    *   A página `client/src/pages/design-ai-project.tsx` agora usa `getProductsDetailsApi` para buscar os detalhes dos produtos sugeridos e exibi-los na UI.

5.  **Sincronização com GitHub:**
    *   Configurado o projeto para usar um repositório GitHub como fonte da verdade para o código.
    *   Estabelecido fluxo de commit e push para o GitHub, seguido de pull no Replit para garantir sincronia.

**Correções de Bugs Críticos:**

1.  **Erro de Login ("Falha ao processar resposta JSON"):**
    *   Corrigido o problema onde as chamadas de API de autenticação no frontend (`/api/login`, `/api/register`, `/api/user`) estavam incorretas.
    *   As URLs foram atualizadas para `/api/auth/login`, `/api/auth/register`, `/api/auth/me` para corresponder às rotas do backend.
    *   Resolvido o problema de o fallback do Vite interceptar essas chamadas.
    *   Arquivos afetados: `client/src/lib/auth.tsx`.

2.  **Erro na Criação de Projeto ("Nome do projeto é obrigatório"):**
    *   Corrigido o payload enviado pelo frontend ao criar um novo projeto de design. O backend esperava a chave `name`, mas o frontend (em uma versão anterior dos arquivos no Replit) enviava `title`.
    *   Garantido que `client/src/pages/design-ai.tsx` e `client/src/lib/apiClient.ts` enviam `{ name: "..." }`.
    *   Arquivos afetados: `client/src/pages/design-ai.tsx`, `client/src/lib/apiClient.ts`.

3.  **Botão de Upload de Imagem Não Funcional:**
    *   Corrigida a lógica do botão "Carregar Imagem Base" em `client/src/pages/design-ai-project.tsx`.
    *   Implementado o uso de `useRef` para acionar programaticamente o clique no input de arquivo escondido, garantindo que o seletor de arquivos seja aberto.
    *   Arquivos afetados: `client/src/pages/design-ai-project.tsx`.

4.  **Estrutura de Rotas do Backend (`server/routes.ts`):**
    *   Refatorada a função `registerRoutes` para aceitar um `ExpressRouter` e o middleware de `upload`.
    *   Removidos os prefixos `/api` das definições de rota internas, permitindo que o prefixo seja aplicado corretamente em `server/index.ts` (`app.use('/api', apiRouter)`).
    *   Isso resolveu o problema de duplicação de prefixo (ex: `/api/api/auth/login`) e garantiu que as rotas corretas fossem chamadas.

**Pontos de Atenção e Próximos Passos Imediatos (Depuração):**

*   **Erro "ID Inválido" na Rota `/api/products/batch`:**
    *   Ainda ocorre um erro 400 Bad Request ("ID Inválido") quando o frontend tenta buscar detalhes de produtos em batch.
    *   **Suspeita:** O ambiente Replit pode não estar executando a versão mais recente de `server/routes.ts` que contém os logs de depuração para esta rota.
    *   **Ação:** Garantir que o `server/routes.ts` no Replit (via editor web ou pull do GitHub) esteja atualizado com os logs e retestar, observando os logs do servidor para entender como `idsString` está sendo recebido e parseado. 