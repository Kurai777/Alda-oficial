# Resumo da Sessão de Desenvolvimento e Próximos Passos - Ald-a (17 de Maio de 2025)

Este documento resume as atividades de desenvolvimento, problemas identificados, soluções aplicadas e próximos passos para o projeto Ald-a, com foco na funcionalidade de Design com IA.

## I. Conquistas e Alterações Implementadas Nesta Sessão:

1.  **Correção da Busca de Detalhes de Produtos (Erro "ID Inválido"):**
    *   **Problema:** O frontend não conseguia carregar detalhes de produtos sugeridos, exibindo um erro "ID Inválido (400)".
    *   **Causa Raiz:** Ordem incorreta de registro das rotas no Express (`server/routes_v2.ts`), onde `/api/products/:id` estava interceptando chamadas para `/api/products/batch`.
    *   **Solução:** Reordenamento das rotas. **Status: Concluído e Funcionando.**

2.  **Correção da Integração com Replicate para Inpainting:**
    *   **Problema Inicial:** Erro de "Versão Inválida" do modelo `stability-ai/stable-diffusion-inpainting`.
    *   **Solução:** Atualização da string da versão do modelo no código (`server/ai-design-processor.ts`).
    *   **Problema Secundário:** Erro de "Billing Required" (402) retornado pelo Replicate.
    *   **Solução:** Configuração de faturamento na conta Replicate pelo usuário.
    *   **Status: Concluído. Chamadas ao Replicate estão sendo feitas.**

3.  **Implementação da Busca Full-Text (FTS) com `tsvector`:**
    *   Adição da coluna `search_tsv` (tipo `tsvector`) à tabela `products` no banco de dados.
    *   Criação de índice GIN na coluna `search_tsv`.
    *   População inicial da coluna `search_tsv` para produtos existentes.
    *   Criação de função de trigger e trigger no PostgreSQL para manter `search_tsv` atualizada automaticamente em `INSERT`s e `UPDATE`s na tabela `products`.
    *   Atualização do schema Drizzle (`shared/schema.ts`) para incluir a coluna `search_tsv`.
    *   Sincronização do Drizzle Kit com o estado do banco (uso de `drizzle-kit push` e reset do histórico de migrações).
    *   Modificação da função `storage.searchProducts` (em `server/storage.ts`) para usar `plainto_tsquery` (com fallback para `to_tsquery` com `OR`) na coluna `search_tsv`.
    *   **Status: Implementado. A FTS agora retorna resultados, embora a relevância precise de mais refinamento.**

4.  **Melhoria na Lógica de Sugestão de Produtos (`server/ai-design-processor.ts`):**
    *   Refinada a estratégia de combinação de fontes de sugestão:
        1.  Prioridade para Busca Visual por Região (filtrada por tipo de móvel).
        2.  Fallback para Busca Visual Global (filtrada por tipo de móvel).
        3.  Fallback para Busca Textual FTS (agora funcional, também filtrada por tipo de móvel).
        4.  Fallback de último recurso para Busca Visual por Região (não filtrada por tipo), mas apenas se a categoria detectada existir no catálogo do usuário.
    *   Implementada a função `storage.getProductCategoriesForUser` para verificar as categorias existentes no catálogo do usuário.
    *   **Status: Melhorias implementadas. As sugestões estão mais diversificadas e a FTS contribui, mas a precisão geral ainda precisa de ajustes.**

5.  **Render Final (Inpainting):**
    *   Removida a restrição de tamanho mínimo da Bounding Box para tentar o inpainting via Replicate, conforme solicitado.
    *   **Status: Restrição removida (confirmar no código em execução). O inpainting agora deve ser tentado para todas as BBoxes. A qualidade visual do resultado do render final ainda é um ponto de atenção.**

## II. Problemas Atuais e Pontos de Atenção:

1.  **Qualidade das Sugestões de Produtos:**
    *   **Identificação da IA de Visão (GPT-4o):** Continua classificando incorretamente alguns itens (ex: "Cadeira" como "Poltrona"). As sugestões para o tipo classificado erroneamente (ex: "Poltrona Onda" para a cadeira) não são visualmente similares ao item original da imagem.
    *   **Busca Textual FTS:** Embora agora retorne resultados para algumas categorias (ex: Mesas de Centro, Estantes), ainda falha para outras (ex: Luminária, Tapete, mesmo quando a categoria existe no catálogo e a FTS é o fallback). A relevância dos resultados da FTS também pode ser melhorada.
    *   **Busca Visual por Região (CLIP):** A qualidade do embedding da região ou dos produtos pode não ser suficiente para sempre trazer o melhor match visual, especialmente se o filtro de tipo subsequente for muito restritivo ou se o item na região for sutil.

2.  **Qualidade do Render Final:**
    *   Mesmo com o inpainting sendo tentado, a imagem final frequentemente não reflete a substituição do produto de forma clara ou pode parecer "esticada".
    *   **Causas Prováveis:** Bounding Boxes da IA de visão ainda podem ser muito pequenas ou imprecisas para um inpainting de alta qualidade; o prompt para o Replicate pode ser muito genérico; o modelo de inpainting pode ter limitações para áreas pequenas ou complexas.

3.  **Precisão das Bounding Boxes (BBox) da IA de Visão:**
    *   Muitas BBoxes para itens menores (mesas de centro, luminárias, poltronas/cadeiras) são calculadas como sendo muito pequenas. Isso afeta negativamente a qualidade da busca visual por região e a eficácia do inpainting.

## III. Próximos Passos e Melhorias Recomendadas:

1.  **Refinar Precisão da IA de Visão (GPT-4o):**
    *   **Ação:** Experimentar com o prompt enviado ao GPT-4o em `processDesignProjectImage` para:
        *   Melhorar a distinção entre tipos de móveis similares (ex: Cadeira vs. Poltrona). Incluir exemplos ou descrições mais claras no prompt.
        *   Incentivar a geração de Bounding Boxes maiores e mais precisas que cubram melhor os objetos.

2.  **Ajustar Lógica de Sugestões (`ai-design-processor.ts`):**
    *   **Revisar o Fallback `visual_region_unfiltered`:** Avaliar se este fallback é realmente útil ou se é melhor não sugerir nada se as buscas filtradas falharem, para evitar sugestões de categorias corretas mas visualmente muito diferentes.
    *   **Melhorar o Score/Ranking:** A forma como `matchScore` é preenchido (usando `distance ?? relevance ?? 0`) pode precisar de normalização para que scores de fontes diferentes (visual vs. textual) sejam mais comparáveis na ordenação final.

3.  **Melhorar a Busca Textual FTS (`storage.ts` e conteúdo do `search_tsv`):**
    *   **Diagnóstico Profundo:** Executar queries SQL diretamente no NeonDB com os `ftsQueryString` exatos que falham no código para entender a discrepância. Verificar o conteúdo dos `tsvector`s para os produtos que deveriam ser encontrados.
    *   **Conteúdo do `search_tsv`:** Assegurar que a função `update_products_search_tsv` e o `UPDATE` inicial concatenam todos os campos textuais relevantes de forma otimizada.
    *   **Estratégia de Query FTS:** Se `plainto_tsquery` (com AND) e `to_tsquery` (com OR) ainda não são ideais, considerar a construção de `tsquery` mais granular, talvez dando pesos diferentes para palavras-chave extraídas do nome do item vs. da descrição.

4.  **Refinar o Processo de Render Final (`ai-design-processor.ts`):**
    *   **Analisar Logs do Inpainting:** Verificar o `inpaintingPrompt` e o tamanho da `primedImageBase64` nos logs para entender o que está sendo enviado ao Replicate.
    *   **Prompt do Replicate:** Experimentar com prompts mais descritivos ou contextuais para o Replicate, talvez incluindo informações sobre o estilo do ambiente ou pedindo alterações mais evidentes.
    *   **Tratamento de Imagem Pós-Replicate:** Investigar se o "esticamento" da imagem é algo que pode ser corrigido no frontend ou se é um artefato do Replicate.

5.  **Implementar Novas Funcionalidades Solicitadas:**
    *   **Gerar Orçamento:** Adicionar botão/opção na UI de Design com IA para, a partir dos `selectedProductId` dos `DesignProjectItem`s, criar ou adicionar itens a um orçamento.
    *   **Criar Moodboard:** Adicionar botão/opção para criar um moodboard com os produtos selecionados no projeto de IA.
    *   Isto exigirá novas rotas de API ou modificações nas existentes e atualizações significativas no frontend.

## IV. Ideias Adicionais para Evolução (Sugestões do Gemini):**

*   **Fusão de Embeddings:** Combinar embeddings visuais (CLIP) com embeddings textuais (ex: de modelos como `text-embedding-3-large` da OpenAI) das descrições dos produtos e das descrições da IA para uma busca por similaridade multimodal mais rica.
*   **Interface para Correção pelo Usuário:** Permitir que o usuário corrija identificações da IA (ex: mudar "Poltrona" para "Cadeira"), o que dispararia uma nova busca de sugestões.
*   **Modelos de Embedding Alternativos/Específicos:** Explorar outros modelos de embedding que possam ser mais adequados para o domínio de móveis.
*   **Refinamento de Prompt Avançado para IA de Visão:** Usar técnicas como few-shot prompting ou instruções mais detalhadas para melhorar a precisão da detecção de objetos e BBoxes.

## V. Instruções para Gerenciamento de Migrações Drizzle:

Para futuras alterações no schema do banco de dados (`shared/schema.ts`):

1.  **Modifique `shared/schema.ts`** com as novas colunas, tabelas ou alterações.
2.  **Gere o Arquivo de Migração SQL:** No terminal, na raiz do projeto, execute:
    ```bash
    npx drizzle-kit generate
    ```
    Isso criará um novo arquivo SQL na pasta `migrations` (ex: `migrations/0001_nome_da_feature.sql`).
3.  **(Recomendado) Revise o Arquivo SQL Gerado:** Abra o arquivo SQL para entender as alterações que ele fará no banco.
4.  **Aplique a Migração ao Banco de Dados:**
    ```bash
    npx drizzle-kit migrate
    ```
    Isso executará os arquivos de migração pendentes no seu banco de dados NeonDB e registrará sua aplicação na tabela `drizzle.__drizzle_migrations`.

**Nota sobre Sincronização Inicial (Como Feito Nesta Sessão):**
Se o histórico de migrações do Drizzle ficar dessincronizado com o estado real do banco (ex: tabelas já existem mas o Drizzle acha que não), o processo para resincronizar envolveu:
1.  Garantir que `shared/schema.ts` reflita o estado desejado do banco.
2.  Rodar `DROP TABLE IF EXISTS drizzle.__drizzle_migrations;` no SQL Editor e recriá-la com `created_at BIGINT`.
3.  Deletar o conteúdo da pasta `migrations` local.
4.  Rodar `npx drizzle-kit push` para forçar o Drizzle a alinhar seu entendimento com o banco.
5.  Rodar `npx drizzle-kit generate` para criar uma nova migração "inicial" (`0000_...sql`).
6.  Inserir manualmente o registro desta migração "inicial" na tabela `drizzle.__drizzle_migrations` para evitar que `migrate` tente recriar tabelas já existentes.
    ```sql
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at) 
    VALUES ('nome_do_arquivo_0000_sem_extensao', EXTRACT(EPOCH FROM NOW()) * 1000); 
    ```
A partir daí, o fluxo normal de `generate` e `migrate` deve funcionar para alterações incrementais.

---

Espero que este resumo seja útil para sua equipe! 