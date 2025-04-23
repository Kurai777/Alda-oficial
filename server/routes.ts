import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as XLSX from "xlsx";
import path from "path";
import { existsSync } from "fs";
import { mkdir, readFile } from "fs/promises";
import OpenAI from "openai";
import { DecodedIdToken } from "firebase-admin/auth";
import { auth as firebaseAuth, adminDb } from './firebase-admin';
import { 
  insertUserSchema, 
  insertProductSchema, 
  insertCatalogSchema, 
  insertQuoteSchema, 
  insertMoodboardSchema 
} from "@shared/schema";
import { z } from "zod";
import "express-session";

// Estender a interface Session do express-session para incluir userId
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// Estender a interface Request do Express para incluir o usuário do Firebase
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
    }
  }
}

// Importar procesadores especializados
import { extractTextFromPDF } from "./pdf-processor";
import { extractProductsWithAI } from "./ai-extractor";
import { determineProductCategory, extractMaterialsFromDescription } from "./utils";

// Configurar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configurar multer para uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: async function (req: any, file: any, cb: any) {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req: any, file: any, cb: any) {
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Rota de verificação
  app.get("/api/healthcheck", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Auth endpoints
  const extractFirebaseUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await firebaseAuth.verifyIdToken(idToken);
        
        if (decodedToken) {
          req.firebaseUser = decodedToken;
          
          // Verificar se o usuário existe no banco local
          const localUser = await storage.getUserByEmail(decodedToken.email || '');
          if (localUser) {
            req.session.userId = localUser.id;
          }
        }
      }
      
      next();
    } catch (error) {
      // Ignorar erros e continuar (usuário não autenticado)
      next();
    }
  };
  
  // Aplicar o middleware onde for necessário
  app.use(['/api/auth/me', '/api/products', '/api/catalogs'], extractFirebaseUser);

  // Rota para registrar um usuário (mantida para compatibilidade)
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const data = insertUserSchema.parse(req.body);
      
      // Verificar se o e-mail já existe
      const existingUser = await storage.getUserByEmail(data.email);
      
      if (existingUser) {
        return res.status(400).json({ message: "Email already exists" });
      }
      
      const user = await storage.createUser(data);
      
      // Definir o userId na sessão
      req.session.userId = user.id;
      
      return res.status(201).json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      return res.status(500).json({ message: "Failed to register user" });
    }
  });

  // Rota para autenticação tradicional (mantida para compatibilidade)
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      const user = await storage.getUserByEmail(email);
      
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Definir o userId na sessão
      req.session.userId = user.id;
      
      return res.status(200).json({ 
        id: user.id,
        companyName: user.companyName || 'Empresa',
        email: user.email
      });
    } catch (error) {
      return res.status(500).json({ message: "Failed to login" });
    }
  });
  
  // Nova rota para sincronização de usuários do Firebase com o sistema local
  app.post("/api/auth/firebase-sync", async (req: Request, res: Response) => {
    try {
      const { uid, email, companyName } = req.body;
      
      if (!uid || !email) {
        return res.status(400).json({ message: "UID and email are required" });
      }
      
      // Verificar se o usuário já existe
      let user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Criar um novo usuário se não existir
        user = await storage.createUser({
          email,
          companyName: companyName || 'Empresa',
          password: `firebase-${uid}`, // Senha não será usada, mas é necessária para o schema
        });
        
        console.log(`Criado novo usuário para conta Firebase: ${email}`);
      }
      
      // Definir o userId na sessão
      req.session.userId = user.id;
      
      return res.status(200).json({ 
        id: user.id,
        companyName: user.companyName,
        email: user.email
      });
    } catch (error) {
      console.error("Firebase sync error:", error);
      return res.status(500).json({ message: "Failed to sync Firebase user" });
    }
  });
  
  // Rota para verificar se o usuário está autenticado
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      // Verificar se existe uma sessão ou usuário do Firebase
      const userId = req.session?.userId;
      
      if (!userId && !req.firebaseUser) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      if (userId) {
        const user = await storage.getUser(userId);
        
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }
        
        return res.status(200).json({ 
          id: user.id,
          companyName: user.companyName || 'Empresa',
          email: user.email
        });
      } else if (req.firebaseUser) {
        // Se temos usuário Firebase mas não encontramos no banco local
        return res.status(200).json({ 
          id: req.firebaseUser.uid,
          companyName: req.firebaseUser.name || 'Empresa',
          email: req.firebaseUser.email
        });
      }
    } catch (error) {
      console.error("Auth me error:", error);
      return res.status(500).json({ message: "Failed to get user" });
    }
  });
  
  // Rota para logout (mantida para compatibilidade)
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    try {
      // Limpar a sessão
      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to logout" });
          }
          res.clearCookie('connect.sid');
          return res.status(200).json({ message: "Logged out successfully" });
        });
      } else {
        return res.status(200).json({ message: "Already logged out" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Failed to logout" });
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

  // AI visual search route
  app.post("/api/ai/visual-search", async (req: Request, res: Response) => {
    try {
      const { image, maxResults = 5 } = req.body;
      
      if (!image || !image.startsWith('data:image')) {
        return res.status(400).json({ message: "Invalid image data" });
      }
      
      // Exemplo de chamada para API da OpenAI para análise visual
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Descreva este móvel detalhadamente, incluindo categoria, estilo, materiais, cores e características principais"
              },
              {
                type: "image_url",
                image_url: {
                  url: image
                }
              }
            ],
          },
        ]
      });
      
      const description = response.choices[0].message.content || '';
      
      // Buscar produtos que correspondam à descrição
      const allProducts = await storage.getProductsByUserId(1); // Usando userId 1 para demo
      
      // Filtragem simples baseada em palavras-chave da descrição
      const keywords = description.toLowerCase().split(/\s+/);
      const filteredProducts = allProducts
        .filter(product => {
          const productText = `${product.name} ${product.category} ${product.description}`.toLowerCase();
          return keywords.some(keyword => keyword.length > 3 && productText.includes(keyword));
        })
        .slice(0, maxResults);
      
      return res.status(200).json({
        description,
        products: filteredProducts
      });
    } catch (error) {
      console.error("Erro na busca visual:", error);
      return res.status(500).json({ message: "Falha ao realizar busca visual" });
    }
  });

  // Rota para upload e processamento de catálogos
  app.post("/api/catalogs/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      const userId = req.body.userId ? parseInt(req.body.userId) : 1;
      const filePath = (req.file as any).path;
      const fileName = (req.file as any).originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase() || '';
      
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
          try {
            // Tentar primeiro o método PaddleOCR para melhor precisão e extração de imagens
            console.log(`Iniciando processamento OCR avançado do PDF: ${filePath}`);
            
            // Importar o módulo de processamento OCR
            const { processPdfWithOcr, convertOcrProductsToAppFormat } = await import('./ocr-pdf-processor');
            
            // Processar o PDF com OCR
            const ocrProducts = await processPdfWithOcr(filePath);
            
            // Converter para o formato da aplicação
            productsData = convertOcrProductsToAppFormat(ocrProducts, userId, catalog.id);
            
            console.log(`OCR extraiu ${productsData.length} produtos com imagens do PDF`);
            extractionInfo = `PDF processado com OCR. Extraídos ${productsData.length} produtos com suas imagens reais.`;
            
          } catch (ocrError) {
            console.error("Erro ao processar PDF com OCR:", ocrError);
            console.log("Tentando método alternativo com IA...");
            
            // Método alternativo se o OCR falhar
            // Extrair texto e imagens do PDF
            console.log(`Iniciando extração de texto e imagens do PDF: ${filePath}`);
            const { text: extractedText, images: extractedImages } = await extractTextFromPDF(filePath);
            console.log(`Texto extraído com sucesso. Tamanho: ${extractedText.length} caracteres`);
            console.log(`Imagens extraídas com sucesso. Total: ${extractedImages.length} imagens`);
            
            // Usar IA para extrair produtos do texto
            console.log("Iniciando análise de produtos com IA...");
            const extractedProducts = await extractProductsWithAI(extractedText, fileName);
            
            // Mapa para rastrear as imagens por número de página
            const imagesByPage: { [key: number]: any[] } = {};
            
            // Organizar imagens por página
            extractedImages.forEach(img => {
              if (!imagesByPage[img.page]) {
                imagesByPage[img.page] = [];
              }
              imagesByPage[img.page].push(img);
            });
            
            // Associar imagens aos produtos com base no número da página ou índice
            productsData = extractedProducts.map((product: any, index: number) => {
              // Verificar se o produto tem um número de página identificado
              const productPage = product.pageNumber || Math.floor(index / 2) + 1; // Estimativa baseada no índice
              
              // Encontrar imagens para essa página
              const pageImages = imagesByPage[productPage] || [];
              
              // Se temos imagens para essa página, adicionar a primeira à URL do produto
              if (pageImages.length > 0) {
                product.imageUrl = pageImages[0].processedPath;
                console.log(`Associada imagem da página ${productPage} ao produto "${product.name}"`);
              }
              
              return product;
            });
            
            extractionInfo = `PDF processado com método alternativo. Identificados ${productsData.length} produtos e extraídas ${extractedImages.length} imagens.`;
          }
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileType)) {
          // Processar imagem diretamente com OCR
          console.log(`Processando imagem com OCR: ${filePath}`);
          
          try {
            // Importar o módulo de processamento de imagens
            const { processImageWithOcr, convertOcrProductsToAppFormat } = await import('./image-ocr-processor');
            
            // Processar a imagem com OCR
            const ocrProducts = await processImageWithOcr(filePath);
            
            if (ocrProducts && ocrProducts.length > 0) {
              // Converter para o formato da aplicação
              productsData = convertOcrProductsToAppFormat(ocrProducts, userId, catalog.id);
              
              console.log(`OCR extraiu ${productsData.length} produtos da imagem`);
              extractionInfo = `Imagem processada com OCR. Extraídos ${productsData.length} produtos.`;
            } else {
              // Se não encontrou produtos, usar IA para analisar a imagem
              console.log("OCR não encontrou produtos, usando IA para análise visual...");
              
              // Converter a imagem para base64
              const imageBuffer = await readFile(filePath);
              const base64Image = `data:image/${fileType};base64,${imageBuffer.toString('base64')}`;
              
              // Chamar a API da OpenAI para análise visual
              const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "Descreva este móvel em detalhes, incluindo nome, categoria, preço (se visível), cores, materiais. Formate como JSON com campos: nome, categoria, descricao, preco, cores, materiais."
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: base64Image
                        }
                      }
                    ],
                  },
                ],
                response_format: { type: "json_object" }
              });
              
              const aiDescription = response.choices[0].message.content || '{}';
              
              try {
                const productInfo = JSON.parse(aiDescription);
                
                // Criar um produto a partir da descrição da IA
                productsData = [{
                  userId,
                  catalogId: catalog.id,
                  name: productInfo.nome || "Produto em Imagem",
                  description: productInfo.descricao || "",
                  code: `IMG-${Math.floor(Math.random() * 10000)}`,
                  price: 0, // Preço padrão
                  category: productInfo.categoria || determineProductCategory(productInfo.nome || ""),
                  colors: Array.isArray(productInfo.cores) ? productInfo.cores : 
                          typeof productInfo.cores === 'string' ? [productInfo.cores] : [],
                  materials: Array.isArray(productInfo.materiais) ? productInfo.materiais :
                             typeof productInfo.materiais === 'string' ? [productInfo.materiais] : [],
                  sizes: [],
                  imageUrl: base64Image
                }];
                
                extractionInfo = "Imagem processada com análise visual de IA.";
              } catch (jsonError) {
                console.error("Erro ao processar a resposta da IA:", jsonError);
                
                // Criar um produto simples com a imagem
                productsData = [{
                  userId,
                  catalogId: catalog.id,
                  name: "Produto em Imagem",
                  description: "",
                  code: `IMG-${Math.floor(Math.random() * 10000)}`,
                  price: 0,
                  category: "Outros",
                  colors: [],
                  materials: [],
                  sizes: [],
                  imageUrl: base64Image
                }];
                
                extractionInfo = "Imagem processada como produto único.";
              }
            }
          } catch (imageError) {
            console.error("Erro ao processar imagem:", imageError);
            
            // Criar um produto simples com a imagem original
            const imageBuffer = await readFile(filePath);
            const base64Image = `data:image/${fileType};base64,${imageBuffer.toString('base64')}`;
            
            productsData = [{
              userId,
              catalogId: catalog.id,
              name: path.basename(filePath, path.extname(filePath)),
              description: "",
              code: `IMG-${Math.floor(Math.random() * 10000)}`,
              price: 0,
              category: "Outros",
              colors: [],
              materials: [],
              sizes: [],
              imageUrl: base64Image
            }];
            
            extractionInfo = "Imagem processada como produto único (fallback).";
          }
        } else {
          throw new Error("Formato de arquivo não suportado. Use Excel, PDF ou imagens (JPG, PNG, etc)");
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
      
      // Utilizando a função determineProductCategory importada de utils.ts
      
      // Função para gerar imagem para um produto usando DALL-E
      const generateProductImage = async (product: any): Promise<string> => {
        try {
          console.log(`Gerando imagem para o produto: ${product.name}`);
          
          // Criar um prompt detalhado para o DALL-E
          let imagePrompt = `Uma fotografia profissional de alta qualidade no estilo de catálogo de móveis de um(a) ${product.name}`;
          
          // Adicionar categoria para contexto
          if (product.category) {
            imagePrompt += `, que é um(a) ${product.category}`;
          }
          
          // Adicionar materiais se disponíveis
          if (Array.isArray(product.materials) && product.materials.length > 0) {
            imagePrompt += ` feito de ${product.materials.join(', ')}`;
          }
          
          // Adicionar cor principal se disponível
          if (Array.isArray(product.colors) && product.colors.length > 0) {
            imagePrompt += `, na cor ${product.colors[0]}`;
          }
          
          // Adicionar detalhe da descrição se disponível
          if (product.description) {
            const shortDesc = product.description.split('.')[0]; // Primeira frase apenas
            imagePrompt += `. ${shortDesc}`;
          }
          
          // Contexto adicional para melhorar a qualidade da imagem
          imagePrompt += `. Imagem em fundo branco, iluminação profissional de estúdio fotográfico, fotografia para catálogo de produto, em alta resolução.`;
          
          console.log(`Prompt para geração da imagem: ${imagePrompt}`);
          
          // Gerar a imagem com DALL-E
          const imageResponse = await openai.images.generate({
            model: "dall-e-3",
            prompt: imagePrompt,
            n: 1,
            size: "1024x1024",
            quality: "standard",
          });
          
          // Obter a URL da imagem gerada
          const imageUrl = imageResponse.data[0].url;
          console.log(`Imagem gerada com sucesso para ${product.name}: ${imageUrl}`);
          
          return imageUrl || '';
        } catch (error) {
          console.error(`Erro ao gerar imagem para ${product.name}:`, error);
          
          // Em caso de falha, retornar uma imagem padrão baseada na categoria
          const categoryImages = {
            "Cadeira": "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?ixlib=rb-4.0.3",
            "Banqueta": "https://images.unsplash.com/photo-1501045661006-fcebe0257c3f?ixlib=rb-4.0.3",
            "Poltrona": "https://images.unsplash.com/photo-1567016432779-094069958ea5?ixlib=rb-4.0.3",
            "Sofá": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3",
            "Mesa": "https://images.unsplash.com/photo-1577140917170-285929fb55b7?ixlib=rb-4.0.3",
            "default": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3"
          };
          
          // Tentar encontrar uma imagem para a categoria correspondente
          const category = (product.category ? product.category.toLowerCase() : "") || "";
          const productName = (product.name ? product.name.toLowerCase() : "") || "";
          
          for (const [key, url] of Object.entries(categoryImages)) {
            const keyLower = key.toLowerCase();
            if (key !== "default" && (category.includes(keyLower) || productName.includes(keyLower))) {
              return url;
            }
          }
          
          return categoryImages.default;
        }
      };
      
      // Adicionar produtos extraídos ao banco de dados
      const savedProducts = [];
      
      // Limitar o número inicial de produtos para processamento mais rápido
      const MAX_PRODUCTS_FOR_IMAGE_GENERATION = 4;
      
      for (let i = 0; i < productsData.length; i++) {
        try {
          const productData = productsData[i];
          
          // Gerar imagem para os primeiros produtos
          let imageUrl = productData.imageUrl;
          if (!imageUrl && i < MAX_PRODUCTS_FOR_IMAGE_GENERATION) {
            console.log(`Gerando imagem para produto ${i+1}/${productsData.length}: ${productData.name}`);
            imageUrl = await generateProductImage(productData);
          } else if (!imageUrl) {
            // Para os demais produtos, usar imagem padrão temporariamente
            const categoryImages = {
              "Cadeira": "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?ixlib=rb-4.0.3",
              "Banqueta": "https://images.unsplash.com/photo-1501045661006-fcebe0257c3f?ixlib=rb-4.0.3",
              "Poltrona": "https://images.unsplash.com/photo-1567016432779-094069958ea5?ixlib=rb-4.0.3",
              "Sofá": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3",
              "Mesa": "https://images.unsplash.com/photo-1577140917170-285929fb55b7?ixlib=rb-4.0.3",
              "default": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3"
            };
            
            const category = (productData.category ? productData.category.toLowerCase() : "") || "";
            const name = (productData.name ? productData.name.toLowerCase() : "") || "";
            
            if (category.includes("cadeira") || name.includes("cadeira")) {
              imageUrl = categoryImages.Cadeira;
            } else if (category.includes("banqueta") || name.includes("banqueta")) {
              imageUrl = categoryImages.Banqueta;
            } else if (category.includes("poltrona") || name.includes("poltrona")) {
              imageUrl = categoryImages.Poltrona;
            } else if (category.includes("sofa") || name.includes("sofa")) {
              imageUrl = categoryImages.Sofá;
            } else if (category.includes("mesa") || name.includes("mesa")) {
              imageUrl = categoryImages.Mesa;
            } else {
              imageUrl = categoryImages.default;
            }
          }
          
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
            imageUrl: imageUrl || "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3"
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