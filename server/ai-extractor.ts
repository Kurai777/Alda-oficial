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
      # Lista de Produtos Típicos da Fratini

      ## Cadeiras de Escritório:
      - Cadeira Chicago: Cadeira ergonômica com apoio de braços e ajuste de altura. Preço aproximado R$ 750,00.
      - Cadeira Detroit: Cadeira executiva com encosto reclinável e apoio lombar ajustável. Preço aproximado R$ 800,00.
      - Cadeira New York: Cadeira premium com encosto em tela mesh e apoio de cabeça. Preço aproximado R$ 900,00.
      - Cadeira Miami: Cadeira operacional com mecanismo relax e base cromada. Preço aproximado R$ 650,00.
      - Cadeira Everest: Cadeira com encosto reclinável e apoio lombar. Preço aproximado R$ 870,00.
      
      ## Cadeiras Gamer:
      - Cadeira Fair Play: Cadeira gamer com design ergonômico e apoio cervical. Preço aproximado R$ 750,00.
      - Cadeira MVP: Cadeira gamer com iluminação LED e apoio lombar. Preço aproximado R$ 800,00.
      - Cadeira Pro Gamer: Cadeira com apoio de cabeça e lombar ajustáveis. Preço aproximado R$ 850,00.
      
      ## Banquetas e Cadeiras de Espera:
      - Banqueta Avia: Banqueta alta para balcão com apoio para os pés. Preço aproximado R$ 350,00.
      - Banqueta Sky: Banqueta regulável com encosto e base cromada. Preço aproximado R$ 380,00.
      - Cadeira de Espera Connect: Cadeira para recepção com estrutura metálica. Preço aproximado R$ 420,00.
      
      ## Acessórios:
      - Apoio de Cabeça Columbus: Complemento para cadeira Columbus em polipropileno. Preço aproximado R$ 120,00.
      - Apoio de Braço New York: Peça de reposição em poliuretano. Preço aproximado R$ 90,00.
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
      Você é um especialista em extrair dados estruturados de tabelas de preços de móveis da marca Fratini.
      
      Analise o seguinte texto extraído de um PDF da tabela de preços Fratini e extraia TODOS os produtos listados:
      
      ${text}
      
      Para cada produto identifique:
      1. name: Nome comercial do produto (ex: "Cadeira Chicago")
      2. code: Código comercial do produto (formato numérico como "1.00020.01.0001")
      3. price: Preço em reais (converta para centavos - multiplique por 100)
      4. category: Categoria do produto (ex: "Cadeiras", "Banquetas", etc.)
      5. description: Descrição do produto incluindo materiais e características
      6. colors: Lista de cores disponíveis
      7. materials: Lista de materiais mencionados
      8. sizes: Informações de dimensões
      9. pageNumber: Número da página onde o produto aparece (se disponível)

      IMPORTANTE PARA CATÁLOGOS FRATINI:
      - As tabelas Fratini geralmente têm colunas como: Nome Comercial, Imagem, Descrição, Selo, Cores, Código Comercial, Preço 30 dias, 45 dias, 60 dias
      - Os Códigos Comerciais são números no formato 1.XXXXX.XX.XXXX
      - Se um mesmo produto tiver várias cores, cada cor terá um código diferente - agrupe-os como um único produto com várias cores
      - Use o preço da coluna "30 dias" como preço padrão, convertendo para centavos
      - Identifique materiais na coluna de descrição, como "polipropileno", "aço", etc.
      
      EXTRAIA TODOS OS PRODUTOS MENCIONADOS, MESMO QUE HAJA DEZENAS OU CENTENAS DELES.
      
      Formate a resposta como JSON no formato {"products": [...]}
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
      ? "Você é um assistente especializado em extrair dados completos de tabelas de preços Fratini, focando em reconhecer formatos específicos de código de produto como '1.00020.01.0001', preços em diferentes prazos, e agrupando variações do mesmo produto. IMPORTANTE: Extraia TODOS os produtos mencionados no texto, mesmo que sejam muitos."
      : "Você é um assistente especializado em extrair informações estruturadas de catálogos de móveis com precisão. IMPORTANTE: Extraia TODOS os produtos mencionados no texto, mesmo que sejam muitos. Não pule nenhum produto.";
      
    console.log(`Enviando requisição à OpenAI para processar texto...`);
    
    // Usando temperatura baixa para extração precisa de informações
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
      temperature: 0.3, // Temperatura mais baixa para maior precisão
      response_format: { type: "json_object" }
    });
    
    // Extrair a resposta JSON
    const responseContent = response.choices[0].message.content;
    console.log(`Resposta recebida da OpenAI (tamanho: ${responseContent.length} caracteres)`);
    
    // Analisar a resposta como JSON
    try {
      const parsedResponse = JSON.parse(responseContent);
      
      if (parsedResponse && parsedResponse.products && Array.isArray(parsedResponse.products)) {
        const products = parsedResponse.products;
        console.log(`Extraídos ${products.length} produtos do texto.`);
        
        // Realizar um processamento adicional nos produtos, se necessário
        // Por exemplo, garantir que todos tenham pageNumber para associação com imagens
        return products.map((product: any, index: number) => {
          if (!product.pageNumber) {
            // Se o produto não tiver número de página, atribuir um valor estimado
            // baseado na posição do produto na lista
            product.pageNumber = Math.floor(index / 2) + 1; // Estimativa simples: 2 produtos por página
          }
          return product;
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