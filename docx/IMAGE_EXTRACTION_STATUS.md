# Status e Próximos Passos: Extração de Imagens de Catálogos PDF Artísticos

Data: 27 de Maio de 2024 (Exemplo)

## 1. Objetivo da Funcionalidade

A extração de imagens visuais dos produtos é fundamental quando os catálogos são fornecidos em um formato de "PDF Artístico" (visual) separado de uma "Planilha de Preços" (dados). Essas imagens são cruciais para:
-   Associação correta entre o produto descrito no PDF e sua representação visual.
-   Cálculo de embeddings visuais (ex: com CLIP) para funcionalidades de busca visual ou recomendações.
-   Exibição adequada dos produtos na interface do usuário (dashboard, detalhes do produto, orçamentos).

## 2. Abordagem Tentada: `pdf-export-images` (Node.js)

-   **Descrição:** Uma biblioteca Node.js que visa extrair imagens de arquivos PDF.
-   **Tentativas de Integração:** Foi integrada ao fluxo de processamento de PDF em `server/catalog-processor.ts`.
-   **Resultado:** Nos testes realizados com os catálogos PDF do projeto, a biblioteca não conseguiu extrair as imagens dos produtos de forma eficaz. Os logs indicaram que ou nenhuma imagem era encontrada, ou as imagens extraídas não correspondiam aos produtos visíveis.
-   **Conclusão:** Avaliou-se que `pdf-export-images` pode não ser robusta o suficiente para a complexidade e variedade dos PDFs artísticos do projeto, ou pode haver incompatibilidades específicas com o formato das imagens embutidas nesses arquivos ou com o ambiente de execução.

## 3. Abordagem Proposta e em Andamento: `PyMuPDF` (Python)

Devido aos desafios com a solução Node.js, optou-se por uma abordagem utilizando Python, que geralmente oferece bibliotecas mais maduras e poderosas para manipulação de PDFs.

-   **Justificativa para PyMuPDF:** A biblioteca `PyMuPDF (fitz)` é reconhecida por sua alta performance e capacidades avançadas na extração direta de objetos de imagem e texto de arquivos PDF, sendo uma forte candidata para lidar com os catálogos complexos.
-   **Status da Implementação:**
    -   **Configuração do Ambiente Python (✅ Concluído):**
        -   Arquivo `requirements.txt` criado na raiz do projeto com a dependência `PyMuPDF`.
        -   Arquivo `replit.nix` (configuração de ambiente do Replit) atualizado para incluir `pkgs.python311` e `pkgs.python311Packages.pip`, assegurando a disponibilidade do Python 3.11 e do gerenciador de pacotes pip.
        -   Arquivo `.replit` (configuração do Replit) modificado para adicionar o comando `onBoot = "pip install -r requirements.txt"`, automatizando a instalação das dependências Python na inicialização do contêiner.
    -   **Script Python de Extração (`server/python_scripts/extract_pdf_images.py`) (✅ Concluído):**
        -   Um script Python foi desenvolvido utilizando `PyMuPDF`.
        -   **Funcionalidade:**
            1.  Recebe dois argumentos da linha de comando: o caminho do arquivo PDF de entrada e o caminho para um diretório de saída para as imagens.
            2.  Abre o PDF usando `fitz.open()`.
            3.  Cria o diretório de saída, se não existir.
            4.  Itera por todas as páginas do PDF.
            5.  Para cada página, utiliza `page.get_images(full=True)` para listar as referências de imagens.
            6.  Para cada referência, `doc.extract_image(xref)` é usado para obter os bytes da imagem e sua extensão original.
            7.  As imagens são salvas no diretório de saída com nomes padronizados (ex: `page<N>_img<I>.<ext>`).
            8.  Ao final, o script imprime no `stdout` um objeto JSON contendo `{ "success": true, "images": [...] }` com uma lista de dicionários, cada um descrevendo uma imagem extraída (página, nome do arquivo, caminho local, extensão), ou `{ "error": "mensagem" }` em caso de falha.
    -   **Integração com `server/catalog-processor.ts` (🚧 Desafio Atual / Em Andamento):**
        -   **Objetivo:** No fluxo de processamento de PDF artístico (`processCatalogInBackground` dentro do `if (uploadMode === 'artistic_plus_pricing' && fileType === 'pdf')`), após o OCR e a extração inicial de produtos baseados em texto:
            1.  Chamar o script `extract_pdf_images.py` usando `child_process.spawn` do Node.js.
            2.  Passar o caminho do PDF baixado localmente e um caminho para um diretório temporário de imagens (ex: `temp_pdf_images/<catalogId>/`).
            3.  Capturar a string JSON do `stdout` do script Python.
            4.  Fazer o parse do JSON para obter a lista de informações das imagens extraídas.
        -   **Problema Encontrado:** Foram encontradas dificuldades significativas ao tentar aplicar as edições de código necessárias no arquivo `server/catalog-processor.ts` utilizando a ferramenta de edição assistida por IA. Múltiplas tentativas levaram a:
            *   Não aplicação das mudanças.
            *   Aplicação parcial das mudanças.
            *   Introdução de novos erros de linter ou quebra de lógica existente.
        -   **Estado Atual da Integração:** O bloco de código TypeScript para realizar a chamada ao script Python, gerenciar o processo filho, tratar o `stdout` e `stderr`, e parsear o resultado JSON foi desenvolvido e refinado. No entanto, sua aplicação bem-sucedida e estável no arquivo `server/catalog-processor.ts` está pendente.

## 4. Próximos Passos Detalhados (Sugestões para a Equipe)

1.  **Finalizar a Integração do Script Python em `server/catalog-processor.ts`:**
    *   **Ação Imediata:** Revisar o bloco de código TypeScript proposto anteriormente para a integração com `extract_pdf_images.py`.
    *   **Aplicar Manualmente (Recomendado):** Dada a instabilidade da ferramenta de edição para este caso, recomenda-se aplicar este bloco de código manualmente no local correto dentro de `processCatalogInBackground` (após a extração de produtos do OCR e antes da lógica de fusão de preços).
    *   **Verificar Dependências:** Garantir que `spawn` de `child_process` e `fsPromises` (de `node:fs/promises`) estejam corretamente importados no topo do arquivo. Assegurar que as interfaces TypeScript `PythonImageExtractionResult` e `ExportedPdfImage` estejam definidas ou importadas.
    *   **Local de Inserção:** Conforme indicado anteriormente, após o loop que salva `savedLocalProducts` e antes de qualquer processamento do `pricingFileS3Key`.

2.  **Testar a Extração de Imagens com PyMuPDF:**
    *   Após a integração manual, realizar um ciclo de upload de catálogo (PDF artístico + planilha de preços).
    *   **Verificar Logs:**
        *   Confirmação de que o script Python é chamado (`Chamando script Python para extrair imagens...`).
        *   Sucesso ou erro na execução do script Python (código de saída, mensagens no `stderr`).
        *   Parse da saída JSON do script (`imagens extraídas pelo Python` ou erros de parse/script).
        *   Logs das informações de cada imagem extraída (`[BG Proc ... - Imagem Extraída] ...`).
        *   Conteúdo da pasta temporária `temp/pdf_images/<catalogId>/` para inspecionar as imagens salvas.

3.  **Implementar Upload das Imagens Extraídas para o S3:**
    *   No callback de sucesso da chamada do script Python (onde `result.success && result.images` é verdadeiro), iterar sobre `result.images`.
    *   Para cada `imgInfo` da lista:
        *   Construir uma chave S3 única e descritiva (ex: `users/<userId>/catalogs/<catalogId>/pdf_images/page<N>_img<I>.<ext>` ou usando `imgInfo.filename`).
        *   Fazer upload do arquivo `imgInfo.filepath` (caminho local da imagem extraída) para o S3 usando a função `uploadFileToS3` (ou similar, adaptando para `uploadBufferToS3` se preferir ler o arquivo para um buffer primeiro).
        *   Armazenar a URL do S3 retornada junto com outras informações relevantes (`originalPage`, `originalName`) na variável `allExtractedPdfImagesInfo`.

4.  **Desenvolver Lógica de Associação Inteligente Imagem-Produto:**
    *   Esta é a etapa mais desafiadora e crucial pós-extração. O objetivo é popular o campo `imageUrl` dos `savedLocalProducts`.
    *   **Estratégias a Considerar:**
        *   **Proximidade de Página:** Se um produto foi extraído predominantemente do texto da página X, imagens da página X (ou X-1, X+1) são candidatas mais fortes.
        *   **Contagem e Ordem:** Se uma página contém um produto e uma imagem, a associação pode ser direta (com ressalvas para layouts complexos).
        *   **Análise de Layout (Avançado):** Se no futuro o OCR puder fornecer coordenadas de blocos de texto e imagens, a proximidade espacial seria um forte indicador.
        *   **Embeddings Visuais (CLIP):**
            *   Gerar embedding CLIP para cada imagem PDF extraída.
            *   Se os produtos extraídos do OCR tiverem descrições textuais boas, gerar embedding textual para elas.
            *   Calcular similaridade cosseno entre embeddings de imagem e texto.
            *   *Desafio:* Imagens de PDF podem ser pequenas ou de baixa qualidade para CLIP se forem recortes de logos ou elementos gráficos menores.
        *   **Heurísticas Baseadas em Nomes:** Se o nome do arquivo da imagem (improvável de ser útil diretamente de `PyMuPDF`) ou algum metadado puder ser extraído e correlacionado com o nome do produto.
    *   **Iteração:** Começar com heurísticas mais simples (ex: associação por página) e refinar.

5.  **Atualizar Produtos no Banco de Dados com Imagens:**
    *   Após uma associação bem-sucedida, chamar `storage.updateProductImage(productId, s3Url, clipEmbedding)` (ou uma função `storage.updateProduct` mais genérica) para salvar a `imageUrl`.
    *   Posteriormente, gerar e salvar o `clipEmbedding` para a imagem S3 associada.

6.  **Limpeza de Arquivos Temporários:**
    *   Garantir que o diretório `localTempPdfImagesDir` seja completamente removido no bloco `finally` de `processCatalogInBackground`.

## 5. Considerações sobre Robustez e Alternativas Futuras

-   **Qualidade das Imagens Extraídas:** Avaliar a qualidade e o formato das imagens que `PyMuPDF` extrai. Algumas podem ser máscaras, ícones pequenos ou imagens de fundo, necessitando de filtragem.
-   **PDFs Protegidos ou Vetoriais Complexos:** Testar com uma variedade de PDFs. PDFs muito complexos ou com gráficos vetoriais interpretados como "imagens" podem exigir ajustes.
-   **Revisitar Pipeline Avançado:** Se a combinação OCR + `PyMuPDF` ainda não cobrir todos os casos de layout de PDF de forma satisfatória para a associação imagem-produto, o pipeline mais avançado (envolvendo `layoutparser`, OCR em blocos, etc., conforme documentado no `PROJECT_PLAN.md` e `ALDA_PROJET_ROADMAP_OVERVIEW.MD`) deve ser considerado como a próxima grande evolução.

Esta documentação deve fornecer um bom ponto de partida para a equipe continuar o desenvolvimento desta funcionalidade. 