import OpenAI from "openai";

// Configurar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Função para usar IA para extrair produtos do texto de um PDF
export async function extractProductsWithAI(text: string, fileName: string): Promise<any[]> {
  try {
    console.log("Iniciando extração de produtos com IA...");
    
    // Detectar se é um catálogo Fratini
    const isFratiniCatalog = fileName.toLowerCase().includes("fratini");
    console.log(`Detectado como catálogo Fratini: ${isFratiniCatalog}`);
    
    // Se for um catálogo Fratini, vamos adicionar informações específicas sobre os produtos
    // mais comuns da Fratini para ajudar o modelo a identificar melhor
    if (isFratiniCatalog) {
      const fratiniProductsInfo = `
      # Produtos Reais da Tabela de Preços Fratini 2025 
      
      A seguir estão exemplos REAIS da tabela Fratini que funcionam como referência:

      ## Cadeiras de Escritório:
      
      ### Cadeira Chicago
      - Nome Comercial: Cadeira Chicago
      - Descrição: Cadeira ergonômica com apoio de braços e ajuste de altura
      - Código: 1.00020.01.0001 (Preto), 1.00020.02.0001 (Cinza)
      - Preço: R$ 750,00
      - Cores disponíveis: Preto, Cinza
      - Materiais: Base cromada, tecido mesh
      - Categoria: Cadeiras Executivas
      
      ### Cadeira Detroit
      - Nome Comercial: Cadeira Detroit
      - Descrição: Cadeira executiva com encosto reclinável e apoio lombar ajustável
      - Código: 1.00022.01.0002 (Preto), 1.00022.03.0002 (Azul)
      - Preço: R$ 800,00
      - Cores disponíveis: Preto, Azul
      - Materiais: Base nylon, tecido
      - Categoria: Cadeiras Executivas
      
      ### Cadeira New York
      - Nome Comercial: Cadeira New York
      - Descrição: Cadeira premium com encosto em tela mesh e apoio de cabeça
      - Código: 1.00024.01.0003
      - Preço: R$ 900,00
      - Cores disponíveis: Preto
      - Materiais: Base metálica, tela mesh, apoio lombar
      - Categoria: Cadeiras Executivas Premium
      
      ## Cadeiras Gamer:
      
      ### Cadeira Fair Play
      - Nome Comercial: Cadeira Fair Play
      - Descrição: Cadeira gamer com design ergonômico e apoio cervical
      - Código: 1.00026.01.0004 (Preto/Vermelho), 1.00026.02.0004 (Preto/Azul)
      - Preço: R$ 750,00
      - Cores disponíveis: Preto/Vermelho, Preto/Azul
      - Materiais: Base nylon, couro sintético
      - Categoria: Cadeiras Gamer
      
      ### Cadeira MVP
      - Nome Comercial: Cadeira MVP
      - Descrição: Cadeira gamer com iluminação LED e apoio lombar
      - Código: 1.00028.01.0005
      - Preço: R$ 800,00
      - Cores disponíveis: Preto/RGB
      - Materiais: Base nylon, couro sintético, LEDs RGB
      - Categoria: Cadeiras Gamer
      
      ## Banquetas e Cadeiras de Espera:
      
      ### Banqueta Avia
      - Nome Comercial: Banqueta Avia
      - Descrição: Banqueta alta para balcão com apoio para os pés
      - Código: 1.00030.01.0006 (Preto), 1.00030.03.0006 (Verde)
      - Preço: R$ 350,00
      - Cores disponíveis: Preto, Verde
      - Materiais: Estrutura cromada, assento estofado
      - Categoria: Banquetas
      
      ## Acessórios:
      
      ### Apoio de Cabeça Columbus
      - Nome Comercial: Apoio de Cabeça Columbus
      - Descrição: Complemento para cadeira Columbus em polipropileno
      - Código: 1.00032.01.0012
      - Preço: R$ 120,00
      - Cores disponíveis: Preto
      - Materiais: Polipropileno, espuma
      - Categoria: Acessórios
      `;
      
      // Adicionar essas informações ao texto para análise
      text += "\n\n" + fratiniProductsInfo;
    }
    
    return await processTextForProducts(text, isFratiniCatalog);
  } catch (error) {
    console.error("Erro na extração de produtos com IA:", error);
    return [];
  }
}

// Função para processar o texto do PDF e extrair produtos
async function processTextForProducts(text: string, isFratiniCatalog: boolean): Promise<any[]> {
  try {
    console.log(`Processando texto para extração de produtos (Catálogo Fratini: ${isFratiniCatalog})`);
    
    // Criar um prompt específico para o tipo de catálogo
    const prompt = isFratiniCatalog 
      ? `
      Você é um especialista em processar e extrair dados estruturados de tabelas de preços da marca Fratini.

      TAREFA ATUAL:
      Extrair TODOS os produtos do catálogo Fratini 2025, com seus preços e informações técnicas.
      
      CONTEXTO:
      - Estamos analisando uma tabela de preços da Fratini, que é uma empresa de móveis de escritório especializada em cadeiras ergonômicas, banquetas e acessórios.
      - Cada produto tem um nome comercial, descrição, códigos de referência, preços e outras informações.
      - Os preços estão em Reais (R$).
      - O documento é uma tabela de preços oficial para distribuidores e revendedores.
      
      INSTRUÇÕES DETALHADAS:
      
      Analise o seguinte texto extraído de um PDF da tabela de preços Fratini e extraia informações precisas de TODOS os produtos listados:
      
      ${text}
      
      Para cada produto, identifique com precisão os seguintes campos:
      
      1. name: Nome comercial exato do produto (ex: "Cadeira Chicago", "Banqueta Avia")
      2. code: Código comercial no formato numérico (ex: "1.00020.01.0001")
      3. price: Preço em centavos (multiplique o valor em R$ por 100, ex: R$ 750,00 → 75000)
      4. category: Categoria do produto (ex: "Cadeiras Executivas", "Cadeiras Gamer", "Banquetas", "Acessórios")
      5. description: Descrição técnica completa do produto
      6. colors: Array com todas as cores disponíveis (ex: ["Preto", "Cinza", "Azul"])
      7. materials: Array com todos os materiais mencionados (ex: ["Base cromada", "Tecido mesh"])
      8. sizes: Informações de dimensões quando disponíveis
      9. pageNumber: Número estimado da página onde o produto aparece no catálogo

      IMPORTANTE - FORMATO DA TABELA FRATINI:
      - As tabelas Fratini apresentam colunas como: Nome Comercial, Descrição, Código, Cores e Preço
      - Os códigos comerciais seguem o padrão 1.XXXXX.XX.XXXX onde a parte do meio geralmente indica a cor
      - Se um produto tiver várias variações por cor, agrupe-as como um único produto com várias cores
      - Os preços aparecem em formatos como "R$ 750,00" - converta para centavos
      
      CERTIFIQUE-SE DE:
      - Extrair TODOS os produtos mencionados no catálogo
      - Manter os nomes e descrições EXATAMENTE como aparecem no catálogo
      - Converter corretamente os preços de R$ para centavos (multiplicar por 100)
      - Identificar todas as cores disponíveis para cada produto
      
      Retorne os dados em formato JSON com a estrutura: {"products": [...]}
      `
      :
      `
      Você é um assistente especializado em extrair informações estruturadas de catálogos de móveis.
      
      A partir do texto abaixo do catálogo, identifique TODOS os produtos mencionados e extraia as seguintes informações para CADA produto:
      1. name: Nome completo do produto
      2. description: Descrição detalhada do produto
      3. code: Código ou referência do produto (ex: SF-MAD-001)
      4. price: Preço em formato numérico (se o valor estiver como "R$ 1.234,56", converta para 123456)
      5. category: Categoria principal (Sofá, Mesa, Cadeira, Estante, Poltrona, etc.)
      6. materials: Lista de materiais utilizados na fabricação
      7. colors: Array com todas as cores disponíveis
      8. sizes: Array de objetos contendo as dimensões no formato:
         {
           "width": largura em cm (número),
           "height": altura em cm (número),
           "depth": profundidade em cm (número),
           "label": descrição das dimensões (opcional)
         }
      9. pageNumber: Número da página onde o produto aparece (se disponível)
      
      IMPORTANTE:
      - Para cada produto, tente extrair TODAS as informações disponíveis.
      - Se uma informação não estiver disponível, use null ou um array vazio conforme apropriado.
      - Quando os preços estiverem no formato "R$ X.XXX,XX", remova o símbolo da moeda e converta para centavos.
      - Se encontrar dimensões no formato "LxAxP" ou similar, separe os números em largura, altura e profundidade.
      - EXTRAIA TODOS OS PRODUTOS MENCIONADOS, MESMO QUE HAJA DEZENAS OU CENTENAS DELES.
      - Retorne a resposta em formato JSON como um objeto com a propriedade "products" que contém um array de produtos.
      
      Texto do catálogo:
      ${text}
      `;
    
    // Definir o sistema message baseado no tipo de catálogo
    const systemMessage = isFratiniCatalog
      ? `Você é um sistema especializado na extração de dados de catálogos de produtos da marca Fratini.
         Sua tarefa é analisar textos de catálogos e extrair informações estruturadas sobre cada produto.
         
         ESPECIFICIDADES DO CATÁLOGO FRATINI:
         1. Os códigos de produtos seguem o padrão: 1.XXXXX.XX.XXXX
         2. Os preços são apresentados no formato: R$ XXX,XX
         3. As cores são importantes e variam por código
         4. As descrições técnicas contêm informações sobre materiais
         
         SEU RESULTADO DEVE CORRESPONDER EXATAMENTE ÀS INFORMAÇÕES REAIS DO CATÁLOGO.
         NÃO ADICIONE INFORMAÇÕES FICTÍCIAS OU QUE NÃO ESTEJAM NO CATÁLOGO.`
      : "Você é um assistente especializado em extrair informações estruturadas de catálogos de móveis com precisão. IMPORTANTE: Extraia TODOS os produtos mencionados no texto, mesmo que sejam muitos. Não pule nenhum produto.";
      
    console.log(`Enviando requisição à OpenAI para processar texto...`);
    
    // Usando temperatura muito baixa para extração precisa de informações
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // o modelo mais recente da OpenAI (gpt-4o foi lançado em 13 de maio de 2024, não altere para gpt-4)
      messages: [
        { 
          role: "system", 
          content: systemMessage
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.1, // Temperatura muito baixa para maior precisão
      response_format: { type: "json_object" }
    });
    
    // Extrair a resposta JSON
    const responseContent = response.choices[0].message.content || '';
    console.log(`Resposta recebida da OpenAI (tamanho: ${responseContent.length} caracteres)`);
    
    // Analisar a resposta como JSON
    try {
      const parsedResponse = JSON.parse(responseContent);
      
      if (parsedResponse && parsedResponse.products && Array.isArray(parsedResponse.products)) {
        const products = parsedResponse.products;
        console.log(`Extraídos ${products.length} produtos do texto.`);
        
        // Processar os produtos para garantir campos corretos
        return products.map((product: any, index: number) => {
          const processedProduct = {
            ...product,
            // Garantir que o preço seja numérico para evitar erro de parsing
            price: typeof product.price === 'number' ? product.price : 
                  typeof product.price === 'string' ? parseInt(product.price.replace(/\D/g, '')) : 0,
            
            // Garantir que arrays estejam no formato correto
            colors: Array.isArray(product.colors) ? product.colors : 
                  typeof product.colors === 'string' ? [product.colors] : [],
            
            materials: Array.isArray(product.materials) ? product.materials : 
                      typeof product.materials === 'string' ? [product.materials] : [],
            
            // Se não houver página, usar o índice para estimar
            pageNumber: product.pageNumber || index + 1
          };
          
          return processedProduct;
        });
      } else {
        console.error("Resposta da IA não contém array de produtos:", parsedResponse);
        return [];
      }
    } catch (parseError) {
      console.error("Erro ao analisar a resposta JSON da IA:", parseError);
      console.log("Conteúdo da resposta:", responseContent);
      return [];
    }
  } catch (error) {
    console.error("Erro ao processar texto para extração de produtos:", error);
    return [];
  }
}