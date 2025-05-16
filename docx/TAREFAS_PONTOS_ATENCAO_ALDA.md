# Tarefas Pendentes, Pontos de Atenção e Próximos Passos - Projeto Ald-a

**Data:** (Data Atual)

Este documento resume os ajustes necessários, pontos de atenção e os próximos passos recomendados para dar continuidade ao desenvolvimento e iniciar os testes do fluxo de Design com IA do projeto Ald-a.

## I. Ajustes Críticos no Backend (`server/ai-design-processor.ts`)

1.  **Corrigir Escopo de Variáveis em `performSingleInpaintingStep`:**
    *   **Problema:** Erros de linter persistentes ("Cannot find name 'rectWidth'", etc.) indicam que as variáveis `imageWidth`, `imageHeight`, `rectX`, `rectY`, `rectWidth`, `rectHeight` não estão corretamente acessíveis nos blocos de código que criam a máscara e a imagem "primed".
    *   **Ação Necessária:** Um desenvolvedor precisa refatorar o escopo dentro desta função. As 6 variáveis mencionadas devem ser declaradas no escopo mais alto da função. O cálculo delas (obtenção de metadados da imagem base, normalização da `detectedObjectBoundingBox` do item) deve ocorrer primeiro. Somente após o cálculo e validação bem-sucedidos dessas variáveis, a lógica para criar `maskBuffer` e `primedImageBase64` (que dependem dessas variáveis) deve ser executada. Idealmente, todo o processo de preparação da imagem (cálculo de dimensões, bbox, máscara e imagem primed) deve estar contido em um único bloco `try...catch` para garantir que as variáveis estejam no mesmo escopo e para um tratamento de erro coeso. Se este bloco falhar, a função deve retornar `null`.
    *   **Status:** Bloqueador para a funcionalidade de inpainting.

## II. Refinamento e Testes da Lógica de Imagem (`sharp`)

1.  **Lógica de Criação de Máscara (`performSingleInpaintingStep` e `triggerInpaintingForItem`):
    *   **Ação:** Validar e refinar a interpretação da `detectedObjectBoundingBox`. A heurística atual para determinar se as coordenadas são percentuais ou em pixels precisa ser testada com exemplos reais retornados pela IA. Garantir que a máscara gerada (retângulo branco sobre fundo preto) seja precisa em termos de tamanho e posição.

2.  **Lógica de Criação da Imagem "Primed" (`performSingleInpaintingStep` e `triggerInpaintingForItem`):
    *   **Ação:** A lógica de redimensionamento da imagem do produto (`sharp(productSelectionImageBuffer).resize(...)`) usando `fit: sharp.fit.inside` e a subsequente centralização na `bounding_box` precisam de testes visuais. Ajustar os parâmetros de `resize` e a lógica de `offsetX`/`offsetY` conforme necessário para garantir que o produto apareça de forma esteticamente agradável e proporcional na área designada.
    *   Considerar o tratamento de imagens de produtos com e sem fundo transparente.

## III. Conexão Frontend com APIs Reais (`client/src/pages/design-ai-project.tsx`)

1.  **Buscar Dados Reais do Projeto e Itens:**
    *   **Status:** `queryFn` em `DesignAiProjectPage.tsx` atualizada para chamar `getDesignProjectDetailsApi` de `apiClient.ts`.
    *   **Ponto de Atenção/Verificação:** A função `getDesignProjectDetailsApi` atualmente chama `GET /api/ai-design-projects/:projectId/items`. É crucial verificar a estrutura exata da resposta desta rota no backend (`server/routes.ts`).
        *   Se ela retornar o objeto do projeto com uma propriedade `items` (array de `DesignProjectItem`), a adaptação no frontend será mínima.
        *   Se ela retornar *apenas* um array de `DesignProjectItem`, a função `getDesignProjectDetailsApi` precisará ser ajustada para fazer uma segunda chamada para buscar os detalhes base do projeto (ex: `GET /api/ai-design-projects/:projectId`) e então combinar os resultados antes de retornar para o frontend.
        *   Garantir que os tipos retornados pela API real sejam compatíveis com `MockDesignProject` e `MockDesignProjectItem` usados no frontend, ou refatorar o frontend para usar os tipos de `@shared/schema`.
    *   **Impacto:** Essencial para que o frontend exiba as `generatedInpaintedImageUrl` e a `generatedRenderUrl` reais, e o status atualizado do projeto.

2.  **Salvar Seleção de Produto com API Real:**
    *   **Problema:** A `selectProductMutation` atualmente chama a função mock `selectProductForItem`.
    *   **Ação:** Implementar uma função em `client/src/lib/apiClient.ts` (ex: `updateDesignProjectItemApi`) para fazer a chamada `PUT` para `/api/ai-design-projects/:projectId/items/:itemId` (esta rota já está implementada no backend).
    *   Substituir a `mutationFn` da `selectProductMutation` para usar esta nova função de API real.

3.  **Upload de Imagem do Projeto com API Real:**
    *   **Problema:** A `uploadMutation` atualmente chama a função mock `uploadRenderImage`.
    *   **Ação:** 
        *   **Investigar Rota Backend:** Determinar a rota `POST` correta no backend para o upload da imagem inicial do `DesignProject` que dispara a análise via `processDesignProjectImage`. O plano menciona `POST /api/floorplans/:floorPlanId/initiate-analysis`, mas um `DesignProject` pode não ter um `floorPlanId` inicialmente, ou pode ser um render. Uma rota como `POST /api/ai-design-projects/:projectId/upload-image-for-analysis` ou uma que crie o projeto e receba a imagem pode ser necessária.
        *   Implementar a função correspondente em `client/src/lib/apiClient.ts` que lida com o `POST` do arquivo (usando `FormData`).
        *   Substituir a `mutationFn` da `uploadMutation`.

## IV. Configuração de API Keys (Secrets do Replit)

1.  **`REPLICATE_API_TOKEN`:**
    *   **Ação:** Verificar se esta variável de ambiente está configurada corretamente nos Secrets do Replit. É essencial para a funcionalidade de inpainting.
2.  **`ANTHROPIC_API_KEY`:**
    *   **Ação:** Verificar/Configurar esta variável nos Secrets. Usada como fallback para análise de imagem se a OpenAI falhar. Importante para robustez.

## V. Testes de Ponta a Ponta

*   Após os ajustes manuais no backend e a conexão das APIs no frontend, realizar testes completos do fluxo:
    1.  Criação de um novo projeto de design (se o upload de imagem não criar automaticamente).
    2.  Upload da imagem base do ambiente.
    3.  Verificação da análise da IA e das sugestões de produtos.
    4.  Seleção de produtos para os itens detectados.
    5.  Verificação da geração e exibição da `generatedInpaintedImageUrl` (prévia individual do item).
    6.  Chamada da funcionalidade "Gerar Render Final".
    7.  Verificação da geração e exibição da `generatedRenderUrl` (imagem final do projeto).
    8.  Observar todos os toasts de feedback e tratamento de erros.

## VI. Pontos Adicionais / Melhorias (Considerar Após Testes)

*   **Limpeza de `generatedInpaintedImageUrl`:** Quando um `selectedProductId` é desmarcado (definido como `null`), o backend deveria também limpar a `generatedInpaintedImageUrl` do `DesignProjectItem` para que a UI volte a mostrar as sugestões.
*   **Feedback de Progresso Granular:** Para o render final, considerar WebSockets para atualizações de progresso mais detalhadas.
*   **Consistência da `bounding_box`:** Padronizar o formato da `bounding_box` retornado pela IA (percentual ou pixels) para simplificar o processamento no backend.

Priorizar os itens da Seção I e III para habilitar os testes do fluxo principal. 