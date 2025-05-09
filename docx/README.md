# Ald-a - Sistema de Catálogo e Orçamento

## 1. Introdução

Este documento descreve a arquitetura, funcionalidades e estrutura do projeto Ald-a.

**O que é?**
Ald-a é um sistema web projetado para auxiliar lojas de móveis, designers de interiores e arquitetos no gerenciamento de catálogos de produtos e na geração de orçamentos personalizados para clientes.

**Objetivo:**
O objetivo principal é otimizar o fluxo de trabalho, centralizando informações de produtos, automatizando a extração de dados de catálogos (muitas vezes em formatos variados como Excel e PDF) e facilitando a criação de propostas comerciais (orçamentos) e materiais visuais (moodboards).

**Público-alvo:**
Lojas de móveis, representantes comerciais, designers de interiores, arquitetos e profissionais que trabalham com um grande volume de produtos e necessitam gerar orçamentos frequentemente.

## 2. Funcionalidades Principais

*   **Upload e Processamento de Catálogos:**
    *   Permite o upload de catálogos em formatos Excel (.xlsx, .xls), PDF e Imagens (JPG, PNG).
    *   **Extração Inteligente (Motor Principal):** Utiliza uma combinação de análise estruturada (para Excel) e Inteligência Artificial (OpenAI GPT-4o Vision e Texto) para extrair automaticamente informações dos produtos (nome, código, preço, descrição, categoria, materiais, dimensões, etc.).
    *   Lógica específica para otimizar a extração de formatos conhecidos (ex: Fratini).
    *   Processamento em background para catálogos grandes, permitindo que o usuário continue navegando.
    *   Extração e associação de imagens embutidas em arquivos Excel.
*   **Enriquecimento com IA:** Oferece a opção de usar IA para aprimorar os dados extraídos, corrigindo nomes, descrições, inferindo categorias e materiais.
*   **Visualização e Busca de Produtos:**
    *   Dashboard centralizado para visualização de todos os produtos importados.
    *   Filtros avançados por categoria, cor, material, faixa de preço, etc.
    *   Busca textual por nome, código ou descrição.
    *   Funcionalidade de Busca Visual por IA (permite enviar uma imagem para encontrar produtos similares).
*   **Geração de Orçamentos:**
    *   Interface para selecionar produtos do catálogo e adicioná-los a um orçamento.
    *   Permite definir quantidade, cores e outros detalhes por item.
    *   Cálculo automático de subtotais e total.
    *   Opção para aplicar descontos (ex: pagamento à vista).
    *   Geração de PDF do orçamento final, incluindo:
        *   Logo e informações da empresa (configuráveis no perfil).
        *   Dados do cliente e arquiteto.
        *   Lista de produtos com imagens, detalhes e preços.
        *   Cálculo detalhado (subtotal, desconto, total).
        *   Condições de pagamento, observações e prazo de entrega.
        *   Termos de validade e data de emissão.
*   **Gerenciamento de Perfil:**
    *   Permite que o usuário (empresa) configure suas informações (nome, endereço, telefone, CNPJ).
    *   Upload e gerenciamento do logo da empresa.
    *   Definição de condições de pagamento padrão, validade de orçamento e percentual de desconto à vista.
*   **(Outras Funcionalidades - A verificar/detalhar):**
    *   Geração de Moodboards.
    *   Design com IA.
        *   **Objetivo:** Permitir que o usuário faça upload de um render de ambiente com móveis fictícios e/ou uma planta baixa do cliente.
        *   A IA analisará a imagem (render) para identificar móveis.
        *   O sistema sugerirá produtos similares do catálogo da loja, usando uma combinação de análise textual e similaridade visual (embeddings).
        *   (Futuro) A IA poderá ajudar a posicionar os móveis selecionados na planta baixa do cliente.
        *   **Status:** Em desenvolvimento (Backend inicial e Frontend básico criados, mas com bloqueios atuais).

## 3. Estrutura do Projeto

O projeto segue uma estrutura monorepo (ou similar) com separação clara entre frontend e backend:

*   `client/`: Contém o código do frontend.
    *   `src/`: Código fonte React/TypeScript.
        *   `pages/`: Componentes de página (Dashboard, Catálogos, Perfil, etc.).
        *   `components/`: Componentes reutilizáveis da UI (Cards, Formulários, Tabelas, etc.).
        *   `lib/`: Funções utilitárias, hooks, configuração de API client, autenticação.
        *   `assets/`: Arquivos estáticos (imagens, fontes).
*   `server/`: Contém o código do backend.
    *   `index.ts`: Ponto de entrada do servidor Express.
    *   `routes.ts`: Definição das rotas principais da API (`/backend/...`).
    *   `storage.ts`: Abstração do banco de dados (interage com Drizzle/Neon).
    *   `db.ts`: Configuração da conexão com o banco de dados (Neon/PostgreSQL).
    *   `s3-service.js`: Funções para interagir com o AWS S3 (uploads, downloads).
    *   `catalog-processor.ts`: Orquestrador principal do processamento de catálogos em background.
    *   `ai-*.ts`/`.js`: Módulos relacionados à interação com APIs de IA (OpenAI).
    *   `pdf-*.ts`: Módulos para geração de PDF de orçamentos (`pdf-lib`).
    *   `python-scripts/`: Scripts Python auxiliares (ex: extração de imagem do Excel).
    *   `templates/`: Templates HTML (ex: para PDF via Puppeteer, se habilitado).
*   `shared/`: Contém código compartilhado entre frontend e backend (ex: schemas Drizzle, tipos).
*   `uploads/`: (Pode ser usado localmente ou como diretório temporário) Armazena arquivos enviados ou extraídos temporariamente.
*   `temp/`: Diretório para arquivos temporários gerados durante o processamento.
*   `public/`: Arquivos estáticos servidos diretamente (ex: `placeholder.png`).
*   `docx/`: Contém esta documentação.
*   Arquivos de Configuração: `package.json`, `tsconfig.json`, `vite.config.ts`, `drizzle.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.env` (não versionado), `replit.nix`, `.replit`.

## 4. Tecnologias e Dependências Principais

**Frontend:**

*   **Framework/Lib:** React
*   **Linguagem:** TypeScript
*   **Build Tool:** Vite
*   **Gerenciamento de Estado/Cache:** TanStack Query (`@tanstack/react-query`)
*   **UI:** Shadcn/ui (baseado em Radix UI e Tailwind CSS)
*   **Estilização:** Tailwind CSS
*   **Roteamento:** Wouter

**Backend:**

*   **Runtime:** Node.js
*   **Framework:** Express
*   **Linguagem:** TypeScript (executado com TSX)
*   **Banco de Dados:** PostgreSQL (Serverless via NeonDB)
*   **ORM:** Drizzle ORM
*   **Sessões:** `express-session` com `connect-pg-simple`
*   **Autenticação:** Hash de senhas com `bcrypt`
*   **Upload de Arquivos:** Multer, Multer-S3
*   **Interação com AWS S3:** `@aws-sdk/client-s3`
*   **Geração de PDF:** `pdf-lib` (principal), (`puppeteer`, `html-pdf` - como alternativas/desabilitados)
*   **Processamento Excel:** `xlsx`
*   **Processamento ZIP (Imagens Excel):** `jszip` (ou script Python externo)
*   **Inteligência Artificial:** OpenAI API (`openai` SDK - GPT-4o, Vision)

**Ambiente:**

*   **Hospedagem/Desenvolvimento:** Replit
*   **Gerenciador de Pacotes:** npm

## 5. Como Rodar (Desenvolvimento no Replit)

1.  **Fork/Clone:** Obtenha uma cópia do projeto no seu ambiente Replit.
2.  **Secrets (Variáveis de Ambiente):** Configure as variáveis de ambiente necessárias na aba "Secrets" do Replit. As variáveis essenciais são:
    *   `DATABASE_URL`: Connection string do banco de dados Neon.
    *   `AWS_ACCESS_KEY_ID`: Chave de acesso da AWS para o S3.
    *   `AWS_SECRET_ACCESS_KEY`: Chave secreta da AWS para o S3.
    *   `AWS_S3_BUCKET_NAME`: Nome do bucket S3.
    *   `AWS_REGION`: Região do bucket S3 (ex: `us-east-1`).
    *   `OPENAI_API_KEY`: Chave da API da OpenAI.
    *   `SESSION_SECRET`: Segredo para assinar os cookies de sessão.
3.  **Instalar Dependências:** Abra o "Shell" e execute `npm install`.
4.  **Rodar Migrations (se necessário):** Execute `npm run db:push` para garantir que o schema do banco de dados esteja atualizado (geralmente feito automaticamente ao iniciar).
5.  **Iniciar Servidor de Desenvolvimento:** Execute `npm run dev`. Isso iniciará o servidor backend Node.js e o servidor de desenvolvimento Vite para o frontend.
6.  **Acessar:** Abra a URL fornecida pelo Replit em seu navegador.

## 6. Motor Principal: Upload e Extração de Catálogos

Este é o coração do sistema e envolve várias etapas:

1.  **Upload (Frontend):** O usuário seleciona ou arrasta um arquivo (Excel, PDF, Imagem) no componente de upload (`client/.../upload-card.tsx` ou similar).
2.  **Requisição API (Frontend -> Backend):** O arquivo é enviado via `POST` para a rota `/backend/catalogs/upload`.
3.  **Recepção e Armazenamento Inicial (Backend - Rota):**
    *   A rota `/backend/catalogs/upload` (em `server/routes.ts`) usa o middleware `multer` (configurado com `multer-s3`) para receber o arquivo e enviá-lo diretamente para o AWS S3.
    *   Uma entrada para o novo catálogo é criada na tabela `catalogs` do banco de dados com status "processing", armazenando metadados e a URL/chave S3 do arquivo.
4.  **Disparo do Processo em Background:** A rota *não espera* o processamento terminar. Ela chama a função `processCatalogInBackground` (de `server/catalog-processor.ts`) de forma assíncrona (sem `await`) e retorna uma resposta de sucesso (201) para o frontend imediatamente.
5.  **Processamento em Background (`processCatalogInBackground`):**
    *   **Download:** Baixa o arquivo do S3 para um diretório local temporário (`/temp`).
    *   **Atualiza Status:** Marca o catálogo como "processing" no banco (redundante, mas garante).
    *   **Leitura do Arquivo (Exemplo Excel):** Usa a biblioteca `xlsx` para ler o conteúdo do arquivo Excel baixado.
    *   **Extração de Dados com IA:**
        *   Divide os dados do Excel em blocos (`CHUNK_SIZE`).
        *   Para cada bloco, chama `processExcelWithAI` (de `server/ai-excel-processor.js`).
        *   `processExcelWithAI` envia os dados do bloco para a API da OpenAI (GPT-4o) com um prompt específico e **recentemente refinado** para identificar colunas relevantes e extrair informações estruturadas dos produtos (nome, código, preço, **categoria**, **cores**, **materiais**, **dimensões/sizes (incluindo string original no label)**, etc.), com maior capacidade de inferência a partir de nomes e descrições.
    *   **Salvar Produtos:** Os produtos válidos retornados pela IA são salvos na tabela `products` do banco de dados, associados ao `catalogId`.
    *   **Extração de Imagens (Python):** Chama o script `server/python-scripts/extract_images_by_row.py` passando o caminho do arquivo Excel local. Este script usa `openpyxl` para extrair as imagens embutidas e suas linhas de âncora, retornando os dados da imagem (base64) e a linha.
    *   **Upload de Imagens:** As imagens extraídas pelo Python são enviadas individualmente para o S3 (na pasta `users/:userId/catalogs/:catalogId/images/`) usando `uploadBufferToS3`.
    *   **Associação Inteligente de Imagens:**
        *   Para cada produto salvo, busca as imagens que foram extraídas da mesma linha do Excel.
        *   Usa a IA de Visão da OpenAI (`verifyImageMatchWithVision` de `ai-excel-processor.js`) para comparar a imagem candidata com os detalhes do produto e confirmar se é um "match".
        *   Se houver *exatamente um* match confirmado pela IA na linha, associa a imagem ao produto.
        *   Se a IA não confirmar, mas houver *exatamente uma* imagem não utilizada na linha, usa um **fallback** e associa essa imagem.
        *   Atualiza o campo `imageUrl` do produto no banco de dados com a URL da imagem associada no S3.
    *   **Atualizar Status Final:** Se todo o processo ocorrer sem erros fatais, atualiza o status do catálogo para "completed".
    *   **Tratamento de Erros:** Se ocorrer um erro em qualquer etapa crítica, o status do catálogo é atualizado para "failed" e a mensagem de erro é registrada. **(Nota: O tratamento de erros nas rotas da API foi centralizado usando um middleware global para consistência e melhor logging - ver `server/routes.ts`)**.
    *   **Limpeza:** Exclui o arquivo Excel temporário baixado do S3.
6.  **Processamento de PDF/Imagem:** Existem fluxos similares (ex: `pdf-ai-pipeline.ts`, `advanced-ai-extractor.ts`) que usam OCR ou diretamente a API de Visão para extrair dados de PDFs e imagens, seguindo uma lógica parecida de processamento e salvamento. **(Nota: Os prompts para PDF/Imagem podem precisar de refinamentos semelhantes aos aplicados no Excel para extrair categoria, cores, materiais e dimensões com mais precisão)**.

## 7. Atualização da Documentação

**Nota:** Este documento é um resumo gerado por IA com base no estado atual do código e na conversa. Ele pode ser atualizado em interações futuras com o assistente AI (Cursor/Gemini) conforme o projeto evolui. Peça ao assistente para "atualizar a documentação do projeto" após realizar mudanças significativas. 