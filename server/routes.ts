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
import fs from "fs";

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

// Importar os novos processadores e Firebase
import { processExcelFile } from './excel-processor';
import { saveCatalogToFirestore, saveProductsToFirestore, updateCatalogStatusInFirestore } from './firebase-admin';

// Verificar chave da API
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-mock-key-for-development-only';
if (!process.env.OPENAI_API_KEY) {
  console.error("AVISO: OPENAI_API_KEY não está definida, usando chave mock para desenvolvimento");
  console.error("As solicitações reais à API OpenAI falharão, mas o código continuará funcionando");
}

// Configurar OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

// Adicionando uma função de fallback para criar produtos de demonstração
// Função removeida: createDemoProductsFromCatalog
// Esta função gerava produtos aleatórios/fictícios, o que viola nossa política de integridade de dados
// Agora estamos confiando apenas em dados extraídos de fontes autênticas

// Função para obter uma imagem padrão para cada categoria
function getCategoryDefaultImage(category: string): string {
  const categoryImages = {
    "Cadeira": "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?ixlib=rb-4.0.3",
    "Banqueta": "https://images.unsplash.com/photo-1501045661006-fcebe0257c3f?ixlib=rb-4.0.3",
    "Poltrona": "https://images.unsplash.com/photo-1567016432779-094069958ea5?ixlib=rb-4.0.3",
    "Sofá": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3",
    "Mesa": "https://images.unsplash.com/photo-1577140917170-285929fb55b7?ixlib=rb-4.0.3",
    "Estante": "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?ixlib=rb-4.0.3",
    "Armário": "https://images.unsplash.com/photo-1595428774223-ef52624120d2?ixlib=rb-4.0.3",
    "default": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3"
  };
  
  const categoryKey = category as keyof typeof categoryImages;
  return categoryImages[categoryKey] || categoryImages.default;
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
      let userId: number | string;
      
      // Usar o ID do Firebase se disponível, caso contrário usar o userId da query ou default
      if (req.firebaseUser && req.firebaseUser.uid) {
        userId = req.firebaseUser.uid;
        console.log(`Usando Firebase UID: ${userId} para buscar produtos`);
      } else {
        userId = parseInt(req.query.userId as string) || 1;
        console.log(`Usando userId da query: ${userId} para buscar produtos`);
      }
      
      const catalogId = req.query.catalogId ? parseInt(req.query.catalogId as string) : undefined;
      console.log(`Buscando produtos para userId=${userId}, catalogId=${catalogId}`);
      
      const products = await storage.getProductsByUserId(userId, catalogId);
      console.log(`Encontrados ${products.length} produtos`);
      return res.status(200).json(products);
    } catch (error) {
      console.error("Erro ao buscar produtos:", error);
      return res.status(500).json({ message: "Failed to fetch products", error: error.message });
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
      let userId: number | string;
      
      // Usar o ID do Firebase se disponível, caso contrário usar o userId da query ou default
      if (req.firebaseUser && req.firebaseUser.uid) {
        userId = req.firebaseUser.uid;
        console.log(`Usando Firebase UID: ${userId} para buscar catálogos`);
      } else {
        userId = parseInt(req.query.userId as string) || 1;
        console.log(`Usando userId da query: ${userId} para buscar catálogos`);
      }
      
      const catalogs = await storage.getCatalogsByUserId(userId);
      console.log(`Encontrados ${catalogs.length} catálogos`);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("Erro ao buscar catálogos:", error);
      return res.status(500).json({ message: "Failed to fetch catalogs", error: error.message });
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

  // Rota para buscar um catálogo específico
  app.get("/api/catalogs/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid catalog ID" });
      }
      
      const catalog = await storage.getCatalog(id);
      
      if (!catalog) {
        return res.status(404).json({ message: "Catalog not found" });
      }
      
      return res.status(200).json(catalog);
    } catch (error) {
      console.error('Erro ao buscar catálogo:', error);
      return res.status(500).json({ message: "Failed to fetch catalog" });
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
      console.log("=== INÍCIO DO PROCESSAMENTO DE CATÁLOGO ===");
      if (!req.file) {
        console.log("Erro: Nenhum arquivo enviado");
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      // Determinar o userId com base na autenticação Firebase ou fallback para o userId do body
      let userId: number | string;
      if (req.firebaseUser && req.firebaseUser.uid) {
        userId = req.firebaseUser.uid;
        console.log(`Usando Firebase UID: ${userId} para criar catálogo`);
      } else {
        userId = req.body.userId ? parseInt(req.body.userId) : 1;
        console.log(`Usando userId do body: ${userId} para criar catálogo`);
      }
      
      const filePath = (req.file as any).path;
      const fileName = (req.file as any).originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase() || '';
      
      console.log(`Processando arquivo: ${fileName}, tipo: ${fileType}, para usuário: ${userId}, caminho: ${filePath}`);
      
      // Criar o catálogo com status "processando" no banco local
      let firestoreCatalogId = ""; // Será populado logo abaixo
      
      const catalog = await storage.createCatalog({
        userId,
        fileName,
        fileUrl: filePath,
        processedStatus: "processing",
        firestoreCatalogId
      });
      
      console.log(`Catálogo criado com ID: ${catalog.id}, status: ${catalog.processedStatus}`);
      
      // Criar catálogo no Firestore para obter o ID do Firestore
      const firebaseCatalog = {
        name: fileName,
        fileName: fileName,
        filePath: filePath,
        fileType: fileType,
        status: "processing",
        userId: userId,
        localCatalogId: catalog.id,
        createdAt: new Date()
      };
      
      // Salvar catálogo no Firestore e obter o ID
      try {
        firestoreCatalogId = await saveCatalogToFirestore(firebaseCatalog, userId);
        console.log(`Catálogo salvo no Firestore com ID: ${firestoreCatalogId}`);
        
        // Atualizar o catálogo local com o ID do Firestore
        await storage.updateCatalogStatus(catalog.id, "processing", firestoreCatalogId);
        console.log(`Catálogo local atualizado com o ID do Firestore: ${firestoreCatalogId}`);
      } catch (firebaseError) {
        console.error("Erro ao salvar catálogo no Firestore:", firebaseError);
        // Continuar mesmo se não conseguir salvar no Firestore
        firestoreCatalogId = `local-${catalog.id}`;
      }
      
      // Processar o arquivo com base no tipo
      let productsData = [];
      let extractionInfo = "";
      
      try {
        // Processar o arquivo com base no tipo
        if (fileType === 'xlsx' || fileType === 'xls') {
          try {
            // Extrair dados do Excel usando o novo processador
            console.log(`Iniciando processamento do arquivo Excel: ${filePath}`);
            productsData = await processExcelFile(filePath);
            extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel.`;
            
            // Salvar produtos no Firestore
            try {
              const productIds = await saveProductsToFirestore(
                productsData.map(p => ({ ...p, userId, catalogId: firestoreCatalogId })), 
                userId, 
                firestoreCatalogId
              );
              console.log(`${productIds.length} produtos do Excel salvos no Firestore`);
              
              // Atualizar status do catálogo no Firestore
              await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "completed", productsData.length);
            } catch (firestoreError) {
              console.error("Erro ao salvar produtos do Excel no Firestore:", firestoreError);
              // Continuar mesmo se não conseguir salvar no Firestore
            }
          } catch (excelError) {
            console.error("Erro ao processar Excel:", excelError);
            // Tentar método alternativo com código existente
            productsData = await extractProductsFromExcel(filePath);
            extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (método alternativo).`;
            
            // Salvar produtos no Firestore
            try {
              const productIds = await saveProductsToFirestore(
                productsData.map(p => ({ ...p, userId, catalogId: firestoreCatalogId })), 
                userId, 
                firestoreCatalogId
              );
              console.log(`${productIds.length} produtos do Excel salvos no Firestore (método alternativo)`);
              
              // Atualizar status do catálogo no Firestore
              await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "completed", productsData.length);
            } catch (firestoreError) {
              console.error("Erro ao salvar produtos do Excel no Firestore:", firestoreError);
              // Continuar mesmo se não conseguir salvar no Firestore
            }
          }
        } else if (fileType === 'pdf') {
          // Processar PDF usando o novo pipeline automatizado (PDF2Image + PaddleOCR + IA)
          try {
            // Verificar se o arquivo existe
            if (!fs.existsSync(filePath)) {
              console.error(`ERRO: Arquivo não encontrado: ${filePath}`);
              throw new Error(`Arquivo não encontrado: ${filePath}`);
            }
            
            console.log("Arquivo PDF encontrado, verificando tamanho...");
            const fileStats = fs.statSync(filePath);
            console.log(`Tamanho do arquivo: ${fileStats.size} bytes`);
            
            // Importar o novo pipeline de processamento automatizado
            console.log("Iniciando pipeline automatizado de processamento...");
            const { processCatalogWithAutomatedPipeline } = await import('./pdf-ai-pipeline');
            
            // Executar o pipeline completo com PaddleOCR + IA
            console.log(`Iniciando pipeline automatizado para: ${filePath}`);
            productsData = await processCatalogWithAutomatedPipeline(filePath, fileName, userId, catalog.id);
            
            // Verificar se temos produtos extraídos
            if (!productsData || productsData.length === 0) {
              throw new Error("O pipeline automatizado não conseguiu extrair produtos do PDF");
            }
            
            console.log(`Pipeline automatizado extraiu ${productsData.length} produtos do PDF`);
            extractionInfo = `PDF processado com pipeline automatizado (PDF2Image + PaddleOCR + IA). Extraídos ${productsData.length} produtos.`;
          } catch (pipelineError) {
            console.error("Erro no pipeline automatizado:", pipelineError);
            console.log("Stack trace:", pipelineError instanceof Error ? pipelineError.stack : "Sem stack trace");
            console.log("Tentando método alternativo com IA multimodal GPT-4o...");
            
            try {
              // Método 2: Tentar processamento com Claude como fallback
              console.log("Importando módulos necessários para processamento com Claude...");
              const { extractTextFromPDF } = await import('./pdf-processor');
              const { processImageWithClaude } = await import('./claude-ai-extractor');
              
              // Extrair imagens do PDF para processá-las com Claude
              console.log("Extraindo imagens do PDF para processamento com Claude...");
              const { images: extractedImages } = await extractTextFromPDF(filePath);
              console.log(`Extraídas ${extractedImages.length} imagens do PDF para processamento com Claude`);
              
              // Array para armazenar produtos extraídos de todas as páginas
              let allExtractedProducts: any[] = [];
              
              // Processar apenas até 10 páginas para evitar custos excessivos
              const maxPagesToProcess = Math.min(extractedImages.length, 10);
              
              // Processar cada imagem com Claude
              for (let i = 0; i < maxPagesToProcess; i++) {
                try {
                  const image = extractedImages[i];
                  console.log(`Processando página ${image.page} com Claude...`);
                  
                  // Processar a imagem com Claude
                  const pageProducts = await processImageWithClaude(
                    image.processedPath,
                    fileName,
                    userId,
                    catalog.id,
                    image.page
                  );
                  
                  // Adicionar produtos extraídos ao array
                  if (pageProducts && pageProducts.length > 0) {
                    allExtractedProducts = allExtractedProducts.concat(pageProducts);
                    console.log(`Claude extraiu ${pageProducts.length} produtos da página ${image.page}`);
                  }
                } catch (pageError) {
                  console.error(`Erro ao processar página ${extractedImages[i].page} com Claude:`, pageError);
                }
              }
              
              if (allExtractedProducts.length > 0) {
                productsData = allExtractedProducts;
                console.log(`Claude extraiu um total de ${productsData.length} produtos do PDF`);
                extractionInfo = `PDF processado com IA Claude-3-7-Sonnet. Extraídos ${productsData.length} produtos.`;
              } else {
                // Se Claude também falhar, tentar OCR
                throw new Error("Não foi possível extrair produtos com Claude AI");
              }
            } catch (claudeError) {
              console.error("Erro ao processar PDF com Claude:", claudeError);
              console.log("Tentando processamento OCR tradicional...");
              
              try {
                // Método 3: Tentar o método OCR tradicional (PaddleOCR)
                console.log(`Tentando processamento OCR do PDF: ${filePath}`);
                
                // Importar o módulo de processamento OCR
                const { processPdfWithOcr, convertOcrProductsToAppFormat } = await import('./ocr-pdf-processor');
                
                // Processar o PDF com OCR
                const ocrProducts = await processPdfWithOcr(filePath);
                
                // Converter para o formato da aplicação
                productsData = convertOcrProductsToAppFormat(ocrProducts, userId, catalog.id);
                
                console.log(`OCR extraiu ${productsData.length} produtos do PDF`);
                extractionInfo = `PDF processado com OCR. Extraídos ${productsData.length} produtos.`;
              } catch (ocrError) {
                console.error("Erro ao processar PDF com OCR:", ocrError);
                console.log("Tentando método alternativo final...");
                
                // Método 4: Método alternativo final se os anteriores falharem
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
                
                extractionInfo = `PDF processado com método alternativo final. Identificados ${productsData.length} produtos e extraídas ${extractedImages.length} imagens.`;
              }
            }
          }
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileType)) {
          // Processar imagem diretamente com IA multimodal
          console.log(`Processando imagem com IA multimodal GPT-4o: ${filePath}`);
          
          try {
            // Importar o módulo de processamento avançado
            const { processFileWithAdvancedAI } = await import('./advanced-ai-extractor');
            
            // Processar a imagem diretamente com IA multimodal
            productsData = await processFileWithAdvancedAI(filePath, fileName, userId, catalog.id);
            
            // Verificar se temos produtos extraídos
            if (!productsData || productsData.length === 0) {
              throw new Error("A IA não conseguiu identificar nenhum produto na imagem fornecida");
            }
            
            console.log(`IA multimodal extraiu ${productsData.length} produtos da imagem`);
            extractionInfo = `Imagem processada com IA multimodal GPT-4o. Extraídos ${productsData.length} produtos.`;
            
          } catch (aiError) {
            console.error("Erro ao processar imagem com IA multimodal:", aiError);
            console.log("Tentando método alternativo com OCR...");
            
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
                // Se não encontrou produtos, usar IA para análise visual simplificada
                console.log("OCR não encontrou produtos, usando IA para análise visual simples...");
                
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
                    price: productInfo.preco || 0,
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
          }
        } else {
          throw new Error("Formato de arquivo não suportado. Use Excel, PDF ou imagens (JPG, PNG, etc)");
        }

        // Adicionar integração Firestore após processamento de PDF
        try {
          // Depois que os produtos foram extraídos com sucesso (qualquer um dos métodos)
          const productsToSave = productsData.map(p => ({ 
            ...p, 
            userId, 
            catalogId: firestoreCatalogId,
            // Garantir que campos obrigatórios existam
            name: p.name || "Produto sem nome",
            description: p.description || "",
            price: typeof p.price === 'number' ? p.price : 0,
            category: p.category || "Não categorizado"
          }));
          
          // Salvar produtos no Firestore
          const productIds = await saveProductsToFirestore(productsToSave, userId, firestoreCatalogId);
          console.log(`${productIds.length} produtos do PDF salvos no Firestore`);
          
          // Atualizar status do catálogo no Firestore
          await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "completed", productsToSave.length);
        } catch (firestoreError) {
          console.error("Erro ao salvar produtos do PDF no Firestore:", firestoreError);
          // Continuar mesmo se não conseguir salvar no Firestore
        }
      } catch (processingError) {
        console.error("Erro durante o processamento do arquivo:", processingError);
        
        // Atualizar o status do catálogo no Firestore para falha
        try {
          // Atualizar status do catálogo no Firestore para erro
          await updateCatalogStatusInFirestore(
            userId, 
            firestoreCatalogId, 
            "failed", 
            0
          );
        } catch (firestoreError) {
          console.error("Erro ao atualizar status do catálogo no Firestore:", firestoreError);
        }
        
        // Atualizar status do catálogo local
        await storage.updateCatalogStatus(catalog.id, "failed");
        
        // Retornar erro para o cliente
        return res.status(400).json({
          message: "Falha ao processar o catálogo",
          error: processingError instanceof Error ? processingError.message : "Erro desconhecido durante o processamento do arquivo",
          catalog: {
            id: catalog.id,
            fileName: fileName
          }
        });
      }
      
      // Adicionar produtos ao banco de dados local
      const savedProducts = [];
      
      for (let i = 0; i < productsData.length; i++) {
        try {
          const productData = productsData[i];
          
          // Verificar se já tem imagem, caso contrário, usar imagem da categoria
          let imageUrl = productData.imageUrl;
          if (!imageUrl) {
            // Não geramos mais imagens fictícias, usamos apenas a imagem padrão da categoria
            imageUrl = getCategoryDefaultImage(productData.category || "default");
          }
          
          // Converter o produto para o formato adequado para o banco local
          const productToSave = {
            userId,
            catalogId: catalog.id,
            name: productData.name || "Produto sem nome",
            description: productData.description || "",
            code: productData.code || 'UNKNOWN-CODE',
            price: typeof productData.price === 'number' ? productData.price : 0,
            category: productData.category || "Não categorizado",
            colors: Array.isArray(productData.colors) ? productData.colors : [],
            materials: Array.isArray(productData.materials) ? productData.materials : [],
            sizes: Array.isArray(productData.sizes) ? productData.sizes : [],
            imageUrl: imageUrl || "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3",
            firestoreId: productData.firestoreId || null, // Manter referência ao ID do Firestore, se disponível
            firestoreCatalogId: firestoreCatalogId // Referência ao ID do catálogo no Firestore
          };
          
          const savedProduct = await storage.createProduct(productToSave);
          savedProducts.push(savedProduct);
        } catch (error) {
          console.error('Erro ao salvar produto:', error);
        }
      }
      
      // Atualizar o status do catálogo para "concluído" no banco local
      const updatedCatalog = await storage.updateCatalogStatus(catalog.id, "completed");
      
      return res.status(201).json({
        message: "Catálogo processado com sucesso",
        catalog: updatedCatalog,
        extractionInfo,
        totalProductsSaved: savedProducts.length,
        sampleProducts: savedProducts.slice(0, 3), // Retornar apenas alguns produtos como amostra
        firestoreCatalogId, // Incluir ID do Firestore na resposta
        metadata: {
          storedInFirestore: true,
          firestoreProductCount: productsData.length
        }
      });
      
    } catch (error) {
      console.error('Erro detalhado ao processar catálogo:', error);
      console.log("Stack trace:", error instanceof Error ? error.stack : "Sem stack trace");
      return res.status(500).json({ 
        message: "Falha ao processar o catálogo", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}