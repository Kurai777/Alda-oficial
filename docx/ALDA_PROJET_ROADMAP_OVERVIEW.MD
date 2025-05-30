# Projeto Ald-a: Documentação de Funcionalidades e Roadmap Estratégico

## 1. Visão Geral do Projeto Ald-a

O Projeto Ald-a visa revolucionar a forma como designers de interiores e clientes interagem com catálogos de móveis. O foco inicial inclui uma funcionalidade robusta de "Upload Inteligente de Catálogos" para processar diversos formatos de arquivos e a funcionalidade de "Design com IA" para transformar renders de ambientes em propostas de design concretas.

O objetivo de longo prazo é expandir para um ecossistema completo, incluindo upload inteligente de catálogos de múltiplos fornecedores, montagem de produtos modulares, geração de moodboards profissionais e orçamentos estratégicos.

## 2. Funcionalidade: Upload Inteligente de Catálogos (Foco Atual Principal)

Esta funcionalidade é crucial para popular o sistema Ald-a com produtos de diferentes fornecedores, cada um com seu formato de catálogo.

### 2.1. Objetivos
- Processar catálogos fornecidos como arquivos Excel completos (contendo todas as informações, incluindo imagens e preços).
- Processar catálogos fornecidos em partes: um "Arquivo Artístico" (geralmente PDF com visuais dos produtos e descrições básicas) e um "Arquivo de Preços" separado (geralmente planilha Excel ou PDF com tabelas de preços).
- Extrair de forma inteligente e precisa os detalhes dos produtos: nome do modelo base, variações de descrição/tamanho, dimensões, categoria, materiais, cores e preços (incluindo variações como classes de acabamento/tecido).
- Associar corretamente as imagens aos seus respectivos produtos (modelo base).
- Armazenar os produtos e suas variações de forma estruturada no banco de dados, permitindo que um modelo base tenha múltiplas variações de tamanho/preço.

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
1.  **Upload:** Usuário faz upload do PDF artístico e da planilha de preços.
2.  **Armazenamento Inicial:** Arquivos são enviados para o AWS S3.
3.  **Processamento do PDF Artístico no Backend (`server/catalog-processor.ts`):**
    *   Download do PDF do AWS S3.
    *   Upload para Google Cloud Storage (GCS) e OCR com Google Cloud Vision API para extrair texto bruto por página.
    *   **Extração de Produtos do Texto OCR via OpenAI (`extractProductsFromTextWithOpenAI`):**
        *   O texto OCR de cada página (até `MAX_PAGES_TO_PROCESS_WITH_OPENAI`) é enviado para a API da OpenAI (GPT-4o).
        *   O prompt foi refinado para extrair detalhes técnicos (descrição, materiais, dimensões, categoria) mesmo de páginas de especificações que não contêm o nome do modelo.
        *   Implementada lógica para capturar um "nome candidato" de páginas que contêm apenas o nome do modelo e aplicá-lo aos detalhes extraídos da página de especificações subsequente.
    *   **Salvamento (Parcial dos Produtos do PDF):** Os produtos extraídos do PDF (com nome do modelo base e detalhes) são salvos na tabela `products` (atualmente sem preço e sem imagem).
4.  **Processamento da Planilha de Preços no Backend (`server/pricing-file-processor.ts`):**
    *   Download da planilha do S3.
    *   **Extração de Itens de Preço com IA (`processPricingFile`):**
        *   O prompt da IA foi refinado para identificar cada linha da planilha como uma variação de produto.
        *   A IA é instruída a extrair:
            *   `name`: O nome completo da variação como aparece na coluna "MODELO" (ex: "BORA C/ASSENTO 0,63").
            *   `model_base`: O nome do modelo principal/família (ex: "BORA").
            *   `variation_description`: A parte descritiva da variação (ex: "C/ASSENTO 0,63" ou da coluna "DESCRIÇÃO" da planilha).
            *   `dimensions` e `priceVariations` (com `class_name` e `price`) para cada linha/variação.
        *   Os resultados são mapeados para a interface `ExtractedPriceItem`.
5.  **Fusão de Dados (`server/catalog-fusion-service.ts` - `fuseCatalogData`):**
    *   **Match por Código:** Tentativa primária (atualmente não aplicável para o catálogo de exemplo, pois não há códigos consistentes).
    *   **Fallback por Nome (Melhorado):**
        *   **1ª Tentativa:** Compara o nome do produto do PDF (ex: "Apgar") com o `model_base` extraído da planilha (ex: "APGAR"). Se houver correspondência exata (após normalização), um match é feito.
        *   **2ª Tentativa (Se a 1ª falhar):** Compara o nome do produto do PDF com o `name` (nome completo da variação) da planilha usando similaridade de Dice (limiar atual de 0.80).
    *   **Atualização de Preço:** Se um match é encontrado, o preço do produto no banco (extraído do PDF) é atualizado com o primeiro preço da primeira classe de preço encontrada para o item correspondente da planilha. *(Limitação atual: não armazena múltiplas variações ou classes de preço no produto final).*

### 2.3. Funcionalidades Implementadas (Estado Atual)
*   Upload de arquivos Excel completos e processamento (incluindo extração de dados textuais, imagens embutidas, associação e embeddings) - **Restaurado e funcionando.**
*   Upload de arquivos PDF artístico e Planilha de Preços separados.
*   Upload do PDF artístico para Google Cloud Storage (GCS).
*   OCR de múltiplas páginas de PDFs (via Google Cloud Vision API e GCS) para extração de texto bruto - **Funcionando.**
*   Extração de produtos do texto OCR via OpenAI (GPT-4o):
    *   Extração de detalhes técnicos de páginas de especificações - **Melhorada.**
    *   Captura e atribuição de nomes de modelo de páginas "capa" para páginas de "especificação" - **Funcionando.**
*   Processamento de planilhas de preços (Excel) via OpenAI (`pricing-file-processor.ts`):
    *   Extração de nome completo da variação, nome do modelo base, descrição da variação, dimensões e variações de preço por classe - **Implementado e em refinamento.**
    *   **NOVO:** Extração de `classDefinitions` (definições de classe de preço, como cores e materiais) pela IA durante a análise estrutural da planilha. Essas definições são salvas no campo `class_definitions` (JSONB) da tabela `catalogs`.
*   Mecanismo de Fusão de Dados (`catalog-fusion-service.ts`):
    *   Match por código (existente).
    *   Fallback por comparação de nome (PDF.name vs Planilha.model_base) - **Implementado.**
    *   Fallback secundário por similaridade de Dice (PDF.name vs Planilha.name completo) - **Implementado.**
    *   **NOVO:** Suporte para relação um-para-muitos entre produtos do PDF e variações da planilha, utilizando a nova tabela `product_variations`.
*   Geração de embeddings textuais para produtos extraídos do PDF.
*   **NOVO (Frontend):**
    *   Exibição de múltiplas variações de produto (tamanho/descrição) e classes de preço nos cards de produto e na página de detalhes.
    *   Seletores (dropdowns) interativos para o usuário escolher a variação e a classe de preço desejada.
    *   Atualização dinâmica do preço do produto conforme a seleção do usuário.
    *   Exibição das definições de classe (ex: cores, materiais como "AMARELO, AREIA") nos seletores.
    *   Na página de detalhes, exibição de bolinhas de cores interativas para classes que especificam cores, com tooltip mostrando o nome da cor.
    *   Padronização da formatação de preços (R$) em todo o frontend, com preços armazenados em centavos no backend.

### 2.4. Desafios Atuais e Pontos de Atenção
*   **Qualidade da Extração da OpenAI (PDF - `extractProductsFromTextWithOpenAI`):**
    *   Garantir que códigos de produto (se presentes no PDF) sejam extraídos.
    *   Processar o catálogo PDF inteiro (além do limite atual de `MAX_PAGES_TO_PROCESS_WITH_OPENAI`).
*   **Qualidade da Extração da OpenAI (Planilha de Preços - `pricing-file-processor.ts`):**
    *   **Principal Ponto de Atenção Atual:** Garantir que a IA extraia consistentemente e corretamente o `model_base` (ex: "Chesterfield I") e o `name` completo da variação para todos os produtos na planilha, especialmente para nomes complexos ou com números romanos. Isso é crucial para o sucesso da fusão.
    *   **Extração e Uso de `classDefinitions`:** A extração básica está funcionando. O foco agora é aprimorar a capacidade da IA de interpretar diversas estruturas de tabelas de legenda/cores e refinar a exibição e interatividade no frontend (já bastante avançado com as bolinhas de cores).
*   **Lógica de Fusão de Preços (`catalog-fusion-service.ts`):**
    *   **Principal Ponto de Atenção Atual:** Investigar por que alguns produtos (ex: "Chesterfield I, II, X") não estão recebendo preços, analisando os `model_base` e `name` extraídos da planilha e como eles se comparam com os nomes do PDF.
    *   **Roadmap Estratégico (Implementado e em Refinamento):** Lidar com a relação "um-para-muitos": um produto base do PDF (ex: "Bora") é associado a TODAS as suas variações de preço/tamanho da planilha (ex: "Bora C/Assento 0,63", "Bora C/Assento 0,83").
        *   Schema do banco de dados modificado com a nova tabela `product_variations` (ligada a `products`) e o campo `class_definitions` (JSONB) na tabela `catalogs`.
        *   `fuseCatalogData` ajustada para criar/atualizar os registros de variação.
        *   `storage` atualizada para salvar/buscar essas variações e definições de classe.
        *   Interface do frontend atualizada para exibir e permitir a seleção dessas variações e suas classes de preço, incluindo suas definições (cores, materiais).
*   **Extração de Imagens de PDF Artístico (`catalog-processor.ts`):**
    *   Tentativa inicial com a biblioteca `pdf-export-images` (Node.js) para extração direta de imagens do PDF artístico. 
    *   **Desafio:** A biblioteca não está performando como esperado para os catálogos de teste, resultando em imagens ausentes ou não correspondentes aos produtos. Isso impede a associação imagem-produto e o cálculo de embeddings visuais para esses catálogos.
    *   **Próxima Ação:** Priorizar a pesquisa e implementação de métodos mais robustos para extração de imagens de PDFs. Isso pode incluir:
        *   Bibliotecas Python especializadas (ex: `PyMuPDF/fitz`, `pdfminer.six` com extração de objetos de imagem).
        *   Ferramentas de processamento de imagem (ex: `OpenCV`) para segmentar imagens em páginas renderizadas do PDF.
        *   Serviços de IA mais avançados para análise de layout e segmentação de objetos (conforme o pipeline avançado já documentado no roadmap).
    *   O objetivo é garantir que cada produto extraído do PDF artístico tenha sua imagem correspondente corretamente identificada e armazenada.
*   **Performance e Custo:** Otimizações podem ser necessárias conforme o volume de dados e o número de chamadas de IA aumentam.

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
*   **NOVO (Estrutura do Banco de Dados - Chave):**
    *   Tabela `product_variations`: Armazena as múltiplas variações (tamanho, descrição específica) de um produto base. Contém `productId` (FK para `products`), `name` (da variação), `variationDescription`, `dimensionsLabel`, `priceClasses` (JSONB com `{className, value}`), `sku`.
    *   Tabela `catalogs`: Adicionado campo `class_definitions` (JSONB) para armazenar as definições de classe (ex: `[{className: "CLASSE 01", definition: {"Cor 1": "AMARELO", "Cor 2": "AREIA"}}]`) extraídas pela IA da planilha de preços.

### 2.6. Próximos Passos Imediatos (Plano para Upload Inteligente de PDF + Planilha)
1.  **Refinar Extração da Planilha de Preços (`pricing-file-processor.ts`):**
    *   Analisar logs do `PricingProcessor` para produtos que não estão tendo `model_base` extraído corretamente (ex: "Chesterfield I").
    *   Ajustar o `systemPrompt` para melhorar a identificação e separação de `model_base`, `name` (completo da variação) e `variation_description`, especialmente para nomes com números romanos ou outras complexidades.
    *   **Aprimorar a IA para interpretar e extrair de forma mais robusta e flexível as `classDefinitions` de diferentes formatos de tabelas de legenda/cores nas planilhas.**
2.  **Verificar Lógica de Fusão (`catalog-fusion-service.ts`):**
    *   Com base nos logs, confirmar se o `product.name` (PDF) está sendo comparado corretamente com `priceItem.model_base` (Planilha).
    *   Analisar os scores de similaridade de Dice para os casos que falham no match direto por `model_base` para ver se o limiar de `0.80` é adequado ou se precisa de ajuste para nomes como "Chesterfield I".
3.  **Aumentar Cobertura do Catálogo PDF:**
    *   Após os refinamentos acima, aumentar o valor de `MAX_PAGES_TO_PROCESS_WITH_OPENAI` em `server/catalog-processor.ts` (ex: para 40, 60, ou remover o limite) para processar mais produtos do arquivo artístico e testar a fusão em maior escala.
4.  **(Roadmap Futuro Principal) Extração de Imagens Visuais de PDFs:** Planejar e implementar a extração das imagens dos produtos de dentro dos arquivos PDF e associá-las aos registros de produtos (modelo base) correspondentes.
5.  **(Roadmap Futuro) Implementar Uso de `classDefinitions`:** Utilizar as definições de classe de preço (extraídas da planilha) para enriquecer os dados do produto ou permitir uma seleção mais informada no frontend.

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
