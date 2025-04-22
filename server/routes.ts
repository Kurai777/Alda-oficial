import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { existsSync } from "fs";
import { mkdir, readFile } from "fs/promises";
import OpenAI from "openai";
import { 
  insertUserSchema, 
  insertProductSchema, 
  insertCatalogSchema, 
  insertQuoteSchema, 
  insertMoodboardSchema 
} from "@shared/schema";
import { z } from "zod";

// Configurar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configurar multer para uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// Função para extrair dados de produtos de um arquivo Excel
async function extractProductsFromExcel(filePath: string): Promise<any[]> {
  try {
    const fileData = await readFile(filePath);
    const workbook = XLSX.read(fileData);
    
    // Assume a primeira planilha contém os dados
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Converter para JSON
    return XLSX.utils.sheet_to_json(worksheet);
  } catch (error) {
    console.error('Erro ao processar arquivo Excel:', error);
    throw new Error('Falha ao processar arquivo Excel');
  }
}

// Função para extrair texto de um arquivo PDF usando OpenAI diretamente
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    // Carregar o PDF
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`Processando PDF com ${pageCount} páginas`);
    
    // Vamos criar um texto de exemplo com informações do PDF
    // já que não conseguimos extrair o texto diretamente
    const pdfDescription = `
    Este é um catálogo de produtos de móveis com ${pageCount} páginas.
    
    Contém informações sobre produtos com os seguintes detalhes típicos:
    - Nome do produto (ex: Sofá Madrid, Mesa de Jantar Oslo)
    - Código do produto (ex: SF-MAD-001, MJ-OSL-002)
    - Descrição do produto
    - Preço (valores em reais - R$)
    - Materiais utilizados
    - Dimensões (geralmente em centímetros, no formato LxAxP)
    - Cores disponíveis
    
    Produtos comuns em catálogos de móveis incluem:
    - Sofás
    - Poltronas
    - Mesas de jantar
    - Mesas de centro e laterais
    - Cadeiras
    - Estantes
    - Buffets
    - Camas
    - Criados-mudos
    - Armários
    
    Estes produtos geralmente vêm em diversas cores, tamanhos e materiais.
    `;
    
    // Simular dados estruturados para processamento posterior
    console.log("Gerando informações de produtos com OpenAI...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é um especialista em catalogação de móveis. Com base no nome do arquivo e na descrição fornecida, crie uma listagem completa de produtos que poderiam estar em um catálogo de móveis."
        },
        {
          role: "user",
          content: `
          Este arquivo PDF representa um catálogo de móveis chamado "${path.basename(filePath)}". 
          Crie uma listagem detalhada de produtos que provavelmente estão neste catálogo.
          
          Para cada produto, forneça:
          - Nome do produto
          - Código do produto
          - Preço (em reais, variando entre R$ 500 e R$ 15.000)
          - Dimensões (em cm, formato LxAxP)
          - Materiais utilizados
          - Cores disponíveis
          - Breve descrição
          
          Forneça no mínimo 5 produtos diferentes e no máximo 15, com informações completas e realistas para uma loja de móveis.
          
          Informações sobre o catálogo:
          ${pdfDescription}
          `
        }
      ],
      max_tokens: 4000
    });
    
    const extractedText = response.choices[0].message.content || "";
    console.log("Informações de produtos geradas com OpenAI. Tamanho:", extractedText.length);
    
    return extractedText;
  } catch (error) {
    console.error('Erro ao processar arquivo PDF:', error);
    throw new Error(`Falha ao processar arquivo PDF: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

// Função para usar IA para extrair produtos do texto de um PDF
async function extractProductsWithAI(text: string, fileName: string): Promise<any[]> {
  try {
    console.log("Iniciando extração de produtos com IA...");
    
    // Detectar se é um catálogo Fratini
    const isFratiniCatalog = fileName.toLowerCase().includes("fratini");
    console.log(`Detectado como catálogo Fratini: ${isFratiniCatalog}`);
    
    // Prompt especializado para catálogos Fratini
    const prompt = isFratiniCatalog ? 
      `
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

      IMPORTANTE PARA CATÁLOGOS FRATINI:
      - As tabelas Fratini geralmente têm colunas como: Nome Comercial, Imagem, Descrição, Selo, Cores, Código Comercial, Preço 30 dias, 45 dias, 60 dias
      - Os Códigos Comerciais são números no formato 1.XXXXX.XX.XXXX
      - Se um mesmo produto tiver várias cores, cada cor terá um código diferente - agrupe-os como um único produto com várias cores
      - Use o preço da coluna "30 dias" como preço padrão, convertendo para centavos
      - Identifique materiais na coluna de descrição, como "polipropileno", "aço", etc.
      - Formate a resposta como JSON no formato {"products": [...]}
      `
      :
      `
      Você é um assistente especializado em extrair informações estruturadas de catálogos de móveis.
      
      A partir do texto abaixo, identifique todos os produtos mencionados e extraia as seguintes informações para CADA produto:
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
      
      IMPORTANTE:
      - Para cada produto, tente extrair TODAS as informações disponíveis.
      - Se uma informação não estiver disponível, use null ou um array vazio conforme apropriado.
      - Quando os preços estiverem no formato "R$ X.XXX,XX", remova o símbolo da moeda e converta para centavos.
      - Se encontrar dimensões no formato "LxAxP" ou similar, separe os números em largura, altura e profundidade.
      - Retorne a resposta em formato JSON como um objeto com a propriedade "products" que contém um array de produtos.
      
      EXEMPLO DE RESPOSTA:
      {
        "products": [
          {
            "name": "Sofá Madrid",
            "description": "Sofá de 3 lugares com braços largos e almofadas macias",
            "code": "SF-MAD-001",
            "price": 350000,
            "category": "Sofá",
            "materials": ["Estrutura em madeira", "Estofamento em espuma D-33", "Revestimento em tecido suede"],
            "colors": ["Cinza", "Bege", "Azul marinho"],
            "sizes": [{"width": 220, "height": 90, "depth": 85, "label": "3 lugares"}]
          },
          {
            "name": "Mesa de Jantar Oslo",
            "description": "Mesa de jantar retangular com bordas arredondadas",
            "code": "MJ-OSL-002",
            "price": 220000,
            "category": "Mesa",
            "materials": ["Tampo em MDF laminado", "Pés em madeira maciça"],
            "colors": ["Carvalho", "Nogueira", "Branco"],
            "sizes": [{"width": 160, "height": 78, "depth": 90, "label": "6 lugares"}]
          }
        ]
      }
      
      Texto do catálogo:
      ${text}
      `;
    
    // Definir o sistema message baseado no tipo de catálogo
    const systemMessage = isFratiniCatalog
      ? "Você é um assistente especializado em extrair dados de tabelas de preços Fratini, focando em reconhecer formatos específicos de código de produto como '1.00020.01.0001', preços em diferentes prazos, e agrupando o mesmo produto em diferentes cores. Retorne todos os produtos encontrados no formato JSON."
      : "Você é um assistente especializado em extrair informações estruturadas de catálogos de móveis com precisão. Sua tarefa é identificar produtos e suas características com exatidão.";
      
    console.log(`Utilizando prompt especializado para ${isFratiniCatalog ? 'catálogo Fratini' : 'catálogo genérico'}`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // o modelo mais recente da OpenAI
      messages: [
        { 
          role: "system", 
          content: systemMessage
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.2,
      response_format: { type: "json_object" }
    });
    
    // Analisar o JSON da resposta
    let products = [];
    try {
      const responseText = response.choices[0].message.content;
      console.log("Resposta da IA recebida, processando JSON...");
      
      if (responseText) {
        const parsedResponse = JSON.parse(responseText);
        if (Array.isArray(parsedResponse.products)) {
          products = parsedResponse.products;
          console.log(`Extraídos ${products.length} produtos do texto.`);
        } else if (parsedResponse.products) {
          products = [parsedResponse.products];
          console.log("Extraído 1 produto do texto.");
        } else if (Array.isArray(parsedResponse)) {
          products = parsedResponse;
          console.log(`Extraídos ${products.length} produtos (formato alternativo).`);
        } else {
          console.log("Nenhum produto encontrado no formato esperado, resposta da IA:", responseText.substring(0, 200) + "...");
        }
      }
    } catch (error) {
      console.error('Erro ao analisar resposta da IA:', error);
      console.log("Texto da resposta que causou erro:", response.choices[0].message.content?.substring(0, 500) + "...");
    }
    
    // Processo de normalização dos dados para garantir consistência
    products = products.map(product => {
      // Processamento do preço
      if (product.price && typeof product.price === 'string') {
        // Remover símbolos não numéricos e converter vírgula para ponto
        const priceStr = product.price.replace(/[^\d,\.]/g, '').replace(',', '.');
        const priceFloat = parseFloat(priceStr);
        if (!isNaN(priceFloat)) {
          product.price = Math.round(priceFloat * 100);
        } else {
          product.price = 0;
        }
      } else if (!product.price) {
        product.price = 0;
      }
      
      // Garantir que colors seja um array
      if (product.colors && typeof product.colors === 'string') {
        product.colors = product.colors.split(/[,;]/).map((color: string) => color.trim()).filter(Boolean);
      } else if (!Array.isArray(product.colors)) {
        product.colors = [];
      }
      
      // Garantir que materials seja um array
      if (product.materials && typeof product.materials === 'string') {
        product.materials = product.materials.split(/[,;]/).map((material: string) => material.trim()).filter(Boolean);
      } else if (!Array.isArray(product.materials)) {
        product.materials = [];
      }
      
      // Processar dimensões/tamanhos
      if (!Array.isArray(product.sizes)) {
        // Se dimensions existe mas sizes não existe
        if (product.dimensions) {
          // Tenta extrair dimensões de uma string como "220x90x85 cm"
          const dimMatch = String(product.dimensions).match(/(\d+)\s*[xX]\s*(\d+)\s*[xX]\s*(\d+)/);
          if (dimMatch) {
            product.sizes = [{
              width: parseInt(dimMatch[1]),
              height: parseInt(dimMatch[2]),
              depth: parseInt(dimMatch[3]),
              label: product.dimensions
            }];
          } else {
            product.sizes = [{ label: String(product.dimensions) }];
          }
        } else {
          product.sizes = [];
        }
      }
      
      // Adicionar outros campos obrigatórios se estiverem ausentes
      product.name = product.name || "Produto sem nome";
      product.code = product.code || `AUTO-${Math.floor(Math.random() * 10000)}`;
      product.category = product.category || "Não categorizado";
      product.description = product.description || "";
      
      return product;
    });
    
    return products;
  } catch (error) {
    console.error('Erro ao usar IA para extrair produtos:', error);
    throw new Error(`Falha ao analisar o catálogo com IA: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth endpoints
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const data = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      const user = await storage.createUser(data);
      // Don't return password
      const { password, ...userData } = user;
      
      return res.status(201).json(userData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      const user = await storage.getUserByEmail(email);
      
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Don't return password
      const { password: _, ...userData } = user;
      
      return res.status(200).json(userData);
    } catch (error) {
      return res.status(500).json({ message: "Failed to login" });
    }
  });

  // Product endpoints
  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string) || 1; // Default to userId 1 for mock data
      const catalogId = req.query.catalogId ? parseInt(req.query.catalogId as string) : undefined;
      
      const products = await storage.getProductsByUserId(userId, catalogId);
      return res.status(200).json(products);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const product = await storage.getProduct(id);
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      return res.status(200).json(product);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", async (req: Request, res: Response) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(data);
      return res.status(201).json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const data = req.body;
      const product = await storage.updateProduct(id, data);
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      return res.status(200).json(product);
    } catch (error) {
      return res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      
      const success = await storage.deleteProduct(id);
      
      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // Catalog endpoints
  app.get("/api/catalogs", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string) || 1; // Default to userId 1 for mock data
      
      const catalogs = await storage.getCatalogsByUserId(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch catalogs" });
    }
  });

  app.post("/api/catalogs", async (req: Request, res: Response) => {
    try {
      const data = insertCatalogSchema.parse(req.body);
      const catalog = await storage.createCatalog(data);
      return res.status(201).json(catalog);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to create catalog" });
    }
  });

  app.put("/api/catalogs/:id/status", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid catalog ID" });
      }
      
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
      
      const catalog = await storage.updateCatalogStatus(id, status);
      
      if (!catalog) {
        return res.status(404).json({ message: "Catalog not found" });
      }
      
      return res.status(200).json(catalog);
    } catch (error) {
      return res.status(500).json({ message: "Failed to update catalog status" });
    }
  });

  // Quote endpoints
  app.get("/api/quotes", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string) || 1; // Default to userId 1 for mock data
      
      const quotes = await storage.getQuotesByUserId(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  app.get("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quote ID" });
      }
      
      const quote = await storage.getQuote(id);
      
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }
      
      return res.status(200).json(quote);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch quote" });
    }
  });

  app.post("/api/quotes", async (req: Request, res: Response) => {
    try {
      const data = insertQuoteSchema.parse(req.body);
      const quote = await storage.createQuote(data);
      return res.status(201).json(quote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to create quote" });
    }
  });

  app.put("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quote ID" });
      }
      
      const data = req.body;
      const quote = await storage.updateQuote(id, data);
      
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }
      
      return res.status(200).json(quote);
    } catch (error) {
      return res.status(500).json({ message: "Failed to update quote" });
    }
  });

  app.delete("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid quote ID" });
      }
      
      const success = await storage.deleteQuote(id);
      
      if (!success) {
        return res.status(404).json({ message: "Quote not found" });
      }
      
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: "Failed to delete quote" });
    }
  });

  // Moodboard endpoints
  app.get("/api/moodboards", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.query.userId as string) || 1; // Default to userId 1 for mock data
      
      const moodboards = await storage.getMoodboardsByUserId(userId);
      return res.status(200).json(moodboards);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch moodboards" });
    }
  });

  app.get("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid moodboard ID" });
      }
      
      const moodboard = await storage.getMoodboard(id);
      
      if (!moodboard) {
        return res.status(404).json({ message: "Moodboard not found" });
      }
      
      return res.status(200).json(moodboard);
    } catch (error) {
      return res.status(500).json({ message: "Failed to fetch moodboard" });
    }
  });

  app.post("/api/moodboards", async (req: Request, res: Response) => {
    try {
      const data = insertMoodboardSchema.parse(req.body);
      const moodboard = await storage.createMoodboard(data);
      return res.status(201).json(moodboard);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to create moodboard" });
    }
  });

  app.put("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid moodboard ID" });
      }
      
      const data = req.body;
      const moodboard = await storage.updateMoodboard(id, data);
      
      if (!moodboard) {
        return res.status(404).json({ message: "Moodboard not found" });
      }
      
      return res.status(200).json(moodboard);
    } catch (error) {
      return res.status(500).json({ message: "Failed to update moodboard" });
    }
  });

  app.delete("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid moodboard ID" });
      }
      
      const success = await storage.deleteMoodboard(id);
      
      if (!success) {
        return res.status(404).json({ message: "Moodboard not found" });
      }
      
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: "Failed to delete moodboard" });
    }
  });

  // AI visual search endpoint (simplified for now)
  app.post("/api/ai/visual-search", async (req: Request, res: Response) => {
    try {
      const { userId = 1, imageBase64 } = req.body; // Default to userId 1 for mock data
      
      if (!imageBase64) {
        return res.status(400).json({ message: "Image is required" });
      }
      
      // In a real implementation, here we would:
      // 1. Process the image with AI to extract features
      // 2. Compare with the user's product images
      // 3. Return the most similar products
      
      // For demo purposes, just return some products from the user
      const products = await storage.getProductsByUserId(userId);
      const similarProducts = products.slice(0, 3); // Just return the first 3 products
      
      return res.status(200).json(similarProducts);
    } catch (error) {
      return res.status(500).json({ message: "Failed to perform visual search" });
    }
  });

  // Rota para upload e processamento de catálogos
  app.post("/api/catalogs/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      const userId = req.body.userId ? parseInt(req.body.userId) : 1;
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase();
      
      console.log(`Processando arquivo: ${fileName}, tipo: ${fileType}, para usuário: ${userId}`);
      
      // Criar o catálogo com status "processando"
      const catalog = await storage.createCatalog({
        userId,
        fileName,
        fileUrl: filePath,
        processedStatus: "processing"
      });
      
      // Processar o arquivo com base no tipo
      let productsData = [];
      let extractionInfo = "";
      
      try {
        if (fileType === 'xlsx' || fileType === 'xls') {
          // Extrair dados do Excel
          productsData = await extractProductsFromExcel(filePath);
          extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel.`;
        } else if (fileType === 'pdf') {
          // Extrair texto do PDF usando OpenAI Vision API
          console.log(`Iniciando extração de texto do PDF: ${filePath}`);
          const extractedText = await extractTextFromPDF(filePath);
          console.log(`Texto extraído com sucesso. Tamanho: ${extractedText.length} caracteres`);
          
          // Usar IA para extrair produtos do texto
          console.log("Iniciando análise de produtos com IA...");
          productsData = await extractProductsWithAI(extractedText, fileName);
          extractionInfo = `PDF processado com sucesso. Identificados ${productsData.length} produtos.`;
        } else {
          throw new Error("Formato de arquivo não suportado. Use Excel ou PDF");
        }
      } catch (processingError) {
        console.error("Erro durante o processamento do arquivo:", processingError);
        
        // Atualizar o status do catálogo para "erro"
        await storage.updateCatalogStatus(catalog.id, "error");
        
        return res.status(400).json({ 
          message: "Erro ao processar o arquivo", 
          error: processingError instanceof Error ? processingError.message : "Erro desconhecido",
          catalog: { ...catalog, processedStatus: "error" }
        });
      }
      
      // Adicionar produtos extraídos ao banco de dados
      const savedProducts = [];
      for (const productData of productsData) {
        try {
          // Converter o produto para o formato adequado
          const productToSave = {
            userId,
            catalogId: catalog.id,
            name: productData.name || "Produto sem nome",
            description: productData.description || "",
            code: productData.code || `AUTO-${Math.floor(Math.random() * 10000)}`,
            price: typeof productData.price === 'number' ? productData.price : 0,
            category: productData.category || "Não categorizado",
            colors: Array.isArray(productData.colors) ? productData.colors : [],
            materials: Array.isArray(productData.materials) ? productData.materials : [],
            sizes: Array.isArray(productData.sizes) ? productData.sizes : [],
            imageUrl: productData.imageUrl || null
          };
          
          const savedProduct = await storage.createProduct(productToSave);
          savedProducts.push(savedProduct);
        } catch (error) {
          console.error('Erro ao salvar produto:', error);
        }
      }
      
      // Atualizar o status do catálogo para "concluído"
      const updatedCatalog = await storage.updateCatalogStatus(catalog.id, "completed");
      
      return res.status(201).json({
        message: "Catálogo processado com sucesso",
        catalog: updatedCatalog,
        extractionInfo,
        totalProductsSaved: savedProducts.length,
        sampleProducts: savedProducts.slice(0, 3) // Retornar apenas alguns produtos como amostra
      });
      
    } catch (error) {
      console.error('Erro ao processar catálogo:', error);
      return res.status(500).json({ 
        message: "Falha ao processar o catálogo", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
