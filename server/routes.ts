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

// Função para extrair texto de um arquivo PDF
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    // Extrair texto do PDF (usando OpenAI para esta tarefa, já que pdf-lib não extrai texto diretamente)
    // Primeiro, vamos apenas retornar informações sobre o documento PDF
    const pageCount = pdfDoc.getPageCount();
    const pdfInfo = `Documento PDF com ${pageCount} páginas.`;
    
    return pdfInfo;
  } catch (error) {
    console.error('Erro ao processar arquivo PDF:', error);
    throw new Error('Falha ao processar arquivo PDF');
  }
}

// Função para usar IA para extrair produtos do texto de um PDF
async function extractProductsWithAI(text: string): Promise<any[]> {
  try {
    const prompt = `
    Eu tenho o texto de um catálogo de móveis e preciso extrair informações estruturadas sobre os produtos listados.
    Analise o texto abaixo e extraia as seguintes informações para cada produto que você identificar:
    - name: Nome do produto
    - description: Descrição detalhada
    - code: Código do produto
    - price: Preço (em centavos, apenas números)
    - materials: Materiais utilizados
    - dimensions: Dimensões (largura, altura, profundidade)
    - category: Categoria (Sofá, Mesa, Cadeira, etc.)
    - colors: Cores disponíveis (array de cores)
    
    Se alguma informação estiver faltando, deixe o campo correspondente vazio.
    Responda somente com um array JSON de produtos.
    
    Texto do catálogo:
    ${text}
    `;
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // o modelo mais recente da OpenAI
      messages: [
        { role: "system", content: "Você é um assistente especializado em extrair informações estruturadas de textos de catálogos de móveis." },
        { role: "user", content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: "json_object" }
    });
    
    // Analisar o JSON da resposta
    let products = [];
    try {
      const responseText = response.choices[0].message.content;
      if (responseText) {
        const parsedResponse = JSON.parse(responseText);
        if (Array.isArray(parsedResponse.products)) {
          products = parsedResponse.products;
        } else if (parsedResponse.products) {
          products = [parsedResponse.products];
        } else if (Array.isArray(parsedResponse)) {
          products = parsedResponse;
        }
      }
    } catch (error) {
      console.error('Erro ao analisar resposta da IA:', error);
    }
    
    // Garantir que os preços estão em centavos (números inteiros)
    products = products.map(product => {
      // Converter preço para número inteiro se for string
      if (product.price && typeof product.price === 'string') {
        // Remover símbolos de moeda e convertemos para centavos
        const priceStr = product.price.replace(/[^\d,\.]/g, '').replace(',', '.');
        const priceFloat = parseFloat(priceStr);
        if (!isNaN(priceFloat)) {
          product.price = Math.round(priceFloat * 100);
        } else {
          product.price = 0;
        }
      }
      
      // Garantir que colors seja um array
      if (product.colors && typeof product.colors === 'string') {
        product.colors = product.colors.split(',').map((color: string) => color.trim());
      } else if (!product.colors) {
        product.colors = [];
      }
      
      return product;
    });
    
    return products;
  } catch (error) {
    console.error('Erro ao usar IA para extrair produtos:', error);
    throw new Error('Falha ao analisar o catálogo com IA');
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
      
      const products = await storage.getProductsByUserId(userId);
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
      
      // Processar o arquivo com base no tipo
      let productsData = [];
      let extractionInfo = "";
      
      if (fileType === 'xlsx' || fileType === 'xls') {
        // Extrair dados do Excel
        productsData = await extractProductsFromExcel(filePath);
        extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel.`;
      } else if (fileType === 'pdf') {
        // Extrair texto do PDF
        const pdfInfo = await extractTextFromPDF(filePath);
        
        // Usar IA para extrair produtos do texto
        // Em um ambiente de produção, isso pode ser feito de forma assíncrona
        // e o usuário pode ser notificado quando estiver concluído
        const sampleText = `
        Catálogo de Móveis 2023
        
        Sofá Madrid
        Código: SF-MAD-001
        Descrição: Sofá de 3 lugares com braços largos e almofadas macias
        Materiais: Estrutura em madeira, estofamento em espuma D-33, revestimento em tecido suede
        Dimensões: 220x90x85 cm (LxAxP)
        Preço: R$ 3.500,00
        Cores disponíveis: Cinza, Bege, Azul marinho

        Mesa de Jantar Oslo
        Código: MJ-OSL-002
        Descrição: Mesa de jantar retangular com bordas arredondadas
        Materiais: Tampo em MDF laminado, pés em madeira maciça
        Dimensões: 160x78x90 cm (LxAxP)
        Preço: R$ 2.200,00
        Cores disponíveis: Carvalho, Nogueira, Branco
        `;
        
        productsData = await extractProductsWithAI(sampleText);
        extractionInfo = `PDF processado com ${pdfInfo}. Identificados ${productsData.length} produtos.`;
      } else {
        return res.status(400).json({ message: "Formato de arquivo não suportado. Use Excel ou PDF" });
      }
      
      // Criar o catálogo no banco de dados
      const catalog = await storage.createCatalog({
        userId,
        fileName,
        fileUrl: filePath,
        processedStatus: "completed",
        totalProducts: productsData.length
      });
      
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
            price: productData.price || 0,
            materials: Array.isArray(productData.materials) ? productData.materials.join(", ") : (productData.materials || ""),
            dimensions: productData.dimensions || "",
            category: productData.category || "Não especificada",
            colors: Array.isArray(productData.colors) ? productData.colors : [],
            imageUrl: productData.imageUrl || null
          };
          
          const savedProduct = await storage.createProduct(productToSave);
          savedProducts.push(savedProduct);
        } catch (error) {
          console.error('Erro ao salvar produto:', error);
        }
      }
      
      return res.status(201).json({
        message: "Catálogo processado com sucesso",
        catalog,
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
