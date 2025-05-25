# Projeto Ald-a: Documentação de Funcionalidades e Roadmap Estratégico

## 1. Visão Geral do Projeto Ald-a (Foco Atual: Funcionalidade de Design com IA)

O Projeto Ald-a visa revolucionar a forma como designers de interiores e clientes interagem com catálogos de móveis, transformando renders de ambientes em propostas de design concretas e personalizadas. A funcionalidade central de "Design com IA" permite que usuários enviem uma imagem de um ambiente (render), e a Inteligência Artificial analisa essa imagem para:

*   Identificar os principais móveis presentes.
*   Sugerir produtos correspondentes do catálogo da empresa que poderiam substituir os itens fictícios do render.
*   Auxiliar na visualização de produtos reais em projetos de forma rápida e inteligente.

O objetivo de longo prazo é expandir para um ecossistema completo, incluindo upload inteligente de catálogos de múltiplos fornecedores, montagem de produtos modulares, geração de moodboards profissionais e orçamentos estratégicos.

## 2. Arquitetura e Fluxo Atual da Funcionalidade "Design com IA"

O fluxo atual para processar a imagem de um cliente e sugerir produtos envolve várias etapas e tecnologias:

### 2.1. Detecção de Objetos (IA de Visão GPT-4o)
*   **Entrada:** Imagem do render do ambiente fornecida pelo usuário.
*   **Processo:**
    *   A imagem é enviada para a API **OpenAI GPT-4o Vision**.
    *   Um prompt de sistema detalhado instrui o modelo a identificar cada móvel principal individualmente, fornecer nome, descrição curta (estilo, cor, material) e `bounding box` (coordenadas relativas).
    *   A resposta esperada é um objeto JSON contendo uma lista de objetos `furniture`.
*   **Saída:** Uma lista de objetos detectados, cada um com nome, descrição e `bbox`.
*   **Armazenamento:** Cada objeto detectado é salvo como um `DesignProjectItem` no banco de dados.

### 2.2. Tentativas de Segmentação (SAM) e Fallback Atual (BBox)
*   **Objetivo Ideal:** Obter uma máscara de segmentação precisa para cada objeto detectado para extrair uma Região de Interesse (ROI) "limpa".
*   **Tentativas com Modelos SAM no Replicate:**
    *   `schananas/grounded_sam`: Inicialmente promissor, mas apresentou erros de "cannot reshape tensor" (indicando que não encontrou o objeto com o prompt de texto) ou erro 404 (Não Encontrado).
    *   `andreasjansson/grounded-sam`: Apresentou erro 422 (Versão inválida/não permitida), mesmo com hashes de versão que pareciam corretos.
    *   `cjwbw/semantic-segment-anything`: Não aceita prompt de texto para objeto específico, focado em segmentação semântica automática de toda a imagem.
    *   `meta/sam-2`: Também não parece aceitar prompt de objeto específico via API para guiar a segmentação.
*   **Fallback Atual:** Devido aos desafios com os modelos SAM no Replicate, o sistema atualmente utiliza a `bounding_box` (retângulo) fornecida pelo GPT-4o Vision como base para extrair a ROI.
*   **Lógica Implementada (mas não funcional consistentemente):**
    *   Em `server/replicate-service.ts`, a função `getSegmentationMaskSAM` foi configurada para tentar usar `andreasjansson/grounded-sam`.
    *   Em `server/ai-design-processor.ts` (função `processDesignProjectImage`), há uma lógica para simplificar o nome do objeto detectado (ex: "Mesa de jantar redonda" -> "mesa") e passá-lo como prompt para `getSegmentationMaskSAM`.
    *   Se a máscara SAM for obtida, ela seria usada para a ROI. Como tem falhado, o sistema usa a `bbox`.

### 2.3. Geração de Embeddings Visuais (CLIP Local)
*   **Processo:**
    *   A ROI (atualmente extraída via `bbox`) é processada.
    *   Um embedding CLIP (vetor de características visuais) é gerado para esta ROI usando o modelo local `Xenova/clip-vit-base-patch32` através da função `getClipEmbeddingFromImageBuffer` em `clip-service.ts`.

### 2.4. Busca de Sugestões de Produtos (`findSuggestionsForItem`)
*   Para cada `DesignProjectItem`:
    *   **Busca Textual (FTS):**
        *   Utiliza o nome e a descrição do objeto detectado.
        *   Realizada via `storage.searchProducts`, que usa `tsvector` do PostgreSQL.
        *   Resultados são normalizados para um `textScore` (0-1).
        *   Produtos sem `imageUrl` são filtrados.
    *   **Busca Visual Vetorial:**
        *   O embedding CLIP da ROI é comparado com os `clipEmbeddings` pré-calculados dos produtos no catálogo (coluna `clipEmbedding` na tabela `products`).
        *   Utiliza o operador de distância L2 (`<->`) do `pgvector`.
        *   Resulta em um `visualScore` (1 / (1 + distância L2)).
        *   Produtos sem `imageUrl` ou `clipEmbedding` são desconsiderados.
    *   **Limiar Visual Inicial:** Produtos com `visualScore < 0.10` (anteriormente 0.135) são descartados da consideração puramente visual.

### 2.5. Cálculo de Score Combinado e Filtragem Final
*   **Score Combinado:**
    *   Para cada produto candidato (que apareceu na FTS ou na busca visual), um `combinedScore` é calculado.
    *   Pesos: `visualWeight = 0.99`, `textWeight = 0.01`.
*   **Filtros Aplicados:**
    1.  **Limiar Mínimo de Score Combinado:** Sugestões com `combinedScore <= 0.05` (anteriormente 0.10) são descartadas.
    2.  **Filtro de Categoria:**
        *   Compara o nome normalizado do objeto detectado pela IA com a categoria normalizada do produto.
        *   Utiliza um mapa de `mappings` para sinônimos e relações hierárquicas (ex: "cadeira de jantar" é "cadeira"; "sofá de 3 lugares" é simplificado para "sofa" antes da comparação).
        *   Inclui fallback para correspondência parcial com `startsWith`.
*   **Resultado:** Até 5 das melhores sugestões que passam por todos os filtros são retornadas para cada item.

### 2.6. Tecnologias Chave em Uso (Backend para esta funcionalidade)
*   **Node.js com TypeScript**
*   **Express.js** para o servidor API REST.
*   **PostgreSQL** como banco de dados.
*   **Drizzle ORM** para interações com o banco de dados.
*   **`pgvector`** para busca por similaridade de embeddings.
*   **OpenAI API (GPT-4o Vision)** para análise de imagem.
*   **Replicate API** para tentativas de uso de modelos SAM (atualmente problemático).
*   **`@xenova/transformers` (CLIP local)** para geração de embeddings visuais de ROIs.
*   **`sharp`** para processamento de imagem (recorte de ROI).
*   **WebSockets** para comunicação em tempo real com o frontend.
*   **AWS S3** para armazenamento de imagens.

## 3. Progresso Realizado e Conquistas Recentes

*   **Detecção de Objetos Funcional:** A IA de Visão (GPT-4o) está identificando consistentemente múltiplos objetos, seus nomes, descrições e `bbox` nas imagens de render. O prompt foi refinado para incentivar a individualização de itens.
*   **Fluxo de Backend Robusto (com Fallback para BBox):** O pipeline desde o upload da imagem, passando pela detecção de objetos, busca textual, extração de ROI via `bbox`, geração de embedding CLIP local, busca vetorial, cálculo de score combinado e filtros (incluindo o de categoria aprimorado) está operacional.
*   **Ajuste de Limiares e Filtros:**
    *   Os limiares de `visualScore` e `combinedScore` foram reduzidos experimentalmente para permitir que mais sugestões apareçam enquanto o SAM não está funcional, resultando em algumas sugestões corretas sendo exibidas.
    *   O filtro de categoria foi significativamente melhorado com simplificação de nomes e mapeamentos mais abrangentes, resolvendo casos como "sofá de 3 lugares" vs. categoria "sofá".
*   **Logs Detalhados para Diagnóstico:** Foram implementados logs detalhados em pontos chave da função `findSuggestionsForItem` para permitir uma análise mais profunda dos scores (FTS, Visual, Combinado) de cada produto candidato antes e depois dos filtros.
*   **Interface do Usuário:** Exibe os itens detectados e as sugestões (embora a apresentação de múltiplas sugestões por item e o agrupamento de itens idênticos sejam melhorias futuras).

## 4. Desafios Atuais e Pontos de Atenção

*   **Instabilidade/Indisponibilidade de Modelos SAM no Replicate:**
    *   As tentativas de usar `schananas/grounded_sam`, `meta/sam-2`, `cjwbw/semantic-segment-anything` e `andreasjansson/grounded-sam` (mesmo com hashes de versão específicos) têm resultado em erros (404, 422, ou erros internos do modelo como "cannot reshape tensor").
    *   Isso impede o uso de máscaras de segmentação precisas, forçando o sistema a depender do fallback da `bbox` do GPT-4o.
*   **Qualidade da ROI com `bbox`:** A Região de Interesse extraída via `bbox` pode conter ruído visual (fundo, outros objetos), o que impacta negativamente a precisão do embedding CLIP gerado e, consequentemente, a qualidade e relevância do `visualScore`.
*   **Precisão das Sugestões Visuais:**
    *   Mesmo com limiares ajustados, a ausência de sugestões para alguns itens (como a "Mesa de jantar redonda Aspen Alta" no teste da sala de jantar) indica que os scores visuais (baseados na `bbox`) para produtos relevantes do catálogo ainda são muito baixos.
    *   É necessário investigar se isso se deve à qualidade da `bbox`, à qualidade das imagens/embeddings dos produtos no catálogo, ou limitações do modelo CLIP para certas correspondências.
*   **Qualidade e Completude dos Dados do Catálogo:** O sucesso das sugestões depende criticamente de produtos no catálogo terem:
    *   Imagens de alta qualidade e representativas.
    *   `clipEmbeddings` corretamente gerados e armazenados.
    *   Categorias precisas e consistentes.
*   **Apresentação de Múltiplos Itens Idênticos:** A IA de Visão está corretamente identificando múltiplas instâncias de itens (ex: 6 cadeiras). A UI atualmente mostra sugestões para cada uma individualmente, o que pode ser repetitivo. Uma lógica de agrupamento na apresentação é desejável.
