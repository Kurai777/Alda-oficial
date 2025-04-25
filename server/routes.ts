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
import mime from "mime-types";
// Importar utilitário para páginas de teste
// Import old test routes
import { addTestRoutes } from "./test-upload.js";

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
    fileSize: 100 * 1024 * 1024, // 100MB max
    fieldSize: 100 * 1024 * 1024 // Também aumentar o tamanho do campo
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
// Nenhuma imagem fictícia deve ser usada

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
      const { uid, email, companyName, displayName } = req.body;
      
      if (!uid || !email) {
        return res.status(400).json({ message: "UID and email are required" });
      }
      
      // Verificar se o usuário já existe
      let user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Criar um novo usuário se não existir
        user = await storage.createUser({
          email,
          companyName: companyName || displayName || 'Empresa',
          password: `firebase-${uid}`, // Senha não será usada, mas é necessária para o schema
        });
        
        console.log(`Criado novo usuário para conta Firebase: ${email}`);
      } else if (companyName || displayName) {
        // Atualizar o nome da empresa se fornecido
        user = await storage.updateUser(user.id, {
          companyName: companyName || displayName
        });
        console.log(`Atualizado nome da empresa para usuário ${email}: ${companyName || displayName}`);
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
          companyName: req.firebaseUser.displayName || req.firebaseUser.name || 'Empresa',
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
      
      // Buscar produtos do storage
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
      
      // Buscar catálogos
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
  
  // Rota para excluir um catálogo
  app.delete("/api/catalogs/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID de catálogo inválido" });
      }
      
      console.log(`Recebida solicitação para excluir catálogo com ID ${id}`);
      
      // Obter catálogo para verificar se existe
      const catalog = await storage.getCatalog(id);
      if (!catalog) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      // Excluir o catálogo e seus produtos
      const success = await storage.deleteCatalog(id);
      
      if (!success) {
        return res.status(500).json({ message: "Falha ao excluir catálogo" });
      }
      
      console.log(`Catálogo ${id} excluído com sucesso`);
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir catálogo:", error);
      return res.status(500).json({ message: "Falha ao excluir catálogo", error: String(error) });
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
      
      // Garantir que userId seja numérico para o banco local PostgreSQL
      const localUserId = typeof userId === 'string' ? 
        parseInt(userId.replace(/\D/g, '')) || 1 : // Tentar extrair números do UID ou usar 1 como fallback
        userId;
      
      const catalog = await storage.createCatalog({
        userId: localUserId, // Usar ID numérico para o banco local
        fileName,
        fileUrl: filePath,
        processedStatus: "processing",
        firestoreCatalogId,
        firebaseUserId: typeof userId === 'string' ? userId : undefined // Preservar o UID do Firebase
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
        
        // Atualizar o catálogo local com o ID do Firestore e ID do usuário Firebase
        await storage.updateCatalogStatus(catalog.id, "processing", firestoreCatalogId, typeof userId === 'string' ? userId : undefined);
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
            // Criar diretório para imagens extraídas se não existir
            const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images');
            if (!fs.existsSync(extractedImagesDir)) {
              await mkdir(extractedImagesDir, { recursive: true });
            }
            
            // Verificar se é um catálogo no formato Sofá Home/POE
            const isSofaHomeFormat = fileName.toLowerCase().includes('sofá') || 
                                     fileName.toLowerCase().includes('sofa home') || 
                                     fileName.toLowerCase().includes('poe');
            
            if (isSofaHomeFormat) {
              console.log("Detectado formato especial Sofá Home/POE - usando processador com colunas fixas");
            }
            
            // Importar o processador de colunas fixas
            const { processExcelWithFixedColumns } = await import('./fixed-excel-processor');
            
            // Usar o processador com colunas fixas para extrair os dados do Excel
            console.log(`Iniciando processamento do arquivo Excel com colunas fixas: ${filePath}`);
            console.log(`Usuário ID: ${userId}, Catálogo ID: ${firestoreCatalogId}`);
            
            // Processar o Excel com o novo formato de colunas fixas
            try {
              productsData = await processExcelWithFixedColumns(filePath, userId, firestoreCatalogId);
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (colunas fixas).`;
              
              // Verificar produtos com imagens
              let productsWithImages = 0;
              for (const product of productsData) {
                if (product.imageUrl) {
                  productsWithImages++;
                  console.log(`Produto ${product.codigo || product.nome} tem imagem: ${product.imageUrl}`);
                }
              }
              console.log(`${productsWithImages} produtos contêm imagens (${Math.round(productsWithImages/productsData.length*100)}%)`);
              
              console.log(`Processamento de produtos e imagens concluído: ${productsData.length} produtos.`);
            } catch (fixedColumnsError) {
              console.error("Erro ao processar Excel com colunas fixas:", fixedColumnsError);
              
              // Tentar método tradicional como fallback
              console.log("Tentando método tradicional de processamento Excel...");
              productsData = await processExcelFile(filePath, userId, firestoreCatalogId);
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (método tradicional).`;
              
              // Verificar produtos com imagens
              let productsWithImages = 0;
              for (const product of productsData) {
                if (product.imageUrl) {
                  productsWithImages++;
                  console.log(`Produto ${product.code || product.name} tem imagem: ${product.imageUrl}`);
                }
              }
              console.log(`${productsWithImages} produtos contêm imagens (${Math.round(productsWithImages/productsData.length*100)}%)`);
              
              console.log(`Processamento de produtos e imagens concluído: ${productsData.length} produtos.`);
            }
            
            // Salvar produtos no Firestore
            try {
              // Mapear produtos para o formato esperado pelo Firestore
              const productsForFirestore = productsData.map(p => {
                // Se for do formato de colunas fixas
                if ('codigo' in p) {
                  return {
                    userId,
                    catalogId: firestoreCatalogId,
                    name: p.nome,
                    description: p.descricao,
                    code: p.codigo,
                    price: parseFloat(p.preco.replace('R$', '').replace('.', '').replace(',', '.')) || 0,
                    imageUrl: p.imageUrl,
                    location: p.local,
                    supplier: p.fornecedor,
                    quantity: p.quantidade || 0,
                    isEdited: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  };
                } else {
                  // Formato tradicional
                  return { ...p, userId, catalogId: firestoreCatalogId };
                }
              });
              
              const productIds = await saveProductsToFirestore(
                productsForFirestore, 
                userId, 
                firestoreCatalogId
              );
              console.log(`${productIds.length} produtos do Excel salvos no Firestore`);
              
              // Atualizar status do catálogo no Firestore
              await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "completed", productsData.length);
              
              // Salvar produtos no banco de dados relacional
              try {
                console.log("Salvando produtos no banco de dados relacional...");
                for (const product of productsData) {
                  // Criar novo produto
                  const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
                  
                  try {
                    console.log(`Criando produto: ${product.name}, código: ${product.code}`);
                    await storage.createProduct({
                      ...product,
                      userId: parsedUserId,
                      catalogId
                    });
                  } catch (productError) {
                    console.error(`Erro ao criar produto ${product.code}:`, productError);
                  }
                }
                console.log(`${productsData.length} produtos salvos no banco de dados.`);
              } catch (dbError) {
                console.error("Erro ao salvar produtos no banco de dados:", dbError);
              }
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
              
              // Salvar produtos no banco de dados relacional (método alternativo)
              try {
                console.log("Salvando produtos no banco de dados relacional (método alternativo)...");
                for (const product of productsData) {
                  // Criar novo produto
                  const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
                  
                  try {
                    console.log(`Criando produto: ${product.name}, código: ${product.code}`);
                    await storage.createProduct({
                      ...product,
                      userId: parsedUserId,
                      catalogId
                    });
                  } catch (productError) {
                    console.error(`Erro ao criar produto ${product.code}:`, productError);
                  }
                }
                console.log(`${productsData.length} produtos salvos no banco de dados.`);
              } catch (dbError) {
                console.error("Erro ao salvar produtos no banco de dados:", dbError);
              }
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
            const { processCatalogPdf } = await import('./pdf-ai-pipeline');
            
            // Executar o pipeline completo com PDF2Image + IA
            console.log(`Iniciando pipeline automatizado para: ${filePath}`);
            productsData = await processCatalogPdf(filePath, {
              userId,
              catalogId: catalog.id,
              maxPages: 20, // Limitar a 20 páginas para processamento mais rápido
              startPage: 1
            });
            
            // Verificar se temos produtos extraídos
            if (!productsData || productsData.length === 0) {
              throw new Error("O pipeline automatizado não conseguiu extrair produtos do PDF");
            }
            
            console.log(`Pipeline automatizado extraiu ${productsData.length} produtos do PDF`);
            extractionInfo = `PDF processado com pipeline automatizado (PDF2Image + OpenAI/Claude). Extraídos ${productsData.length} produtos.`;
            
            // Salvar produtos no banco de dados relacional
            try {
              console.log("Salvando produtos extraídos do PDF no banco de dados relacional...");
              for (const product of productsData) {
                // Criar novo produto
                const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
                
                try {
                  console.log(`Criando produto: ${product.name}, código: ${product.code}`);
                  await storage.createProduct({
                    ...product,
                    userId: parsedUserId,
                    catalogId
                  });
                } catch (productError) {
                  console.error(`Erro ao criar produto ${product.code || 'sem código'}:`, productError);
                }
              }
              console.log(`${productsData.length} produtos extraídos do PDF salvos no banco de dados.`);
            } catch (dbError) {
              console.error("Erro ao salvar produtos do PDF no banco de dados:", dbError);
            }
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
                
                // Salvar produtos no banco de dados relacional
                try {
                  console.log("Salvando produtos extraídos pelo Claude no banco de dados relacional...");
                  for (const product of productsData) {
                    // Criar novo produto
                    const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
                    
                    try {
                      console.log(`Criando produto: ${product.name}, código: ${product.code || 'sem código'}`);
                      await storage.createProduct({
                        ...product,
                        userId: parsedUserId,
                        catalogId
                      });
                    } catch (productError) {
                      console.error(`Erro ao criar produto ${product.code || 'sem código'}:`, productError);
                    }
                  }
                  console.log(`${productsData.length} produtos extraídos pelo Claude salvos no banco de dados.`);
                } catch (dbError) {
                  console.error("Erro ao salvar produtos do Claude no banco de dados:", dbError);
                }
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
                
                // Salvar produtos no banco de dados relacional
                try {
                  console.log("Salvando produtos extraídos por OCR no banco de dados relacional...");
                  for (const product of productsData) {
                    // Criar novo produto
                    const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
                    
                    try {
                      console.log(`Criando produto: ${product.name}, código: ${product.code || 'sem código'}`);
                      await storage.createProduct({
                        ...product,
                        userId: parsedUserId,
                        catalogId
                      });
                    } catch (productError) {
                      console.error(`Erro ao criar produto ${product.code || 'sem código'}:`, productError);
                    }
                  }
                  console.log(`${productsData.length} produtos extraídos por OCR salvos no banco de dados.`);
                } catch (dbError) {
                  console.error("Erro ao salvar produtos do OCR no banco de dados:", dbError);
                }
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
            // Não usar imagens fictícias
            imageUrl = null; // Produtos sem imagem devem ter o campo null
          }
          
          // Converter o produto para o formato adequado para o banco local
          // Garantir que userId seja numérico para o banco local PostgreSQL
          const localUserId = typeof userId === 'string' ? 
            parseInt(userId.replace(/\D/g, '')) || 1 : // Tentar extrair números do UID ou usar 1 como fallback
            userId;
            
          const productToSave = {
            userId: localUserId, // Usar o ID numérico para o banco local
            catalogId: catalog.id,
            name: productData.name || "Produto sem nome",
            description: productData.description || "",
            code: productData.code || 'UNKNOWN-CODE',
            price: typeof productData.price === 'number' ? productData.price : 0,
            category: productData.category || "Não categorizado",
            colors: Array.isArray(productData.colors) ? productData.colors : [],
            materials: Array.isArray(productData.materials) ? productData.materials : [],
            sizes: Array.isArray(productData.sizes) ? productData.sizes : [],
            imageUrl: imageUrl,
            firestoreId: productData.firestoreId || null, // Manter referência ao ID do Firestore, se disponível
            firestoreCatalogId: firestoreCatalogId, // Referência ao ID do catálogo no Firestore
            firebaseUserId: typeof userId === 'string' ? userId : undefined // Preservar o UID do Firebase quando disponível
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

  // Rotas para projetos de design com IA
  app.get("/api/ai-design-projects", async (req, res) => {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        return res.status(400).json({ message: "ID de usuário é obrigatório" });
      }

      const projects = await storage.getAllAiDesignProjects(userId);
      res.json(projects);
    } catch (error) {
      console.error("Erro ao buscar projetos de design:", error);
      res.status(500).json({ 
        message: "Falha ao buscar projetos", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  app.get("/api/ai-design-projects/:id", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }

      const project = await storage.getAiDesignProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      res.json(project);
    } catch (error) {
      console.error("Erro ao buscar projeto de design:", error);
      res.status(500).json({ 
        message: "Falha ao buscar projeto", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  app.post("/api/ai-design-projects", async (req, res) => {
    try {
      const { title, userId, floorPlanImageUrl, renderImageUrl, quoteId, moodboardId } = req.body;

      if (!title || !userId) {
        return res.status(400).json({ message: "Título e ID do usuário são obrigatórios" });
      }

      const project = await storage.createAiDesignProject({
        title,
        userId,
        floorPlanImageUrl,
        renderImageUrl,
        quoteId,
        moodboardId
      });

      // Criar mensagem de sistema inicial
      await storage.createAiDesignChatMessage({
        projectId: project.id,
        role: "system",
        content: "Bem-vindo ao assistente de design! Envie uma planta baixa e um render do ambiente para encontrar móveis semelhantes em nosso catálogo."
      });

      res.status(201).json(project);
    } catch (error) {
      console.error("Erro ao criar projeto de design:", error);
      res.status(500).json({ 
        message: "Falha ao criar projeto", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  app.put("/api/ai-design-projects/:id", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }

      const project = await storage.getAiDesignProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      const updatedProject = await storage.updateAiDesignProject(projectId, req.body);
      res.json(updatedProject);
    } catch (error) {
      console.error("Erro ao atualizar projeto de design:", error);
      res.status(500).json({ 
        message: "Falha ao atualizar projeto", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  app.delete("/api/ai-design-projects/:id", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }

      const project = await storage.getAiDesignProject(projectId);
      
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      await storage.deleteAiDesignProject(projectId);
      res.sendStatus(204);
    } catch (error) {
      console.error("Erro ao excluir projeto de design:", error);
      res.status(500).json({ 
        message: "Falha ao excluir projeto", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  // Rotas para mensagens de chat de projetos de design
  app.get("/api/ai-design-projects/:id/messages", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }

      const messages = await storage.getAiDesignChatMessages(projectId);
      res.json(messages);
    } catch (error) {
      console.error("Erro ao buscar mensagens de chat:", error);
      res.status(500).json({ 
        message: "Falha ao buscar mensagens", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });

  app.post("/api/ai-design-projects/:id/messages", async (req, res) => {
    try {
      const projectId = parseInt(req.params.id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }

      const { role, content, attachmentUrl } = req.body;

      if (!role || !content) {
        return res.status(400).json({ message: "Função e conteúdo são obrigatórios" });
      }

      // Certifique-se de que o projeto existe
      const project = await storage.getAiDesignProject(projectId);
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }

      const message = await storage.createAiDesignChatMessage({
        projectId,
        role,
        content,
        attachmentUrl
      });

      // Se for uma mensagem do usuário, processe-a com a IA para gerar uma resposta
      if (role === "user") {
        // Criar mensagem temporária informando que está processando
        const processingMessage = await storage.createAiDesignChatMessage({
          projectId,
          role: "assistant",
          content: "Estou processando sua solicitação. Isso pode levar alguns instantes..."
        });
        
        // Iniciar processamento em segundo plano para não bloquear a resposta HTTP
        import('./ai-design-processor')
          .then(async (processor) => {
            try {
              // Verificar se a mensagem contém uma URL de imagem de planta ou render
              if (attachmentUrl) {
                // Atualizar o projeto com a URL da imagem, se não estiver definida
                const projectUpdate: any = {};
                
                // Detectar tipo de imagem baseado na mensagem e no conteúdo
                const isFloorPlan = content.toLowerCase().includes('planta') || 
                                  content.toLowerCase().includes('baixa') ||
                                  content.toLowerCase().includes('floor');
                
                const isRender = content.toLowerCase().includes('render') || 
                               content.toLowerCase().includes('3d') ||
                               content.toLowerCase().includes('perspective');
                
                if (isFloorPlan && !project.floorPlanImageUrl) {
                  projectUpdate.floorPlanImageUrl = attachmentUrl;
                  await storage.updateAiDesignProject(projectId, projectUpdate);
                  
                  // Reconhecer recebimento da planta baixa
                  await storage.createAiDesignChatMessage({
                    projectId,
                    role: "assistant",
                    content: "Recebi sua planta baixa! Se você também tiver um render do ambiente, por favor envie para que eu possa analisar completamente."
                  });
                } 
                else if (isRender && !project.renderImageUrl) {
                  projectUpdate.renderImageUrl = attachmentUrl;
                  await storage.updateAiDesignProject(projectId, projectUpdate);
                  
                  // Reconhecer recebimento do render
                  await storage.createAiDesignChatMessage({
                    projectId,
                    role: "assistant",
                    content: "Recebi seu render! Se você também tiver uma planta baixa do ambiente, por favor envie para que eu possa analisar completamente."
                  });
                }
                
                // Se temos ambas as imagens, processar o projeto completo
                const updatedProject = await storage.getAiDesignProject(projectId);
                if (updatedProject?.floorPlanImageUrl && updatedProject?.renderImageUrl) {
                  // Remover a mensagem de processamento
                  await storage.createAiDesignChatMessage({
                    projectId,
                    role: "assistant",
                    content: "Recebi todas as imagens necessárias! Agora vou processar seu projeto completo. Isso pode levar alguns minutos..."
                  });
                  
                  // Processar o projeto em background
                  processor.processAiDesignProject(projectId).catch(error => {
                    console.error("Erro no processamento assíncrono do projeto:", error);
                  });
                }
              } else {
                // Se não tiver anexo, é uma mensagem de texto normal
                // Vamos gerar uma resposta genérica
                
                // Remover a mensagem de processamento
                await storage.createAiDesignChatMessage({
                  projectId,
                  role: "assistant",
                  content: "Para que eu possa ajudar a substituir os móveis fictícios por produtos reais do catálogo, preciso que você envie as imagens do ambiente: uma planta baixa e um render em 3D. Você pode anexá-los nas próximas mensagens."
                });
              }
            } catch (processingError) {
              console.error("Erro no processamento da mensagem:", processingError);
              
              // Informar erro ao usuário
              await storage.createAiDesignChatMessage({
                projectId,
                role: "assistant",
                content: "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente ou entre em contato com o suporte."
              });
            }
          })
          .catch(importError => {
            console.error("Erro ao importar o processador:", importError);
          });
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Erro ao criar mensagem de chat:", error);
      res.status(500).json({ 
        message: "Falha ao criar mensagem", 
        error: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  });
  
  // Tipos para o resultado da extração de imagens
  type ExtractionSuccess = {
    success: true;
    extractedCount: number;
    sampleUrls: string[];
  };
  
  type ExtractionError = {
    success: false;
    error: string;
  };
  
  type ExtractionResult = ExtractionSuccess | ExtractionError | null;
  
  interface ExcelImageResults {
    fileName: string;
    products: {
      count: number;
      sample: any[];
    };
    jsCheck: {
      hasImages: boolean;
      method: string;
    };
    pythonCheck: {
      hasImages: boolean;
      method: string;
    };
    extraction?: {
      js: ExtractionResult;
      python: ExtractionResult;
    };
  }

  // Rota de teste para extração de imagens de Excel
  app.post("/api/test/excel-images", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;
      
      console.log(`Arquivo recebido: ${fileName} (${filePath})`);
      
      // Verificar se é um arquivo Excel
      if (!fileName.toLowerCase().endsWith('.xlsx') && !fileName.toLowerCase().endsWith('.xls')) {
        return res.status(400).json({ message: "O arquivo deve ser um Excel (.xlsx ou .xls)" });
      }
      
      // Importar os módulos de extração de imagens
      const { hasExcelImages, extractImagesFromExcel } = await import('./robust-excel-image-extractor.js');
      const { hasExcelImagesWithPython, extractImagesWithPythonBridge } = await import('./python-excel-bridge.js');
      
      // Verificar se o arquivo contém imagens usando JavaScript
      console.log("Verificando imagens com JavaScript...");
      const hasImages = await hasExcelImages(filePath);
      
      // Verificar se o arquivo contém imagens usando Python
      console.log("Verificando imagens com Python...");
      const hasImagesPython = await hasExcelImagesWithPython(filePath);
      
      // Extrair produtos básicos do Excel para associar às imagens
      console.log("Extraindo produtos do Excel...");
      const { processExcelFile } = await import('./excel-processor');
      const products = await processExcelFile(filePath, "test-user", "test-catalog");
      
      // Resultados
      const results: ExcelImageResults = {
        fileName,
        products: {
          count: products.length,
          sample: products.slice(0, 3) // Apenas uma amostra dos produtos
        },
        jsCheck: {
          hasImages,
          method: "JavaScript (JSZip)"
        },
        pythonCheck: {
          hasImages: hasImagesPython,
          method: "Python (multiple methods)"
        }
      };
      
      // Se tiver imagens, tentar extrair
      if (hasImages || hasImagesPython) {
        console.log("Arquivo contém imagens, tentando extrair...");
        
        // Resultados das extrações
        const extractionResults = {
          js: null as ExtractionResult,
          python: null as ExtractionResult
        };
        
        // Tentar com JavaScript
        if (hasImages) {
          try {
            console.log("Extraindo imagens com JavaScript...");
            const jsProducts = await extractImagesFromExcel(filePath, products, "test-user", "test-catalog");
            const jsProductsWithImages = jsProducts.filter((p: any) => p.imageUrl);
            
            extractionResults.js = {
              success: true,
              extractedCount: jsProductsWithImages.length,
              sampleUrls: jsProductsWithImages.slice(0, 3).map((p: any) => p.imageUrl)
            };
          } catch (error) {
            console.error("Erro na extração JS:", error);
            extractionResults.js = {
              success: false,
              error: error instanceof Error ? error.message : "Erro desconhecido"
            };
          }
        }
        
        // Tentar com Python
        if (hasImagesPython) {
          try {
            console.log("Extraindo imagens com Python...");
            const pythonProducts = await extractImagesWithPythonBridge(filePath, products, "test-user", "test-catalog");
            const pythonProductsWithImages = pythonProducts.filter((p: any) => p.imageUrl);
            
            extractionResults.python = {
              success: true,
              extractedCount: pythonProductsWithImages.length,
              sampleUrls: pythonProductsWithImages.slice(0, 3).map((p: any) => p.imageUrl)
            };
          } catch (error) {
            console.error("Erro na extração Python:", error);
            extractionResults.python = {
              success: false,
              error: error instanceof Error ? error.message : "Erro desconhecido"
            };
          }
        }
        
        results.extraction = extractionResults;
      }
      
      // Retornar resultados detalhados
      res.status(200).json({
        message: "Teste de extração de imagens concluído",
        results
      });
      
    } catch (error) {
      console.error("Erro no teste de extração de imagens:", error);
      res.status(500).json({ 
        message: "Falha no teste de extração de imagens", 
        error: error instanceof Error ? error.message : "Erro desconhecido",
        stack: error instanceof Error ? error.stack : null
      });
    }
  });

  // Rota para servir imagens localmente
  app.get("/api/images/:userId/:catalogId/:filename", (req: Request, res: Response) => {
    try {
      const { userId, catalogId, filename } = req.params;
      
      // Verificar se o usuário que está solicitando é o mesmo dono da imagem
      // Isso é essencial para garantir o isolamento entre usuários
      if (req.session?.userId && req.session.userId.toString() !== userId && userId !== 'mock') {
        console.error(`Tentativa de acesso não autorizado: userId da sessão ${req.session.userId} tentando acessar imagens do usuário ${userId}`);
        // Para fins de desenvolvimento, não bloquear o acesso ainda
        // return res.status(403).json({ message: "Acesso não autorizado" });
      }
      
      // Lista de caminhos possíveis para a imagem, em ordem de prioridade
      const possiblePaths = [
        // 1. Caminho exato solicitado
        path.join(process.cwd(), 'uploads', 'images', userId, catalogId, filename),
        
        // 2. Diretórios de compatibilidade com o mesmo userId
        ...Array.from({length: 5}, (_, i) => 
          path.join(process.cwd(), 'uploads', 'images', userId, `local-${i+1}`, filename)),
        
        // 3. Diretórios com userId=1 (para compatibilidade com produtos existentes)
        path.join(process.cwd(), 'uploads', 'images', '1', catalogId, filename),
        
        // 4. Diretórios de compatibilidade com userId=1
        ...Array.from({length: 5}, (_, i) => 
          path.join(process.cwd(), 'uploads', 'images', '1', `local-${i+1}`, filename)),
      ];
      
      // Procurar a imagem em todos os caminhos possíveis
      let imagePath = null;
      for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
          imagePath = path;
          break;
        }
      }
      
      // Se não encontrou a imagem em nenhum local
      if (!imagePath) {
        console.error(`Imagem não encontrada: ${filename} (userId=${userId}, catalogId=${catalogId})`);
        console.log('Caminhos verificados:', possiblePaths);

        // Gerar um SVG placeholder
        const svgContent = `
        <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
          <rect width="600" height="400" fill="#f9f9f9" />
          <text x="300" y="200" font-family="Arial" font-size="16" fill="#666666" text-anchor="middle">
            Imagem não encontrada: ${filename}
          </text>
        </svg>`;
        
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svgContent);
      }
      
      // Determinar o tipo MIME com base na extensão do arquivo
      const contentType = mime.lookup(filename) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      
      // Servir o arquivo
      res.sendFile(imagePath);
    } catch (error) {
      console.error('Erro ao servir imagem:', error);
      res.status(500).json({ message: "Erro ao servir imagem" });
    }
  });
  
  // Rota de fallback para URLs mock
  app.get("/mock-firebase-storage.com/:userId/:catalogId/:filename", (req: Request, res: Response) => {
    try {
      const { userId, catalogId, filename } = req.params;
      
      // Verificar diretamente nos diretórios esperados de cada URL
      const possiblePaths = [
        // 1. Caminho exato a partir dos parâmetros (se o arquivo existe diretamente)
        path.join(process.cwd(), 'uploads', 'images', userId, catalogId, filename),
        
        // 2. Caminhos alternativos com local-X
        ...Array.from({length: 5}, (_, i) => 
          path.join(process.cwd(), 'uploads', 'images', userId, `local-${i+1}`, filename)),
        
        // 3. Caminhos para userId = 1 (frequentemente usado no sistema)
        path.join(process.cwd(), 'uploads', 'images', '1', catalogId, filename),
        
        // 4. Todos os locais possíveis com userId = 1
        ...Array.from({length: 5}, (_, i) => 
          path.join(process.cwd(), 'uploads', 'images', '1', `local-${i+1}`, filename)),
      ];
      
      // Verificar se existe em algum dos caminhos
      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          // Servir diretamente o arquivo para evitar redirecionamentos adicionais
          console.log(`Imagem mock encontrada em: ${filePath}`);
          const contentType = mime.lookup(filePath) || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          return res.sendFile(filePath);
        }
      }
      
      // Se chegou aqui, tente servir um SVG placeholder
      // Vamos tentar criar a imagem sob demanda no local correto
      try {
        // Garantir que o diretório alvo existe
        const targetDir = path.join(process.cwd(), 'uploads', 'images', userId, catalogId);
        fs.mkdirSync(targetDir, { recursive: true });
        
        // Criar um SVG dinâmico para o placeholder
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#708090" />
  <text x="300" y="200" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
    ${filename}
  </text>
</svg>`;
        
        // Salvar o arquivo SVG no local esperado
        const targetFile = path.join(targetDir, filename);
        fs.writeFileSync(targetFile, svgContent);
        
        console.log(`Imagem placeholder criada em: ${targetFile}`);
        
        // Servir a imagem recém-criada
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.sendFile(targetFile);
      } catch (createError) {
        console.error('Erro ao criar placeholder:', createError);
        
        // Se falhar a criação, servir o SVG diretamente na resposta
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#708090" />
  <text x="300" y="200" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
    ${filename}
  </text>
</svg>`;
        
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svgContent);
      }
    } catch (error) {
      console.error('Erro ao processar URL mock:', error);
      
      // Em último caso, enviar SVG diretamente na resposta
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#A9A9A9" />
  <text x="300" y="200" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
    Imagem não disponível
  </text>
</svg>`;
      
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svgContent);
    }
  });
  
  // Rota para servir imagens por ID de produto
  app.get("/api/product-image/:productId", async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      
      // Usar o novo serviço de imagens para obter informações da imagem
      const { getProductImageInfo } = await import('./image-service');
      const imageInfo = await getProductImageInfo(parseInt(productId));
      
      // Se a URL for absoluta (http, https), redirecionar para ela
      if (imageInfo.url.startsWith('http://') || imageInfo.url.startsWith('https://')) {
        return res.redirect(imageInfo.url);
      }
      
      // Se temos um caminho local completo, servir o arquivo diretamente
      if (imageInfo.localPath && fs.existsSync(imageInfo.localPath)) {
        res.setHeader('Content-Type', imageInfo.contentType);
        return res.sendFile(imageInfo.localPath);
      }
      
      // Se for um placeholder, servir o arquivo do diretório public
      if (imageInfo.url.startsWith('/placeholders/')) {
        const placeholderPath = path.join(process.cwd(), 'public', imageInfo.url);
        if (fs.existsSync(placeholderPath)) {
          res.setHeader('Content-Type', imageInfo.contentType);
          return res.sendFile(placeholderPath);
        }
      }
      
      // Para qualquer outra URL relativa, servir o arquivo se existir
      const fullPath = path.join(process.cwd(), imageInfo.url.startsWith('/') ? imageInfo.url.substring(1) : imageInfo.url);
      if (fs.existsSync(fullPath)) {
        res.setHeader('Content-Type', imageInfo.contentType);
        return res.sendFile(fullPath);
      }
      
      // Se nada foi encontrado, servir o fallback padrão
      const defaultPlaceholder = path.join(process.cwd(), 'public', 'placeholders', 'default.svg');
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(defaultPlaceholder);
      
    } catch (error) {
      console.error('Erro ao servir imagem de produto:', error);
      
      // Em caso de erro, servir o fallback padrão
      const defaultPlaceholder = path.join(process.cwd(), 'public', 'placeholders', 'default.svg');
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(defaultPlaceholder);
    }
  });

  // Rota para servir imagens extraídas
  app.get("/uploads/extracted_images/:filename", (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      
      // Caminho da imagem no sistema de arquivos
      const imagePath = path.join(process.cwd(), 'uploads', 'extracted_images', filename);
      
      console.log(`Servindo imagem extraída: ${imagePath}`);
      
      if (!fs.existsSync(imagePath)) {
        console.error(`Imagem extraída não encontrada: ${imagePath}`);
        // Gerar SVG placeholder
        const svgContent = `
        <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
          <rect width="600" height="400" fill="#dddddd" />
          <text x="300" y="200" font-family="Arial" font-size="16" fill="#666666" text-anchor="middle">
            Imagem não disponível (${filename})
          </text>
        </svg>`;
        
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svgContent);
      }
      
      // Determinar o tipo MIME com base na extensão do arquivo
      const contentType = mime.lookup(filename) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      
      // Servir o arquivo
      res.sendFile(imagePath);
    } catch (error) {
      console.error('Erro ao servir imagem extraída:', error);
      res.status(500).json({ message: "Erro ao servir imagem extraída" });
    }
  });

  // Adicionar rotas de teste
  addTestRoutes(app);
  
  // Página HTML de teste para extração de imagens Excel
  app.get("/test/excel-images", async (req: Request, res: Response) => {
    try {
      // Renderizar página HTML de teste
      const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Teste de Extração de Imagens Excel</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 { color: #333; }
          form {
            margin-bottom: 20px;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 15px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          .button:hover {
            background-color: #45a049;
          }
          pre {
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 20px;
          }
          .card {
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
          }
          .card img {
            max-width: 100%;
            height: auto;
            margin-bottom: 10px;
          }
          .debug-panel {
            background-color: #f8f9fa;
            border: 1px solid #ddd;
            padding: 10px;
            margin-top: 20px;
          }
          .debug-panel h3 {
            margin-top: 0;
          }
          .test-section {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px dashed #ccc;
          }
        </style>
      </head>
      <body>
        <h1>Teste de Extração de Imagens de Excel</h1>
        
        <div class="test-section">
          <form action="/api/test/excel-images" method="post" enctype="multipart/form-data">
            <h2>Envie um arquivo Excel com imagens</h2>
            <p>Selecione um arquivo Excel (.xlsx ou .xls) que contenha imagens embutidas:</p>
            <input type="file" name="file" accept=".xlsx,.xls" required>
            <br><br>
            <button type="submit" class="button">Processar Arquivo</button>
          </form>
          
          <div id="results">
            <p>Os resultados do processamento aparecerão aqui...</p>
          </div>
        </div>
        
        <div class="test-section">
          <h2>Teste de Salvamento Direto de Imagens</h2>
          <p>Esta opção salva uma imagem de teste diretamente no sistema de arquivos para verificar o funcionamento do salvamento e acesso.</p>
          
          <form id="testImageForm">
            <button type="submit" class="button">Testar Salvamento de Imagem</button>
          </form>
          
          <div id="imageTestResults">
            <p>Os resultados do teste de imagem aparecerão aqui...</p>
          </div>
        </div>
        
        <div class="test-section">
          <h2>Verificar Imagens Salvas</h2>
          <p>Verifica a existência de imagens salvas localmente.</p>
          
          <form id="checkImagesForm">
            <button type="submit" class="button">Verificar Imagens</button>
          </form>
          
          <div id="checkImagesResults">
            <p>Os resultados da verificação aparecerão aqui...</p>
          </div>
        </div>
        
        <script>
          // Formulário principal de processamento de Excel
          document.querySelector('form[action="/api/test/excel-images"]').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const form = e.target;
            const formData = new FormData(form);
            
            // Atualizar mensagem
            document.querySelector('#results').innerHTML = '<p>Processando arquivo... Isso pode levar alguns segundos.</p>';
            
            try {
              const response = await fetch(form.action, {
                method: form.method,
                body: formData
              });
              
              const data = await response.json();
              
              // Mostrar resultados
              let html = '<h2>Resultados</h2>';
              
              if (data.error) {
                html += \`<div class="error"><p>Erro: \${data.error}</p>\`;
                if (data.details) {
                  html += \`<p>\${data.details}</p>\`;
                }
                html += '</div>';
              } else {
                html += \`<p>\${data.message}</p>\`;
                
                // Mostrar resultados da extração JS
                if (data.results?.js) {
                  html += '<h3>Extração via JavaScript</h3>';
                  html += \`<p>Detecção: \${data.results.js.hasImages ? 'Imagens detectadas' : 'Nenhuma imagem detectada'}</p>\`;
                  
                  if (data.results.js.products && data.results.js.products.length > 0) {
                    html += \`<p>Produtos com imagens: \${data.results.js.products.filter(p => p.imageUrl).length} de \${data.results.js.products.length}</p>\`;
                    
                    // Mostrar amostra de produtos
                    html += '<div class="grid">';
                    for (const product of data.results.js.products.slice(0, 10)) {
                      html += '<div class="card">';
                      if (product.imageUrl) {
                        html += \`<img src="\${product.imageUrl}" alt="\${product.name || product.code}" onerror="this.onerror=null; this.src='/placeholder.jpg'; this.title='Erro ao carregar imagem: ' + this.src;">\`;
                        html += \`<p>URL: \${product.imageUrl}</p>\`;
                      } else {
                        html += '<p>Sem imagem</p>';
                      }
                      html += \`<p><strong>\${product.name || 'Sem nome'}</strong></p>\`;
                      html += \`<p>Código: \${product.code || 'N/A'}</p>\`;
                      html += '</div>';
                    }
                    html += '</div>';
                  }
                }
                
                // Mostrar resultados da extração Python
                if (data.results?.python) {
                  html += '<h3>Extração via Python</h3>';
                  html += \`<p>Detecção: \${data.results.python.hasImages ? 'Imagens detectadas' : 'Nenhuma imagem detectada'}</p>\`;
                  
                  if (data.results.python.products && data.results.python.products.length > 0) {
                    html += \`<p>Produtos com imagens: \${data.results.python.products.filter(p => p.imageUrl).length} de \${data.results.python.products.length}</p>\`;
                    
                    // Mostrar amostra de produtos
                    html += '<div class="grid">';
                    for (const product of data.results.python.products.slice(0, 10)) {
                      html += '<div class="card">';
                      if (product.imageUrl) {
                        html += \`<img src="\${product.imageUrl}" alt="\${product.name || product.code}" onerror="this.onerror=null; this.src='/placeholder.jpg'; this.title='Erro ao carregar imagem: ' + this.src;">\`;
                        html += \`<p>URL: \${product.imageUrl}</p>\`;
                      } else {
                        html += '<p>Sem imagem</p>';
                      }
                      html += \`<p><strong>\${product.name || 'Sem nome'}</strong></p>\`;
                      html += \`<p>Código: \${product.code || 'N/A'}</p>\`;
                      html += '</div>';
                    }
                    html += '</div>';
                  }
                }
                
                // Mostrar informações de debug se disponíveis
                if (data.debugInfo) {
                  html += '<div class="debug-panel">';
                  html += '<h3>Informações de Debug</h3>';
                  html += '<pre>' + JSON.stringify(data.debugInfo, null, 2) + '</pre>';
                  html += '</div>';
                }
              }
              
              document.querySelector('#results').innerHTML = html;
              
            } catch (error) {
              document.querySelector('#results').innerHTML = \`<p>Erro: \${error.message}</p>\`;
            }
          });
          
          // Formulário de teste de salvamento de imagem
          document.getElementById('testImageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const resultsDiv = document.getElementById('imageTestResults');
            resultsDiv.innerHTML = '<p>Testando salvamento de imagem...</p>';
            
            try {
              const response = await fetch('/api/test/save-image', {
                method: 'POST'
              });
              
              const data = await response.json();
              
              let html = '<h3>Resultado do Teste de Imagem</h3>';
              
              if (data.error) {
                html += \`<div class="error"><p>Erro: \${data.error}</p>\`;
                if (data.details) {
                  html += \`<p>\${data.details}</p>\`;
                }
                html += '</div>';
              } else {
                html += \`<p>\${data.message}</p>\`;
                
                if (data.imageUrl) {
                  html += '<div style="border: 1px solid #ddd; padding: 15px; text-align: center; margin-top: 15px;">';
                  html += \`<img src="\${data.imageUrl}" alt="Imagem de teste" style="max-width: 300px; max-height: 300px;" onerror="this.onerror=null; this.src='/placeholder.jpg'; this.title='Erro ao carregar imagem';">\`;
                  html += \`<p>URL da imagem: \${data.imageUrl}</p>\`;
                  html += '</div>';
                }
                
                if (data.debugInfo) {
                  html += '<div class="debug-panel">';
                  html += '<h3>Informações de Debug</h3>';
                  html += '<pre>' + JSON.stringify(data.debugInfo, null, 2) + '</pre>';
                  html += '</div>';
                }
              }
              
              resultsDiv.innerHTML = html;
              
            } catch (error) {
              resultsDiv.innerHTML = \`<p>Erro: \${error.message}</p>\`;
            }
          });
          
          // Formulário de verificação de imagens
          document.getElementById('checkImagesForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const resultsDiv = document.getElementById('checkImagesResults');
            resultsDiv.innerHTML = '<p>Verificando imagens salvas...</p>';
            
            try {
              const response = await fetch('/api/test/check-images', {
                method: 'GET'
              });
              
              const data = await response.json();
              
              let html = '<h3>Resultado da Verificação</h3>';
              
              if (data.error) {
                html += \`<div class="error"><p>Erro: \${data.error}</p></div>\`;
              } else {
                html += \`<p>Status: \${data.message}</p>\`;
                
                if (data.images && data.images.length > 0) {
                  html += \`<p>Encontradas \${data.images.length} imagens:</p>\`;
                  
                  html += '<div class="grid">';
                  for (const image of data.images) {
                    html += '<div class="card">';
                    html += \`<img src="\${image.url}" alt="\${image.name}" onerror="this.onerror=null; this.src='/placeholder.jpg'; this.title='Erro ao carregar imagem';">\`;
                    html += \`<p>\${image.name}</p>\`;
                    html += \`<p>Caminho: \${image.path}</p>\`;
                    html += '</div>';
                  }
                  html += '</div>';
                } else {
                  html += '<p>Nenhuma imagem encontrada nos diretórios esperados.</p>';
                }
              }
              
              resultsDiv.innerHTML = html;
              
            } catch (error) {
              resultsDiv.innerHTML = \`<p>Erro: \${error.message}</p>\`;
            }
          });
        </script>
      </body>
      </html>`;

      res.send(htmlTemplate);
    } catch (error) {
      console.error('Erro na rota de teste de imagens Excel:', error);
      res.status(500).send(`Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  });
  
  // Rota para testar o salvamento direto de imagens
  app.post('/api/test/save-image', async (req: Request, res: Response) => {
    try {
      // Importar a função de salvamento de imagens
      const { saveImageToFirebaseStorage } = await import('./firebase-admin');
      
      // Criar uma imagem de teste simples (10x10 pixel vermelho)
      const { createCanvas } = await import('canvas');
      const imageSize = 100;
      const canvas = createCanvas(imageSize, imageSize);
      const ctx = canvas.getContext('2d');
      
      // Preencher com vermelho
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, imageSize, imageSize);
      
      // Adicionar texto para identificação
      ctx.fillStyle = 'white';
      ctx.font = '14px Arial';
      ctx.fillText('Teste', 30, 50);
      
      // Converter para buffer PNG
      const buffer = canvas.toBuffer('image/png');
      
      // Nome de arquivo para o teste
      const testFileName = `test-image-${Date.now()}.png`;
      const userId = '1';
      const catalogId = 'local-1';
      
      // Salvar a imagem
      const imageUrl = await saveImageToFirebaseStorage(
        buffer,
        testFileName,
        userId,
        catalogId
      );
      
      // Verificar se a imagem foi salva
      let imageExists = false;
      let fullPath = '';
      
      if (imageUrl && !imageUrl.startsWith('https://mock-firebase-storage.com')) {
        // Extrair o caminho real do arquivo
        const localPath = imageUrl.replace('/api/images/', '');
        const pathParts = localPath.split('/');
        const urlUserId = pathParts[0];
        const urlCatalogId = pathParts[1];
        const fileName = pathParts[2];
        
        fullPath = path.join(process.cwd(), 'uploads', 'images', urlUserId, urlCatalogId, fileName);
        imageExists = fs.existsSync(fullPath);
      }
      
      // Verificar a imagem na localização de compatibilidade
      const compatPath = path.join(process.cwd(), 'uploads', 'images', '1', 'local-1', testFileName);
      const compatExists = fs.existsSync(compatPath);
      
      res.status(200).json({
        message: 'Teste de salvamento de imagem concluído',
        imageUrl,
        imageExists,
        compatExists,
        debugInfo: {
          fileName: testFileName,
          userId,
          catalogId,
          regularPath: fullPath,
          compatPath
        }
      });
      
    } catch (error) {
      console.error('Erro no teste de salvamento de imagem:', error);
      res.status(500).json({
        error: 'Falha no teste de salvamento de imagem',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });
  
  // Rota para testar a extração de imagens do Excel
  app.post('/api/test/excel-images', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          error: 'Nenhum arquivo enviado', 
          details: 'É necessário enviar um arquivo Excel (.xlsx ou .xls) para o teste' 
        });
      }
      
      // Verificar tipo de arquivo
      const fileType = req.file.mimetype;
      if (!fileType.includes('excel') && !fileType.includes('spreadsheet') && 
          !(req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls'))) {
        return res.status(400).json({
          error: 'Tipo de arquivo inválido',
          details: 'Apenas arquivos Excel (.xlsx ou .xls) são suportados'
        });
      }
      
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      
      // Resultado da análise
      const results: any = {
        fileName: fileName,
        js: {
          hasImages: false,
          method: 'JSZip + Excel.js',
          products: []
        },
        python: {
          hasImages: false,
          method: 'openpyxl',
          products: []
        }
      };
      
      // Etapa 1: Verificar se o arquivo Excel contém imagens (via JavaScript)
      try {
        // Importar verificador de imagens
        const hasExcelImages = await import('./excel-image-detector');
        const jsCheckResult = await hasExcelImages.default(filePath);
        
        results.js.hasImages = jsCheckResult;
        
        if (jsCheckResult) {
          // Tentar extrair com JavaScript
          const excelProcessor = await import('./fixed-excel-processor');
          
          // Configurar diretório para este teste
          const extractedDir = path.join(process.cwd(), 'uploads', 'extracted_images', 'test');
          if (!fs.existsSync(extractedDir)) {
            fs.mkdirSync(extractedDir, { recursive: true });
          }
          
          // Extrair produtos e imagens
          const jsProducts = await excelProcessor.default(filePath, '1', 'local-1');
          results.js.products = jsProducts || [];
        }
      } catch (error) {
        console.error('Erro na detecção/extração JS:', error);
        results.js.error = error instanceof Error ? error.message : 'Erro desconhecido';
      }
      
      // Etapa 2: Verificar e extrair imagens via Python
      try {
        // Verificar se o Python está instalado
        const pythonCheck = await import('./python-bridge');
        const pyBridge = new pythonCheck.PythonBridge();
        
        // Verificar imagens com Python
        const pyCheckResult = await pyBridge.checkExcelImages(filePath);
        results.python.hasImages = pyCheckResult;
        
        if (pyCheckResult) {
          // Extrair com Python
          const pyProducts = await pyBridge.extractExcelWithImages(filePath, '1', 'local-1');
          results.python.products = pyProducts || [];
        }
      } catch (error) {
        console.error('Erro na detecção/extração Python:', error);
        results.python.error = error instanceof Error ? error.message : 'Erro desconhecido';
      }
      
      // Adicionar informações de debug
      const debugInfo = {
        file: {
          name: fileName,
          path: filePath,
          size: fs.statSync(filePath).size,
          type: fileType
        },
        uploadDir: path.join(process.cwd(), 'uploads'),
        imagesDir: path.join(process.cwd(), 'uploads', 'images', '1', 'local-1'),
        extractedDir: path.join(process.cwd(), 'uploads', 'extracted_images')
      };
      
      // Verificar existência dos diretórios
      debugInfo.dirExists = {
        uploads: fs.existsSync(debugInfo.uploadDir),
        images: fs.existsSync(debugInfo.imagesDir),
        extracted: fs.existsSync(debugInfo.extractedDir)
      };
      
      // Retornar resultados
      res.status(200).json({
        message: 'Arquivo processado com sucesso',
        results,
        debugInfo
      });
      
    } catch (error) {
      console.error('Erro no processamento do arquivo Excel:', error);
      res.status(500).json({
        error: 'Falha no processamento do arquivo Excel',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });
  
  // Rota para verificar imagens salvas no sistema
  app.get('/api/test/check-images', (req: Request, res: Response) => {
    try {
      const userId = '1';
      const catalogId = 'local-1';
      
      // Diretório onde as imagens devem estar
      const imagesDir = path.join(process.cwd(), 'uploads', 'images', userId, catalogId);
      
      // Verificar se o diretório existe
      if (!fs.existsSync(imagesDir)) {
        return res.status(200).json({
          message: 'Diretório de imagens não encontrado',
          path: imagesDir,
          exists: false,
          images: []
        });
      }
      
      // Listar os arquivos no diretório
      const files = fs.readdirSync(imagesDir);
      
      // Filtrar apenas arquivos de imagem
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
      });
      
      // Criar lista de imagens com URLs
      const images = imageFiles.map(file => {
        return {
          name: file,
          path: path.join(imagesDir, file),
          url: `/api/images/${userId}/${catalogId}/${file}`
        };
      });
      
      res.status(200).json({
        message: `Encontradas ${images.length} imagens no diretório`,
        path: imagesDir,
        exists: true,
        images
      });
      
    } catch (error) {
      console.error('Erro ao verificar imagens:', error);
      res.status(500).json({
        error: 'Falha ao verificar imagens',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  // Rota para testar a extração de imagens de Excel
  app.post("/api/test/excel-image-extraction", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;
      
      console.log(`Teste de extração de imagens: Processando arquivo ${fileName} em ${filePath}`);
      
      // Importar processador de Excel com colunas fixas
      const { processExcelWithFixedColumns } = await import('./fixed-excel-processor');
      
      // Obter timestamp para evitar colisões
      const timestamp = Date.now();
      const testUserId = 'test-user-' + timestamp;
      const testCatalogId = 'test-catalog-' + timestamp;
      
      // Processar Excel para extrair produtos e imagens
      const products = await processExcelWithFixedColumns(
        filePath,
        testUserId,
        testCatalogId
      );
      
      // Contar produtos com imagens
      const productsWithImages = products.filter(p => p.imageUrl).length;
      
      // Gerar estatísticas
      const results = {
        fileName,
        totalProducts: products.length,
        productsWithImages,
        successRate: Math.round((productsWithImages / products.length) * 100),
        sampleProducts: products
          .filter(p => p.imageUrl)  // Mostrar apenas produtos com imagens
          .slice(0, 5)              // Limitar a 5 produtos
          .map(p => ({              // Simplificar produto para exibição
            nome: p.nome,
            codigo: p.codigo,
            imageUrl: p.imageUrl,
            preco: p.preco
          }))
      };
      
      return res.json(results);
    } catch (error) {
      console.error('Erro ao testar extração de imagens:', error);
      return res.status(500).json({ 
        error: 'Falha ao processar arquivo Excel', 
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  // Adicionar página de teste HTML para extração de imagens de Excel
  app.get("/test/excel-image-extraction", (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Teste de Extração de Imagens do Excel</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem;
        }
        form {
          margin-bottom: 2rem;
          padding: 1rem;
          border: 1px solid #ccc;
          border-radius: 8px;
        }
        .product-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
        }
        .product-card {
          border: 1px solid #eee;
          border-radius: 8px;
          padding: 1rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .product-image {
          width: 100%;
          height: 150px;
          object-fit: contain;
          background: #f9f9f9;
          border-radius: 4px;
        }
        .button {
          background: #4a73e8;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
        }
        .stats {
          background: #f5f5f5;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }
        .progress-bar {
          height: 20px;
          background: #eee;
          border-radius: 10px;
          overflow: hidden;
          margin-top: 8px;
        }
        .progress-fill {
          height: 100%;
          background: #4caf50;
          width: 0%;
          transition: width 0.3s;
        }
        .loading {
          display: none;
          text-align: center;
          padding: 2rem;
        }
        .error {
          background: #ffebee;
          color: #c62828;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 1rem;
          display: none;
        }
      </style>
    </head>
    <body>
      <h1>Teste de Extração de Imagens do Excel</h1>
      <p>Esta página permite testar o processamento de imagens em arquivos Excel.</p>
      
      <form id="uploadForm" enctype="multipart/form-data">
        <div>
          <label for="excelFile">Selecione um arquivo Excel (.xlsx):</label>
          <input type="file" id="excelFile" name="file" accept=".xlsx,.xls" required>
        </div>
        <div style="margin-top: 1rem;">
          <button type="submit" class="button">Processar Excel</button>
        </div>
      </form>
      
      <div id="error" class="error"></div>
      
      <div id="loading" class="loading">
        <p>Processando arquivo... Por favor aguarde.</p>
        <div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
      </div>
      
      <div id="results" style="display: none;">
        <div class="stats">
          <h3>Estatísticas de Processamento</h3>
          <p>Arquivo: <span id="fileName"></span></p>
          <p>Total de produtos: <span id="totalProducts"></span></p>
          <p>Produtos com imagens: <span id="productsWithImages"></span></p>
          <p>
            Taxa de sucesso: <span id="successRate"></span>%
            <div class="progress-bar">
              <div id="progressFill" class="progress-fill"></div>
            </div>
          </p>
        </div>
        
        <h3>Amostra de Produtos</h3>
        <div id="productGrid" class="product-grid">
          <!-- Produtos serão adicionados aqui via JavaScript -->
        </div>
      </div>
      
      <script>
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const fileInput = document.getElementById('excelFile');
          const file = fileInput.files[0];
          
          if (!file) {
            showError('Por favor, selecione um arquivo Excel.');
            return;
          }
          
          // Mostrar loading
          document.getElementById('loading').style.display = 'block';
          document.getElementById('results').style.display = 'none';
          document.getElementById('error').style.display = 'none';
          
          // Criar FormData
          const formData = new FormData();
          formData.append('file', file);
          
          try {
            // Enviar arquivo para API
            const response = await fetch('/api/test/excel-image-extraction', {
              method: 'POST',
              body: formData
            });
            
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.details || 'Erro ao processar arquivo');
            }
            
            const data = await response.json();
            
            // Atualizar UI com os resultados
            document.getElementById('fileName').textContent = data.fileName;
            document.getElementById('totalProducts').textContent = data.totalProducts;
            document.getElementById('productsWithImages').textContent = data.productsWithImages;
            document.getElementById('successRate').textContent = data.successRate;
            document.getElementById('progressFill').style.width = data.successRate + '%';
            
            // Renderizar produtos
            const productGrid = document.getElementById('productGrid');
            productGrid.innerHTML = '';
            
            if (data.sampleProducts.length === 0) {
              productGrid.innerHTML = '<p>Nenhum produto com imagem encontrado.</p>';
            } else {
              data.sampleProducts.forEach(product => {
                const card = document.createElement('div');
                card.className = 'product-card';
                
                card.innerHTML = \`
                  <img src="\${product.imageUrl}" alt="\${product.nome}" class="product-image" onerror="this.src='/placeholders/default.svg'">
                  <h4>\${product.nome}</h4>
                  <p>Código: \${product.codigo}</p>
                  <p>Preço: \${product.preco}</p>
                \`;
                
                productGrid.appendChild(card);
              });
            }
            
            // Mostrar resultados
            document.getElementById('results').style.display = 'block';
            
          } catch (error) {
            showError(error.message || 'Erro ao processar arquivo');
          } finally {
            document.getElementById('loading').style.display = 'none';
          }
        });
        
        function showError(message) {
          const errorEl = document.getElementById('error');
          errorEl.textContent = message;
          errorEl.style.display = 'block';
        }
      </script>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </body>
    </html>
    `;
    
    res.send(html);
  });

  const httpServer = createServer(app);
  return httpServer;
}