# Projeto Ald-a: Documentação de Funcionalidades e Roadmap Estratégico

## 1. Visão Geral do Projeto Ald-a

O Projeto Ald-a visa revolucionar a forma como designers de interiores e clientes interagem com catálogos de móveis. O foco inicial inclui uma funcionalidade robusta de "Upload Inteligente de Catálogos" para processar diversos formatos de arquivos e a funcionalidade de "Design com IA" para transformar renders de ambientes em propostas de design concretas.

O objetivo de longo prazo é expandir para um ecossistema completo, incluindo upload inteligente de catálogos de múltiplos fornecedores, montagem de produtos modulares, geração de moodboards profissionais e orçamentos estratégicos.

## 2. Funcionalidade: Upload Inteligente de Catálogos (Foco Atual Principal)

Esta funcionalidade é crucial para popular o sistema Ald-a com produtos de diferentes fornecedores, cada um com seu formato de catálogo.

### 2.1. Objetivos
- Processar catálogos fornecidos como arquivos Excel completos (contendo todas as informações, incluindo imagens e preços).
- Processar catálogos fornecidos em partes: um "Arquivo Artístico" (geralmente PDF com visuais dos produtos e descrições básicas) e um "Arquivo de Preços" separado (geralmente planilha Excel ou PDF com tabelas de preços).
- Extrair de forma inteligente e precisa os detalhes dos produtos: nome, código, descrição, dimensões, categoria, materiais, cores e preços (incluindo variações como classes de acabamento).
- Associar corretamente as imagens aos seus respectivos produtos.
- Armazenar os produtos de forma estruturada no banco de dados.

### 2.2. Estratégia e Fluxo de Processamento Atual

**2.2.1. Para Arquivos Excel Completos:**
1.  **Upload:** Usuário faz upload do arquivo Excel via interface.
2.  **Armazenamento Inicial:** Arquivo é enviado para o AWS S3.
3.  **Processamento no Backend (`server/catalog-processor.ts`):
    *   Download do Excel do S3 para um local temporário.
    *   **Extração de Dados Textuais:** O conteúdo da planilha é lido e enviado em blocos para a API da OpenAI (GPT-4o via `ai-excel-processor.js`) para identificar e extrair informações dos produtos (nome, código, preço, descrição, categoria, materiais, etc.).
    *   **Extração de Imagens Embutidas:** Um script Python (`extract_images_by_row.py`) é executado para extrair imagens embutidas na planilha e suas linhas de referência.
    *   **Upload de Imagens para S3:** As imagens extraídas são enviadas para o AWS S3.
    *   **Associação Inteligente de Imagens:** Os produtos salvos são comparados com as imagens extraídas. A associação é feita pela linha da planilha (`excelRowNumber`) e confirmada pela API OpenAI Vision (`verifyImageMatchWithVision`). Um fallback para imagem única na linha é utilizado se a IA não confirmar.
    *   **Geração de Embeddings:** Embeddings textuais (OpenAI) são gerados para os dados do produto e embeddings visuais (CLIP local via `clip-service.js`) são gerados para as imagens associadas.
    *   **Salvamento:** Produtos com todos os dados (incluindo `imageUrl` e `clipEmbedding`) são salvos no banco de dados PostgreSQL.

**2.2.2. Para Arquivos Separados (PDF Artístico + Planilha de Preços):**
1.  **Upload:** Usuário faz upload do PDF artístico e, opcionalmente, da planilha de preços.
2.  **Armazenamento Inicial:** Arquivos são enviados para o AWS S3.
3.  **Processamento do PDF Artístico no Backend (`server/catalog-processor.ts`):
    *   Download do PDF do AWS S3.
    *   **Upload para Google Cloud Storage (GCS):** Devido a limites de tamanho da API Vision para arquivos inline, o PDF é primeiro enviado para um bucket no GCS.
    *   **OCR com Google Cloud Vision API:** A função `asyncBatchAnnotateFiles` da Vision API é chamada para processar o PDF armazenado no GCS, realizando OCR (`DOCUMENT_TEXT_DETECTION`) em todas as páginas. Os resultados (texto estruturado por página) são salvos de volta no GCS em arquivos JSON.
    *   **Download e Reconstrução do Texto OCR:** O backend baixa esses arquivos JSON de resultado do GCS e reconstrói o texto completo de cada página.
    *   **Extração de Produtos do Texto OCR via OpenAI:** O texto OCR de cada página (até um limite configurável `MAX_PAGES_TO_PROCESS_WITH_OPENAI`) é enviado para a API da OpenAI (GPT-4o via a função `extractProductsFromTextWithOpenAI`) com um prompt detalhado para identificar e extrair informações estruturadas dos produtos (nome, descrição, código, dimensões, categoria, materiais, cores).
    *   **Salvamento (Parcial):** Os produtos extraídos do texto são salvos no banco de dados com embeddings textuais. O campo `imageUrl` permanece `null` nesta fase, aguardando a extração de imagens literais do PDF.
4.  **Processamento da Planilha de Preços no Backend (se fornecida):
    *   Download da planilha do S3.
    *   Utilização da API OpenAI (`ai-excel-processor.js` ou similar via `pricing-file-processor.js`) para extrair códigos, nomes de modelos e tabelas de preços com suas variações/classes.
5.  **Fusão de Dados (`server/catalog-fusion-service.ts`):
    *   Os produtos extraídos do PDF artístico são combinados com os dados da planilha de preços. A correspondência primária é por código do produto, com planos para implementar um fallback mais inteligente usando IA (comparação de nomes/descrições e embeddings) se o código não corresponder.

### 2.3. Funcionalidades Implementadas (Estado Atual)
*   Upload de arquivos Excel completos e processamento (incluindo extração de dados textuais, imagens embutidas, associação e embeddings) - **Restaurado e funcionando.**
*   Upload de arquivos PDF artístico e Planilha de Preços separados.
*   Upload do PDF artístico para Google Cloud Storage (GCS).
*   OCR de múltiplas páginas de PDFs (via Google Cloud Vision API e GCS) para extração de texto bruto - **Funcionando.**
*   Extração inicial de produtos do texto OCR via OpenAI (GPT-4o) - **Funcionando para algumas páginas; requer refinamento significativo do prompt.**
*   Processamento de planilhas de preços (Excel) via OpenAI para extrair itens e variações de preço - **Funcionando.**
*   Estrutura básica para fusão de dados (match por código) - **Implementada.**
*   Geração de embeddings textuais para produtos extraídos do PDF.

### 2.4. Desafios Atuais e Pontos de Atenção
*   **Qualidade da Extração da OpenAI a partir do Texto OCR:** O desafio principal é refinar o prompt para a OpenAI (`extractProductsFromTextWithOpenAI`) para que ela interprete corretamente o texto OCR (que pode ser ruidoso ou ter formatação variada) e extraia de forma precisa e completa: 
    *   Nomes de modelo de produto (especialmente quando o nome está em uma página/seção e as especificações em outra).
    *   Códigos de produto.
    *   Dimensões detalhadas.
    *   Materiais e cores específicos do produto.
*   **Associação Contextual:** Melhorar a capacidade da IA de associar informações que podem estar visualmente próximas em uma página de catálogo, mas separadas no texto OCR (ex: um nome de modelo no topo da página e suas especificações mais abaixo).
*   **Robustez para Diversos Layouts de PDF:** Garantir que a extração funcione bem para diferentes estruturas e layouts de catálogos PDF.
*   **Extração de Imagens Literais de PDFs:** A funcionalidade para extrair as imagens visuais dos produtos de dentro dos arquivos PDF e associá-las aos dados extraídos ainda precisa ser implementada. (Marcado como `TODO`).
*   **Lógica de Fusão de Preços:** A fusão atual é baseada em código. É necessário implementar um fallback robusto (provavelmente usando IA/embeddings) para associar produtos e preços quando os códigos não batem ou estão ausentes nos produtos extraídos do PDF.
*   **Performance e Custo:** O processamento de PDFs página a página com Google Vision e depois com OpenAI para cada página pode ser demorado e custoso para catálogos muito grandes. Otimizações e/ou estratégias de processamento em lote podem ser necessárias.

### 2.5. Ferramentas e Tecnologias Chave (para Upload Inteligente)
*   **Backend:** Node.js com TypeScript, Express.js.
*   **Armazenamento de Arquivos:** AWS S3 (para upload inicial), Google Cloud Storage (para PDFs antes do OCR pela Vision API).
*   **OCR de PDF:** Google Cloud Vision API (`documentTextDetection` via `asyncBatchAnnotateFiles`).
*   **Extração de Dados de Texto e Excel:** OpenAI API (GPT-4o).
*   **SDKs:** `@google-cloud/vision`, `@google-cloud/storage`, `openai` (Node.js).
*   **Processamento Excel (Bibliotecas):** `xlsx`.
*   **Extração de Imagens de Excel:** Script Python (`extract_images_by_row.py`) usando `openpyxl`.
*   **Banco de Dados:** PostgreSQL (NeonDB) com Drizzle ORM e `pgvector`.
*   **Embeddings:** OpenAI `text-embedding-3-small` (para texto), `@xenova/transformers` (CLIP local para imagens de produtos de Excel).

### 2.6. Próximos Passos Imediatos (Plano para Upload Inteligente de PDF)
1.  **Coleta e Análise de Texto OCR:**
    *   Executar o processamento no catálogo PDF de exemplo com `MAX_PAGES_TO_PROCESS_WITH_OPENAI` aumentado (ex: 20-25 páginas).
    *   Coletar o texto OCR completo logado para cada uma dessas páginas.
    *   Analisar manualmente a qualidade do OCR e a estrutura do texto, especialmente para páginas que contêm produtos bem definidos mas que a IA não está extraindo corretamente.
2.  **Refinamento Iterativo do Prompt da OpenAI:**
    *   Com base na análise do texto OCR, refinar intensivamente o `systemPromptForTextExtraction` na função `extractProductsFromTextWithOpenAI`.
    *   Foco em: Melhorar a identificação de nomes de modelo proeminentes, associar especificações (mesmo que em seções diferentes da página) ao nome do modelo correto, extrair com precisão códigos, dimensões, e outros atributos, e instruir a IA a ser mais robusta a variações no texto OCR.
    *   Testar o prompt refinado com os textos OCR coletados (pode-se usar o Playground da OpenAI para testes rápidos de prompt antes de codificar).
3.  **Testar e Validar a Extração:** Implementar o prompt refinado e testar novamente o fluxo de upload de PDF, verificando a qualidade e completude dos produtos extraídos.
4.  **Melhorar Lógica de Fusão:** Após ter produtos mais bem extraídos do PDF (com nomes e talvez códigos mais precisos), revisitar e melhorar a função `fuseCatalogData` para aumentar as chances de correspondência com os itens da planilha de preços. Considerar o uso de embeddings textuais para comparação de similaridade semântica entre nomes/descrições.
5.  **(Roadmap Futuro) Extração de Imagens Visuais de PDFs:** Planejar e implementar a extração das imagens dos produtos de dentro dos arquivos PDF e associá-las aos registros de produtos correspondentes (atualizando `imageUrl` e gerando `clipEmbedding`).

## 3. Funcionalidade: Design com IA (Visão Geral e Status Anterior)

*   **(Seção existente do seu arquivo original sobre Detecção de Objetos, SAM, CLIP Local, etc., pode ser mantida aqui, revisada ou resumida conforme o foco atual do projeto. Para esta atualização, o foco principal foi no Upload Inteligente).**
    *   **Status:** Backend inicial e frontend básico foram criados, com desafios na integração de modelos SAM via Replicate. O fluxo atual depende de Bounding Boxes do GPT-4o Vision para ROIs, com busca textual e vetorial (CLIP) para sugestões.

## 4. Roadmap de Melhorias Gerais e Novas Funcionalidades (Adicionado/Expandido)

Esta seção delineia melhorias mais amplas para a plataforma Ald-a e novas funcionalidades planejadas para o futuro.

### 4.1. Melhorar Fluidez da Aplicação e Experiência em Tempo Real
*   **Objetivo:** Tornar a interação do usuário com o Ald-a mais dinâmica e responsiva, especialmente para operações de longa duração como o processamento de catálogos e análises de IA.
*   **Estratégias Potenciais:**
    *   **WebSockets:** Expandir o uso do WebSocketManager existente para fornecer feedback em tempo real sobre o status de processamento de catálogos, progresso de análises de IA, e outras tarefas assíncronas.
    *   **Notificações:** Implementar um sistema de notificações no frontend para alertar o usuário sobre a conclusão de tarefas ou erros.
    *   **Carregamento Otimizado:** Otimizar queries ao banco de dados, implementar paginação eficiente para listas grandes (ex: produtos, catálogos), e usar técnicas de carregamento progressivo (lazy loading) para imagens e componentes no frontend.
    *   **Filas de Tarefas (Backend):** Para tarefas de background muito pesadas ou numerosas, considerar o uso de um sistema de filas de mensagens (ex: RabbitMQ, Redis Streams, ou um serviço cloud como AWS SQS) para melhor gerenciamento, escalabilidade e resiliência.

### 4.2. Atualização da Paleta de Cores e Identidade Visual do Aplicativo
*   **Objetivo:** Modernizar, refinar ou ajustar a identidade visual da plataforma Ald-a para melhorar a experiência do usuário e o apelo estético.
*   **Estratégias Potenciais:**
    *   Definir (ou redefinir) a paleta de cores primárias, secundárias e de acento.
    *   Avaliar a tipografia e o espaçamento para consistência e legibilidade.
    *   Atualizar os componentes da UI (Shadcn/ui, Tailwind CSS) para refletir a nova paleta e diretrizes visuais.
    *   Considerar a contratação ou consulta com um designer UX/UI para um resultado profissional.

### 4.3. Deploy da Aplicação em Ambiente de Produção
*   **Objetivo:** Publicar o Ald-a em um ambiente de produção acessível, estável, seguro e escalável.
*   **Considerações e Estratégias Potenciais:**
    *   **Hospedagem do Frontend (React/Vite):** Plataformas como Vercel, Netlify, ou AWS Amplify são excelentes para deploy de aplicações frontend estáticas/SPA, oferecendo CI/CD, CDN global e fácil configuração.
    *   **Hospedagem do Backend (Node.js/Express):**
        *   **PaaS (Platform as a Service):** Opções como Heroku, Render.com, ou Google App Engine podem simplificar o deploy e o gerenciamento.
        *   **Contêineres:** Dockerizar a aplicação backend e usar serviços como AWS ECS, AWS Fargate, Google Cloud Run, ou Azure Container Apps para escalabilidade e gerenciamento.
        *   **Servidores Virtuais (VPS/EC2):** Maior controle, mas também maior responsabilidade de gerenciamento.
        *   **Replit:** O Replit pode suportar deployments básicos, mas para uma aplicação de produção robusta, geralmente se opta por plataformas mais especializadas.
    *   **Banco de Dados:** NeonDB (PostgreSQL serverless) já é uma boa escolha para produção devido à sua escalabilidade e gerenciamento.
    *   **Armazenamento de Arquivos:** AWS S3 (já em uso) e Google Cloud Storage (integrado para OCR) são soluções de produção robustas.
    *   **Variáveis de Ambiente e Secrets:** Gerenciamento seguro de chaves de API, senhas de banco de dados e outras configurações sensíveis específicas para o ambiente de produção (usando os sistemas de secrets da plataforma de hospedagem).
    *   **Build de Produção:** Configurar scripts de build otimizados para produção (minificação, tree-shaking, etc.) para frontend e backend.
    *   **Domínio Customizado e SSL:** Configurar um domínio próprio e certificado SSL.
    *   **CI/CD (Integração Contínua / Deploy Contínuo):** Configurar pipelines para automatizar testes e deploys para produção a partir de um repositório Git (ex: GitHub Actions, GitLab CI, Jenkins, ou serviços da plataforma de hospedagem).
    *   **Monitoramento e Logging:** Implementar ferramentas de monitoramento de performance da aplicação (APM), logging centralizado e alertas para o ambiente de produção.
    *   **Backups:** Garantir que o banco de dados (NeonDB geralmente gerencia isso) e arquivos críticos (se houver algum não facilmente recriável) tenham políticas de backup.

## 5. Desafios Atuais Gerais (Além do Upload Inteligente)

*   **(Seção existente do seu arquivo original sobre instabilidade de modelos SAM, qualidade de ROI, etc., pode ser mantida e atualizada aqui).**
*   Bugs de tipo Drizzle e erros de linter (conforme listados anteriormente no `PROJECT_PLAN.MD`).

*(Este documento será atualizado conforme o projeto evolui.)*
