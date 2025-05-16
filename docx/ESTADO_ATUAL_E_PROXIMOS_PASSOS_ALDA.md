# Estado Atual, Desafios e Próximos Passos do Projeto Ald-a (Foco: Design com IA)

**Data da Última Atualização:** (Preencher com a data atual)

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

### 2.2. Progresso Realizado nesta Funcionalidade

**Backend (`server/`):**

*   **Análise de Imagem com GPT-4o Vision (`ai-design-processor.ts`):**
    *   A imagem do usuário é enviada ao GPT-4o Vision.
    *   O prompt foi elaborado para que a IA retorne uma descrição geral do ambiente e uma lista de `identified_furniture`, onde cada item deve conter: `name` (nome genérico), `description` (detalhes do móvel) e, crucialmente, `bounding_box` (coordenadas percentuais x_min, y_min, x_max, y_max).
*   **Preparação de Dados para Inpainting (`ai-design-processor.ts`):**
    *   Para cada objeto com `bounding_box` e um produto do catálogo associado (assumindo que a seleção do usuário será armazenada e recuperada corretamente no futuro):
        *   **Máscara:** Geração de uma imagem de máscara (fundo preto, retângulo branco na `bounding_box`) usando a biblioteca `sharp`.
        *   **Imagem "Primed":** A imagem do produto do catálogo selecionado é baixada, redimensionada (mantendo proporção, com fundo transparente via `sharp`) e composta (colada) sobre a imagem original do cliente na posição da `bounding_box` (também via `sharp`).
        *   Os buffers da máscara e da imagem "primed" são convertidos para base64 (data URIs) para envio à API de inpainting.
*   **Serviço de Chamada ao Replicate (`replicate-service.ts`):**
    *   Implementada a função `runInpaintingWithProduct`.
    *   Configurada para chamar o modelo `stability-ai/stable-diffusion-inpainting` (versão específica `95b72231...`) no Replicate.
    *   Recebe a imagem "primed", a máscara, um prompt textual detalhado e parâmetros de inferência.
*   **Integração da Chamada ao Replicate (`ai-design-processor.ts`):**
    *   A função `processDesignProjectImage` agora chama `runInpaintingWithProduct`.
    *   A URL da imagem resultante do Replicate é atualmente logada no console. O salvamento efetivo no banco de dados está pendente da correção do `storage.ts`.
*   **Rotas da API (`routes.ts`):**
    *   `POST /api/floorplans/:floorPlanId/initiate-analysis`: Dispara a análise da imagem da planta baixa (chamando `processDesignProjectImage`).
    *   `GET /api/ai-design-projects/:projectId/items`: Busca os `DesignProjectItems` (objetos detectados, sugestões) para um projeto. Esta rota foi modificada para tentar popular os detalhes dos produtos sugeridos (product1, product2, product3).
    *   `PUT /api/ai-design-projects/:projectId/items/:itemId`: Rota iniciada com lógica placeholder para o frontend confirmar/atualizar uma sugestão. **Precisa ser completada para chamar `storage.updateDesignProjectItem`**.

**Frontend (Lógica anteriormente em `FloorPlanEditorPage.tsx` - arquivo deletado, precisa ser recriado/reintegrado):**

*   Exibição da imagem da planta/render.
*   Chamada à API para iniciar a análise da imagem ao carregar a página.
*   Busca e listagem dos `DesignProjectItems` com polling para atualizações.
*   Desenho das `bounding_boxes` (retângulos) sobre a imagem da planta/render.
*   Exibição de até 3 sugestões de produtos (com imagem, nome, código) para cada objeto detectado.
*   Botões "Usar este" para cada sugestão, com atualização otimista da UI (a persistência no backend depende da correção do `storage.ts`).
*   Botão placeholder "Gerar Novo Render com Produtos Selecionados".

**Schema (`shared/schema.ts`):**

*   O campo `detectedObjectName: text('detected_object_name')` foi adicionado à tabela `designProjectItems`.
*   O campo `generatedInpaintedImageUrl: text('generated_inpainted_image_url')` foi adicionado à tabela `designProjectItems` para armazenar o resultado do Replicate.
*   O campo `selectedProductId` e suas relações foram verificados.

## 3. Problemas Críticos a Serem Corrigidos Manualmente pela Equipe (URGENTE)

A funcionalidade completa está atualmente bloqueada por problemas significativos no arquivo `server/storage.ts`. As tentativas de correção via ferramenta de edição assistida por IA foram mal sucedidas em resolver completamente os problemas estruturais e de sintaxe.

**É essencial que este arquivo seja revisado e corrigido manualmente para que o backend opere corretamente.**

### 3.1. Detalhamento dos Problemas e Ações para `server/storage.ts`

1.  **Estrutura da Classe `DatabaseStorage`:**
    *   **Problema:** Suspeita-se que métodos da classe `DatabaseStorage` podem estar definidos fora do escopo da classe, ou que a estrutura da classe (chaves `{}`) foi corrompida, fazendo com que a classe não implemente corretamente a interface `IStorage`.
    *   **Ação de Correção:**
        *   Abrir `server/storage.ts`.
        *   Confirmar que `export class DatabaseStorage implements IStorage { ... }` (linha ~97 até ~1119, antes de `export const storage = ...;`) engloba TODAS as definições de métodos listados na interface `IStorage` (definida nas linhas 23-95).
        *   Mover quaisquer métodos da interface que estejam fora da classe para dentro dela. Cuidado com o balanceamento das chaves `{}`.

2.  **Métodos `createDesignProjectItem` e `updateDesignProjectItem`:**
    *   **Problema:** Além de garantir que estão dentro da classe, suas implementações precisam estar corretas.
    *   **Ação de Correção:**
        *   Verificar se ambos são `async` métodos DENTRO de `DatabaseStorage`.
        *   Suas assinaturas devem ser:
            ```typescript
            async createDesignProjectItem(data: NewDesignProjectItem): Promise<DesignProjectItem>;
            async updateDesignProjectItem(itemId: number, data: Partial<NewDesignProjectItem>): Promise<DesignProjectItem | undefined>;
            ```
        *   `createDesignProjectItem` deve conseguir salvar o campo `detectedObjectName` (que é opcional no `NewDesignProjectItem` vindo do `@shared/schema`).
        *   `updateDesignProjectItem` deve efetivamente atualizar o item no banco com os campos fornecidos em `data` (ex: `suggestedProductId1`, `userFeedback`, e o novo `generatedInpaintedImageUrl`) e atualizar o campo `updatedAt`.

3.  **Importações Duplicadas/Conflitantes:**
    *   **Problema:** O linter apontou importações duplicadas ou conflitantes para tipos como `AiDesignChatMessage`.
    *   **Ação de Correção:** Revisar as primeiras ~20 linhas de `server/storage.ts` e garantir que cada tipo de `@shared/schema` seja importado apenas uma vez.

4.  **Erro de "Spread Type" em `createProduct` (Linha ~280-295 na última versão vista):**
    *   **Problema:** O linter persistentemente indicava `Spread types may only be created from object types.` nas linhas `productForDb.colors = [...insertProductData.colors];` (e similar para `materials`), mesmo com verificações `Array.isArray()`.
    *   **Ação de Correção:** Confirmar que a lógica abaixo (ou similar) está implementada e correta. Se o erro persistir *após a estrutura da classe estar 100% correta*, o problema pode ser com os dados de entrada para `createProduct` vindos de `ai-excel-processor.js` ou `catalog-processor.ts`.
        ```typescript
        if (Array.isArray(insertProductData.colors)) {
          productForDb.colors = [...insertProductData.colors];
        } else if (insertProductData.colors === null || insertProductData.colors === undefined) {
          productForDb.colors = insertProductData.colors === undefined ? undefined : [];
        } // else: não faz nada, deixa undefined para ser deletado.
        // Similar para materials e sizes (sizes usa .map que é seguro).
        if (productForDb.colors === undefined) delete productForDb.colors;
        // etc.
        ```

5.  **Métodos `createMoodboard` e `updateMoodboard` (Linhas ~561-680 na última versão vista):**
    *   **Problema:** O linter indicava que propriedades como `id`, `createdAt`, `updatedAt` não existiam no tipo `Partial<InsertMoodboard>`.
    *   **Ação de Correção:** Garantir que esses métodos não tentem deletar/acessar `id`, `userId`, `createdAt` do objeto de input `moodboardUpdateData`. O `updatedAt` deve ser adicionado ao payload final que vai para o `db.update()`. A lógica de remover chaves `undefined` do input é correta.

### 3.2. Ações de Correção Manual para `shared/schema.ts`

1.  **`designProjectItems.detectedObjectName`:**
    *   Confirmar: `detectedObjectName: text('detected_object_name'),` está presente.
2.  **`designProjectItems.detectedObjectBoundingBox`:**
    *   Confirmar: O tipo está como `jsonb('detected_object_bounding_box')`. Se estiver `json(...)` e não causar problemas, pode ser mantido, mas `jsonb` é geralmente melhor.
3.  **`designProjectItems.selectedProductId`:**
    *   Confirmar: `selectedProductId: integer('selected_product_id').references(() => products.id, { onDelete: "set null" }),` existe.
    *   Confirmar Relação: Em `designProjectItemsRelations`, a relação `selectedProduct` deve usar `fields: [designProjectItems.selectedProductId]`.
4.  **`designProjectItems.generatedInpaintedImageUrl`:**
    *   Confirmar: `generatedInpaintedImageUrl: text('generated_inpainted_image_url'),` está presente.

### 3.3. Teste Pós-Correção Manual Obrigatório

*   **Rodar Migração:** Após quaisquer alterações em `shared/schema.ts`, executar `npm run db:push` (ou o comando de migração Drizzle configurado) é **OBRIGATÓRIO** para aplicar as mudanças ao banco de dados Neon.
*   **Iniciar Servidor:** Tentar rodar o servidor backend (ex: `npm run dev`). Observar o console do Replit para quaisquer erros de compilação do TypeScript ou erros em tempo de execução ao iniciar. O servidor precisa iniciar sem erros para prosseguir.

## 4. Próximas Etapas de Desenvolvimento (Após Correções Manuais no Backend)

Com o backend estabilizado:

1.  **Completar Rota PUT para Itens (`server/routes.ts`):**
    *   Na rota `PUT /api/ai-design-projects/:projectId/items/:itemId`, fazer com que ela chame `await storage.updateDesignProjectItem(itemId, updateData)` (onde `updateData` inclui `suggestedProductId1`, `userFeedback`, `notes`, e o `selectedProductId` que o usuário eventualmente escolher).
    *   Retornar o `updatedItem`.
2.  **Remover `// @ts-ignore` (`server/ai-design-processor.ts`):**
    *   Na criação de `newItemData` dentro de `processDesignProjectImage`, remover o comentário `// @ts-ignore` de `detectedObjectName`.
3.  **Lógica de `productToInpaint` (`server/ai-design-processor.ts`):**
    *   Modificar a determinação de `productToInpaint`. Antes de chamar `runInpaintingWithProduct`, buscar o `DesignProjectItem` correspondente ao `furniture` atual (que pode ter sido atualizado pela rota PUT).
    *   Se o `userFeedback` for `'confirmed'` e `suggestedProductId1` (ou `selectedProductId`) estiver preenchido, usar esse ID para buscar o produto (`await storage.getProduct(...)`) e essa será a imagem do produto a ser usada no inpainting. Se nenhum produto estiver confirmado, pode-se pular o inpainting para esse objeto ou usar um default.
4.  **Salvar Imagem Gerada pelo Replicate (`server/ai-design-processor.ts`):**
    *   No bloco `if (generatedImageUrl)` (após a chamada a `runInpaintingWithProduct`), chamar `await storage.updateDesignProjectItem(itemId, { generatedInpaintedImageUrl: generatedImageUrl })` para salvar a URL no item do projeto. (Será necessário ter o `itemId` correto aqui).
5.  **Frontend - Exibir Imagem Renderizada e Finalizar Fluxo:**
    *   Na (recriada) `FloorPlanEditorPage.tsx`:
        *   A query que busca `designItems` deve trazer o novo campo `generatedInpaintedImageUrl`.
        *   Exibir esta imagem para cada item como "Prévia do Render do Objeto".
        *   **Botão "Gerar Render Final do Ambiente":**
            *   Este botão, quando clicado, chamará uma **nova rota de backend** (ex: `POST /api/ai-design-projects/:projectId/generate-final-render`).
            *   **Lógica da Nova Rota Backend (`generate-final-render`):**
                *   Buscar todos os `DesignProjectItem`s do projeto que foram confirmados (`userFeedback: 'confirmed'`) e que possuem um `selectedProductId` (ou `suggestedProductId1` se for o confirmado).
                *   Pegar a imagem original do projeto (`clientRenderImageUrl` ou `clientFloorPlanImageUrl`).
                *   **Iterativamente aplicar o inpainting:** Para cada item confirmado, pegar a imagem do produto selecionado, a `bounding_box`, criar a máscara e a imagem "primed" (usando a saída do inpainting anterior como base para o próximo). Chamar `runInpaintingWithProduct`.
                *   A imagem final após todos os inpaintings é a `finalRenderUrl`.
                *   Salvar esta `finalRenderUrl` no objeto `DesignProject` no banco (`await storage.updateDesignProject(projectId, { generatedRenderUrl: finalRenderUrl, status: 'completed_render' });`).
                *   Retornar a `finalRenderUrl` para o frontend.
            *   O frontend então exibe esta imagem final.
6.  **Refinamentos da UI/UX:**
    *   Adicionar `Toast notifications` para todas as operações importantes.
    *   Melhorar o feedback de carregamento/processamento.

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