# Estado Atual, Desafios e Próximos Passos do Projeto Ald-a (Foco: Design com IA)

**Data da Última Atualização:** 16 de Maio de 2025

## 1. Visão Geral do Projeto Ald-a

O Ald-a é um sistema web robusto projetado para auxiliar lojas de móveis, designers de interiores e arquitetos. Seu objetivo principal é otimizar o fluxo de trabalho, desde o gerenciamento de catálogos de produtos (com extração inteligente de dados de Excel, PDF, etc.) até a geração de orçamentos personalizados e materiais visuais como moodboards.

Funcionalidades principais já implementadas incluem:
*   Upload e processamento inteligente de catálogos.
*   Busca textual e visual (com embeddings) de produtos.
*   Geração de orçamentos em PDF.
*   Criação de Moodboards (com conteúdo textual gerado por IA).
*   Uma interface de chat inicial para interações de design com IA.

## 2. Foco Recente: Funcionalidade "Design com IA Avançado (Planta/Render)"

O desenvolvimento mais recente concentrou-se em uma funcionalidade avançada para permitir que os usuários transformem seus ambientes.

### 2.1. Objetivo Detalhado

O usuário envia uma imagem de um ambiente (planta baixa ou um render existente). O sistema, usando IA, deve:
1.  **Detectar** os móveis principais na imagem e suas localizações (bounding boxes).
2.  **Sugerir** produtos do catálogo da loja que sejam visual e/ou textualmente similares a cada móvel detectado.
3.  Permitir que o usuário **confirme ou altere** essas sugestões para cada objeto.
4.  **Gerar (Renderizar)** uma nova imagem do ambiente, substituindo os móveis originais pelos produtos selecionados do catálogo, de forma realista e integrada à cena (considerando perspectiva, iluminação, etc.).

### 2.2. Progresso Realizado nesta Funcionalidade (Atualizado em 16/05/2025)

**Backend (`server/`):**

*   **Análise de Imagem com GPT-4o Vision (`ai-design-processor.ts`):**
    *   Mantém-se a análise da imagem do cliente via GPT-4o para descrição geral e identificação de móveis com `name`, `description`, e `bounding_box`.
*   **Geração de Embedding Visual por Região do Objeto:**
    *   **Implementado:** Para cada objeto com `bounding_box`, a região é recortada com `sharp`, salva temporariamente, e um embedding CLIP é gerado para este recorte.
    *   Estes embeddings de região são usados para buscar produtos visualmente similares no catálogo via `storage.findProductsByEmbedding`.
*   **Sugestão de Produtos para `DesignProjectItem`:**
    *   Os `DesignProjectItem` agora são preenchidos prioritariamente com sugestões da busca visual por região. A busca textual serve como fallback.
*   **Rotas da API (`routes.ts`):**
    *   `POST /api/ai-design-projects`: Funcional para criar novos projetos.
    *   `GET /api/ai-design-projects`: Nova rota para listar todos os projetos de design do usuário.
    *   `GET /api/ai-design-projects/:projectId/items`: Busca os itens de um projeto.
    *   `GET /api/ai-design-projects/:projectId`: Busca detalhes de um projeto específico.
    *   `PUT /api/ai-design-projects/:projectId/items/:itemId`: Para o usuário selecionar/atualizar sugestões (precisa ser testada e integrada completamente com a lógica de inpainting).
    *   `POST /api/ai-design-projects/:projectId/initiate-image-analysis`: Funcional para upload de imagem e início da análise.
    *   `GET /api/products/batch`: Nova rota para buscar detalhes de múltiplos produtos por ID.
    *   Estrutura de rotas refatorada para modularidade com `ExpressRouter`.
*   **Serviço de Inpainting (Replicate):** A lógica de preparação de máscara e imagem "primed" em `performSingleInpaintingStep` foi mantida e refatorada para melhor escopo. A chamada ao Replicate acontece após a seleção do produto (fluxo a ser completado).

**Frontend (`client/`):**

*   **Página de Listagem de Projetos (`design-ai.tsx`):**
    *   Agora busca e exibe a lista real de projetos do usuário.
    *   Permite a criação de novos projetos através de um modal, chamando a API real.
*   **Página de Detalhe do Projeto (`design-ai-project.tsx`):**
    *   Busca e exibe os detalhes de um projeto, incluindo a imagem carregada e os itens detectados pela IA.
    *   Implementado `useEffect` para buscar os detalhes dos produtos sugeridos (usando a nova rota batch) e popular a UI.
    *   Botão de upload de imagem funcional (usando `useRef`).
    *   Lógica de seleção de produto (`selectProductMutation`) e geração de render final (`generateRenderMutation`) estruturadas, mas o fluxo completo de interação e visualização do inpainting/render final precisa ser testado e refinado.

**Infraestrutura e Correções Gerais:**

*   **Sincronização com GitHub:** Estabelecido fluxo de versionamento.
*   **Bugs Críticos Resolvidos:** Problemas de login, criação de projeto (payload `title` vs `name`), e funcionalidade do botão de upload foram corrigidos.

## 3. Problemas Atuais e Pontos de Atenção (16/05/2025)

1.  **Erro "ID Inválido" na Rota `/api/products/batch` (Backend/Sincronização):**
    *   **Problema:** O frontend recebe um erro 400 "ID Inválido" ao tentar buscar detalhes de produtos em batch. Os logs do servidor não indicam que a versão mais recente de `server/routes.ts` (com logs de depuração para esta rota) está sendo executada no Replit.
    *   **Ação Imediata:** Garantir que o Replit execute a última versão de `server/routes.ts` (puxando do GitHub ou atualizando manualmente no editor web do Replit). Testar novamente e analisar os logs do servidor para diagnosticar como o parâmetro `ids` está sendo recebido e processado.

2.  **Qualidade e Exibição das Sugestões de Produto:**
    *   Apesar da busca visual por região estar implementada, a qualidade do filtro por nome/categoria aplicado aos resultados visuais pode precisar de ajustes.
    *   A busca textual (fallback) raramente retorna resultados úteis e precisa ser melhorada ou substituída por uma busca semântica mais robusta.
    *   O cálculo e a exibição do `matchScore` precisam ser refinados.

3.  **Interface do Usuário (UI) para Sugestões:**
    *   Garantir que, após a correção do item 1, os detalhes dos produtos sugeridos (nome, imagem do produto, etc.) sejam corretamente exibidos na lista de "Móveis Identificados e Sugestões".

4.  **Itens de `TAREFAS_PONTOS_ATENCAO_ALDA.md` (Revisão Pendente):**
    *   Refinamento da lógica de criação da imagem "primed" e tratamento de transparência (Seção II.2).
    *   Testes de ponta-a-ponta completos do fluxo de inpainting e render final (Seção V).
    *   Implementação das melhorias da Seção VI (limpeza de `generatedInpaintedImageUrl`, feedback de progresso granular, etc.).

5.  **Débitos Técnicos de `server/storage.ts`:**
    *   Conforme mencionado no `RESUMO_DESENVOLVIMENTO_ALDA.md`, ainda podem existir erros de tipo Drizzle que precisam ser investigados e corrigidos para garantir a robustez total das operações de banco de dados.

## 4. Próximos Passos de Desenvolvimento Sugeridos

1.  **Estabilização da Busca de Detalhes de Produtos (Prioridade Alta):**
    *   Resolver o erro "ID Inválido" na rota `/api/products/batch`, garantindo que o Replit execute o código mais recente.
    *   Confirmar que as sugestões de produtos (com nome e imagem) aparecem corretamente na UI da página do projeto.

2.  **Teste e Refinamento do Fluxo de Seleção e Inpainting Individual:**
    *   Permitir que o usuário selecione uma das sugestões para um item.
    *   Garantir que `updateDesignProjectItem` seja chamado corretamente para salvar `selectedProductId`.
    *   Verificar se `triggerInpaintingForItem` é chamado e se a `generatedInpaintedImageUrl` é gerada e exibida.

3.  **Implementar Geração do Render Final:**
    *   Conectar o botão "Gerar Render Final" à `generateRenderMutation`.
    *   Testar a função `generateFinalRenderForProject` no backend, que aplica inpainting iterativamente.
    *   Exibir a `generatedRenderUrl` final.

4.  **Aprimorar Qualidade das Sugestões (Iterativo):**
    *   **Filtro da Busca Visual por Região:** Melhorar o critério de filtro após a busca por embedding da região (além de nome/categoria, talvez usar atributos textuais básicos).
    *   **Extração de Atributos (IA):** Implementar a extração de atributos (cor, tipo, estilo) da descrição textual fornecida pelo GPT-4o para cada item detectado. Usar esses atributos para refinar as buscas no catálogo.
    *   **Melhorar Busca Textual:** Se mantida, explorar técnicas de busca textual mais flexíveis (ex: full-text search do PostgreSQL, ou extração de keywords).

5.  **Histórico de Chat do Projeto:**
    *   Implementar a exibição das `AiDesignChatMessage` na página do projeto para fornecer contexto e registrar as interações e sugestões da IA.

6.  **Revisar e Abordar Itens Pendentes de `TAREFAS_PONTOS_ATENCAO_ALDA.md` e `PROJECT_PLAN.md`.**

## 5. Banco de Dados Neon (Contexto para a Equipe)

O projeto utiliza um banco de dados PostgreSQL hospedado no Neon. A estrutura das tabelas é definida usando Drizzle ORM no arquivo `shared/schema.ts`. As principais tabelas envolvidas nesta funcionalidade são:
*   `users`
*   `products`
*   `designProjects` (para os projetos de design com IA)
*   `designProjectItems` (para cada objeto detectado/sugerido dentro de um projeto)
*   `floorPlans` (se o input for uma planta baixa específica associada a um projeto de design)

A imagem da estrutura do banco de dados (fornecida pelo usuário anteriormente) deve ser consultada para referência visual das colunas e relações.

---

Este documento visa orientar a equipe na retomada do desenvolvimento, com foco na estabilização do backend e na conclusão do fluxo de renderização com IA. 