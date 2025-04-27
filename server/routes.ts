import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as fs from "fs";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { DecodedIdToken } from "firebase-admin/auth";
import { WebSocketServer } from "ws";
import mime from "mime-types";
import { createCanvas } from "canvas";
import { deleteDataFromFirestore } from "./test-upload.js";
import { getS3UploadMiddleware, checkS3Configuration } from "./s3-service.js";
import { 
  uploadCatalogFileToS3, 
  getProductImageUrl, 
  uploadProductImageToS3,
  migrateExtractedImagesToS3,
  updateProductImagesWithS3Urls,
  deleteCatalogFromS3,
  catalogFileExistsInS3,
  getCatalogFileUrl
} from "./catalog-s3-manager.js";
import { processExcelWithAI } from './ai-excel-processor.js';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import firebaseAppClient from '../client/src/lib/firebase';
import { fixProductImages } from './excel-fixed-image-mapper';

type MoodboardCreateInput = {
  userId: number;
  projectName: string;
  productIds: number[];
  fileUrl?: string;
  clientName?: string;
  architectName?: string;
  quoteId?: number;
};

interface SessionData {
  userId?: number;
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
      s3Key?: string; // Chave S3 do arquivo enviado
    }
  }
}

// Verificar se devemos usar S3 ou armazenamento local
let useS3Storage = true; // Forçando uso do S3 para todos os ambientes

// Configuração do multer para armazenamento local (fallback)
const localStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

// Inicialmente, configurar para armazenamento local (será substituído depois de verificar S3)
let upload = multer({ storage: localStorage });

async function extractProductsFromExcel(filePath: string): Promise<any[]> {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  const products = data.map((row: any, index: number) => {
    return {
      name: row.nome || row.name || `Produto ${index+1}`,
      code: row.codigo || row.code || `CODE-${index+1}`,
      price: row.preco || row.price || 0,
      description: row.descricao || row.description || "",
      userId: 1, // Default user ID
      catalogId: 1, // Default catalog ID
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });
  
  return products;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Verificar configuração do S3 e ativar se disponível
  try {
    const s3Config = await checkS3Configuration();
    if (s3Config.status === 'success') {
      console.log(`✅ Amazon S3 conectado com sucesso - Bucket: ${s3Config.bucket}, Região: ${s3Config.region}`);
      useS3Storage = true;
      
      try {
        // Inicializar pasta de uploads local (mesmo usando S3, é bom ter como fallback)
        if (!fs.existsSync('./uploads')) {
          fs.mkdirSync('./uploads', { recursive: true });
        }
        
        // Configurar multer para usar S3 com uma configuração customizada
        const multerS3Setup = await import('./s3-service.js');
        upload = multerS3Setup.getS3UploadMiddleware('catalogs');
        
        // Caso tudo dê certo com a configuração
        console.log('Upload de arquivos configurado para usar Amazon S3');
      } catch (multerError) {
        console.error('ERRO CRÍTICO: Falha ao configurar Multer com S3:', multerError);
        throw new Error(`Configuração do Multer-S3 obrigatória para o funcionamento da aplicação`);
      }
    } else {
      console.error('ERRO CRÍTICO: Não foi possível conectar ao S3: ${s3Config.message}');
      throw new Error(`Configuração do S3 obrigatória para o funcionamento da aplicação`);
    }
  } catch (error) {
    console.error('ERRO CRÍTICO: Não foi possível conectar ao S3:', error);
    throw new Error(`Configuração do S3 obrigatória para o funcionamento da aplicação`);
  }
  
  // Adicionar rotas de imagem S3
  try {
    const { addS3ImageRoutes } = await import('./s3-image-routes');
    await addS3ImageRoutes(app);
    console.log('Rotas de imagem S3 adicionadas com sucesso');
  } catch (error) {
    console.error('ERRO CRÍTICO: Não foi possível adicionar rotas de imagem S3:', error);
    throw new Error(`Configuração das rotas de imagem S3 é obrigatória para o funcionamento da aplicação`);
  }

  // Rota de healthcheck
  app.get("/api/healthcheck", (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  // Middleware para extrair usuário Firebase do token Authorization
  const extractFirebaseUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
      }
      
      const token = authHeader.split('Bearer ')[1];
      
      if (!token) {
        return next();
      }
      
      const firebaseAdmin = await import('./firebase-admin');
      const decodedToken = await firebaseAdmin.auth.verifyIdToken(token);
      
      req.firebaseUser = decodedToken;
      
      next();
    } catch (error) {
      console.error("Erro ao extrair usuário Firebase:", error);
      next();
    }
  };
  
  // Adicionar middleware para todas as rotas
  app.use(extractFirebaseUser);
  
  // Rotas de autenticação
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }
      
      // Verificar se o usuário já existe
      const existingUser = await storage.getUserByEmail(email);
      
      if (existingUser) {
        return res.status(400).json({ message: "Usuário já existe" });
      }
      
      // Criar usuário no Firebase
      const firebaseAdmin = await import('./firebase-admin');
      const userRecord = await firebaseAdmin.auth.createUser({
        email,
        password,
        displayName: name
      });
      
      // Criar usuário no banco de dados
      const user = await storage.createUser({
        email,
        password: "FIREBASE_AUTH",
        name,
        companyName: "Empresa Padrão",
        firebaseId: userRecord.uid,
      });
      
      // Início da sessão
      if (req.session) {
        req.session.userId = user.id;
      }
      
      return res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name,
        firebaseId: user.firebaseId
      });
    } catch (error) {
      console.error("Erro ao registrar usuário:", error);
      return res.status(500).json({ message: "Erro ao criar usuário" });
    }
  });
  
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }
      
      // Usar o app importado como default
      const auth = getAuth(firebaseAppClient);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      const user = await storage.getUserByFirebaseId(userCredential.user.uid);
      
      if (!user) {
        const newUser = await storage.createUser({
          email,
          password: "FIREBASE_AUTH",
          name: userCredential.user.displayName || email.split('@')[0],
          companyName: "Empresa Padrão",
          firebaseId: userCredential.user.uid,
        });
        
        if (req.session) {
          req.session.userId = newUser.id;
        }
        
        // Retornar dados do novo usuário criado localmente
        return res.status(200).json({
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            firebaseId: newUser.firebaseId
        });
      }
      
      // Usuário encontrado no DB local
      console.log(`Usuário ${email} encontrado no DB local (ID: ${user.id}).`);
      if (req.session) {
        req.session.userId = user.id;
      }
      
      // Retornar dados do usuário existente
      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        firebaseId: user.firebaseId
      });
    } catch (error) {
      console.error("Erro ao fazer login:", error);
      // Adicionar verificação de tipo para error.code (Boa prática)
      let errorMessage = "Erro interno durante o login";
      let statusCode = 500;
      if (error instanceof Error && 'code' in error) { 
          const firebaseErrorCode = (error as any).code; // Type assertion
          if ([ 'auth/invalid-credential', 
                'auth/user-not-found', 
                'auth/wrong-password'].includes(firebaseErrorCode)) 
          {         
               errorMessage = "Credenciais inválidas";
               statusCode = 401;
          } 
      } 
      return res.status(statusCode).json({ message: errorMessage });
    }
  });
  
  app.post("/api/auth/firebase-sync", async (req: Request, res: Response) => {
    try {
      if (!req.firebaseUser) {
        return res.status(401).json({ message: "Token inválido ou não fornecido" });
      }
      
      const { uid, email, name } = req.firebaseUser;
      
      // Verificar se o usuário já existe no banco de dados
      let user = await storage.getUserByFirebaseId(uid);
      
      if (!user) {
        // Criar usuário no banco se não existir
        user = await storage.createUser({
          email: email || `user_${uid}@placeholder.com`,
          password: "FIREBASE_AUTH",
          name: name || email?.split('@')[0] || uid,
          companyName: "Empresa Padrão",
          firebaseId: uid,
        });
      }
      
      // Início da sessão
      if (req.session) {
        req.session.userId = user.id;
      }
      
      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        firebaseId: user.firebaseId
      });
    } catch (error) {
      console.error("Erro ao sincronizar usuário Firebase:", error);
      return res.status(500).json({ message: "Erro ao sincronizar usuário" });
    }
  });
  
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      // Priorizar autenticação Firebase
      if (req.firebaseUser) {
        const { uid } = req.firebaseUser;
        const user = await storage.getUserByFirebaseId(uid);
        
        if (user) {
          console.log(`Usuário autenticado via Firebase Token: ${user.email}`);
          return res.status(200).json({
            id: user.id,
            email: user.email,
            name: user.name,
            firebaseId: user.firebaseId
          });
        }
         console.log(`Token Firebase válido, mas usuário ${uid} não encontrado no DB local.`);
         // Considerar retornar 401 ou tentar sincronizar aqui?
      }
      
      // Fallback para autenticação por sessão
      if (req.session?.userId) {
          const user = await storage.getUser(req.session.userId);
          if (user) {
              console.log(`Usuário autenticado via Sessão: ${user.email}`);
              return res.status(200).json({
                id: user.id,
                email: user.email,
                name: user.name,
                firebaseId: user.firebaseId
              });
          } else {
             console.log(`Sessão encontrada (userId: ${req.session.userId}) mas usuário não existe no DB.`);
             // Limpar sessão inválida?
             req.session.destroy(()=>{}); 
          }
      }
      
      // Se chegou aqui, não está autenticado
      console.log("Nenhuma autenticação válida (Firebase ou Sessão) encontrada.");
      return res.status(401).json({ message: "Não autenticado" });

    } catch (error) {
      console.error("Erro ao obter usuário (/api/auth/me):", error);
      return res.status(500).json({ message: "Erro ao obter usuário" });
    }
  });
  
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Erro ao encerrar sessão" });
        }
        res.status(200).json({ message: "Logout realizado com sucesso" });
      });
    } else {
      res.status(200).json({ message: "Nenhuma sessão para encerrar" });
    }
  });
  
  // Rotas de produtos
  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.query.userId as string) || undefined;
      const catalogId = req.query.catalogId ? parseInt(req.query.catalogId as string) : undefined;
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const products = await storage.getProducts(userId, catalogId);
      return res.status(200).json(products);
    } catch (error) {
      console.error("Erro ao obter produtos:", error);
      return res.status(500).json({ message: "Erro ao obter produtos" });
    }
  });
  
  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const product = await storage.getProduct(id);
      
      if (!product) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }
      
      return res.status(200).json(product);
    } catch (error) {
      console.error("Erro ao obter produto:", error);
      return res.status(500).json({ message: "Erro ao obter produto" });
    }
  });
  
  app.post("/api/products", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const product = await storage.createProduct({
        ...req.body,
        userId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      return res.status(201).json(product);
    } catch (error) {
      console.error("Erro ao criar produto:", error);
      return res.status(500).json({ message: "Erro ao criar produto" });
    }
  });
  
  app.put("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const data = req.body;
      const product = await storage.updateProduct(id, {
        ...data,
        updatedAt: new Date(),
        isEdited: true
      });
      
      if (!product) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }
      
      return res.status(200).json(product);
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      return res.status(500).json({ message: "Erro ao atualizar produto" });
    }
  });
  
  app.delete("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const success = await storage.deleteProduct(id);
      
      if (!success) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      return res.status(500).json({ message: "Erro ao excluir produto" });
    }
  });
  
  // Rotas de catálogos
  app.get("/api/catalogs", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.query.userId as string);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const catalogs = await storage.getCatalogs(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("Erro ao obter catálogos:", error);
      return res.status(500).json({ message: "Erro ao obter catálogos" });
    }
  });
  
  app.post("/api/catalogs", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      // Criar catálogo no banco de dados
      const catalog = await storage.createCatalog({
        ...req.body,
        userId,
        createdAt: new Date()
      });
      
      // Criar catálogo no Firestore
      try {
        // Importar serviço do Firestore
        const { createCatalogInFirestore } = await import('./firestore-service');
        
        const firestoreCatalog = await createCatalogInFirestore({
          name: req.body.name,
          fileName: req.body.name,
          filePath: "",
          fileType: "manual",
          status: "completed",
          userId: userId.toString(),
          localCatalogId: catalog.id,
          createdAt: new Date()
        });
        
        console.log(`Catálogo criado no Firestore: ${firestoreCatalog.id}`);
      } catch (firestoreError) {
        console.error("Erro ao criar catálogo no Firestore:", firestoreError);
        // Continuar mesmo se não conseguir salvar no Firestore
      }
      
      return res.status(201).json(catalog);
    } catch (error) {
      console.error("Erro ao criar catálogo:", error);
      return res.status(500).json({ message: "Erro ao criar catálogo" });
    }
  });
  
  app.get("/api/catalogs/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const catalog = await storage.getCatalog(id);
      
      if (!catalog) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      // Obter os produtos associados a este catálogo
      const products = await storage.getProducts(catalog.userId, id);
      
      return res.status(200).json({
        ...catalog,
        products
      });
    } catch (error) {
      console.error("Erro ao obter catálogo:", error);
      return res.status(500).json({ message: "Erro ao obter catálogo" });
    }
  });
  
  app.put("/api/catalogs/:id/status", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      if (!status) {
        return res.status(400).json({ message: "Status é obrigatório" });
      }
      
      const success = await storage.updateCatalogStatus(id, status);
      
      if (!success) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      return res.status(200).json({ message: "Status atualizado com sucesso" });
    } catch (error) {
      console.error("Erro ao atualizar status do catálogo:", error);
      return res.status(500).json({ message: "Erro ao atualizar status do catálogo" });
    }
  });
  
  app.post("/api/catalogs/:id/remap-images", async (req: Request, res: Response) => {
    try {
      const catalogId = parseInt(req.params.id);
      const userId = req.session?.userId || parseInt(req.body.userId as string);

      if (isNaN(catalogId)) return res.status(400).json({ message: "ID inválido" });
      if (!userId) return res.status(401).json({ message: "Usuário não autenticado" });

      // Obter o catálogo para garantir que pertence ao usuário (opcional, mas bom)
      const catalog = await storage.getCatalog(catalogId);
      if (!catalog || catalog.userId !== userId) {
          return res.status(404).json({ message: "Catálogo não encontrado ou não pertence ao usuário" });
      }

      console.log(`Iniciando correção de imagens para catálogo ${catalogId} do usuário ${userId}`);

      // *** Chamar a função exportada correta ***
      const result = await fixProductImages(userId, catalogId);

      if (result.success) {
          return res.status(200).json({
            message: result.message,
            updatedCount: result.updated
          });
      } else {
          return res.status(500).json({ 
              message: "Erro ao corrigir imagens", 
              error: result.message 
          });
      }

    } catch (error) {
      console.error("Erro na rota /remap-images:", error);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return res.status(500).json({ message: "Erro interno no servidor", error: message });
    }
  });
  
  app.post("/api/catalogs/remap-all-images", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId as string);
      if (!userId) return res.status(401).json({ message: "Usuário não autenticado" });

      const catalogs = await storage.getCatalogs(userId);
      if (!catalogs || catalogs.length === 0) {
        return res.status(404).json({ message: "Nenhum catálogo encontrado" });
      }

      const results = [];
      let totalUpdated = 0;

      for (const catalog of catalogs) {
        console.log(`Iniciando correção de imagens para catálogo ${catalog.id} (todos)`);
        try {
            // *** Chamar a função exportada correta ***
            const result = await fixProductImages(userId, catalog.id);
            results.push({
                catalogId: catalog.id,
                catalogName: catalog.fileName,
                status: result.success ? "completed" : "error",
                updatedCount: result.updated,
                message: result.message
            });
            if(result.success) totalUpdated += result.updated;
        } catch (catalogError) {
            console.error(`Erro ao processar catálogo ${catalog.id} em /remap-all:`, catalogError);
             const message = catalogError instanceof Error ? catalogError.message : String(catalogError);
            results.push({
                catalogId: catalog.id,
                catalogName: catalog.fileName,
                status: "error",
                updatedCount: 0,
                message: message
            });
        }
      }

      return res.status(200).json({
        message: `Remapeamento concluído. ${totalUpdated} produtos atualizados em ${catalogs.length} catálogos.`,
        totalUpdated,
        catalogsProcessed: results.filter(r => r.status === "completed").length,
        results
      });

    } catch (error) {
      console.error("Erro na rota /remap-all-images:", error);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return res.status(500).json({ message: "Erro interno no servidor", error: message });
    }
  });
  
  app.delete("/api/catalogs/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      console.log(`Iniciando exclusão do catálogo ${id}`);
      
      // Obter o catálogo para verificar o userId
      const catalog = await storage.getCatalog(id);
      
      if (!catalog) {
        console.log(`Catálogo ${id} não encontrado`);
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      console.log(`Catálogo ${id} encontrado, pertence ao usuário ${catalog.userId}`);
      
      // Primeiro, excluir todos os produtos associados a este catálogo
      // usando a função dedicada para isso no storage
      const deletedProductsCount = await storage.deleteProductsByCatalogId(id);
      console.log(`${deletedProductsCount} produtos excluídos do catálogo ${id}`);
      
      // Tentar excluir do Firestore se aplicável
      try {
        if (catalog.firestoreCatalogId) {
          const { deleteCatalogFromFirestore } = await import('./firestore-service');
          await deleteCatalogFromFirestore(catalog.userId.toString(), id.toString());
          console.log(`Catálogo ${id} excluído do Firestore`);
        }
      } catch (firestoreError) {
        console.error("Erro ao excluir catálogo do Firestore:", firestoreError);
        // Continuar mesmo se não conseguir excluir do Firestore
      }
      
      // Por fim, excluir o catálogo
      const success = await storage.deleteCatalog(id);
      
      if (!success) {
        console.error(`Falha ao excluir catálogo ${id} da base de dados`);
        return res.status(500).json({ message: "Erro ao excluir catálogo" });
      }
      
      console.log(`Catálogo ${id} excluído com sucesso`);
      return res.status(200).json({ 
        message: "Catálogo excluído com sucesso",
        productsDeleted: deletedProductsCount
      });
    } catch (error) {
      console.error("Erro ao excluir catálogo:", error);
      return res.status(500).json({ message: "Erro ao excluir catálogo", error: String(error) });
    }
  });
  
  // Rotas de orçamentos
  app.get("/api/quotes", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.query.userId as string);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const quotes = await storage.getQuotes(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      console.error("Erro ao obter orçamentos:", error);
      return res.status(500).json({ message: "Erro ao obter orçamentos" });
    }
  });
  
  app.get("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const quote = await storage.getQuote(id);
      
      if (!quote) {
        return res.status(404).json({ message: "Orçamento não encontrado" });
      }
      
      return res.status(200).json(quote);
    } catch (error) {
      console.error("Erro ao obter orçamento:", error);
      return res.status(500).json({ message: "Erro ao obter orçamento" });
    }
  });
  
  app.post("/api/quotes", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const quote = await storage.createQuote({
        ...req.body,
        userId,
        createdAt: new Date()
      });
      
      return res.status(201).json(quote);
    } catch (error) {
      console.error("Erro ao criar orçamento:", error);
      return res.status(500).json({ message: "Erro ao criar orçamento" });
    }
  });
  
  app.put("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const data = req.body;
      const quote = await storage.updateQuote(id, data);
      
      if (!quote) {
        return res.status(404).json({ message: "Orçamento não encontrado" });
      }
      
      return res.status(200).json(quote);
    } catch (error) {
      return res.status(500).json({ message: "Erro ao atualizar orçamento" });
    }
  });
  
  app.delete("/api/quotes/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const success = await storage.deleteQuote(id);
      
      if (!success) {
        return res.status(404).json({ message: "Orçamento não encontrado" });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir orçamento:", error);
      return res.status(500).json({ message: "Erro ao excluir orçamento" });
    }
  });
  
  // Rotas de moodboards
  app.get("/api/moodboards", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.query.userId as string);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const moodboards = await storage.getMoodboards(userId);
      return res.status(200).json(moodboards);
    } catch (error) {
      console.error("Erro ao obter moodboards:", error);
      return res.status(500).json({ message: "Erro ao obter moodboards" });
    }
  });
  
  app.get("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const moodboard = await storage.getMoodboard(id);
      
      if (!moodboard) {
        return res.status(404).json({ message: "Moodboard não encontrado" });
      }
      
      // Obter produtos associados a este moodboard
      const products = [];
      
      for (const productId of moodboard.productIds) {
        const product = await storage.getProduct(productId);
        if (product) {
          products.push(product);
        }
      }
      
      return res.status(200).json({
        ...moodboard,
        products
      });
    } catch (error) {
      console.error("Erro ao obter moodboard:", error);
      return res.status(500).json({ message: "Erro ao obter moodboard" });
    }
  });
  
  app.post("/api/moodboards", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const input: MoodboardCreateInput = {
        ...req.body,
        userId
      };
      
      const moodboard = await storage.createMoodboard(input);
      
      return res.status(201).json(moodboard);
    } catch (error) {
      console.error("Erro ao criar moodboard:", error);
      return res.status(500).json({ message: "Erro ao criar moodboard" });
    }
  });
  
  app.put("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const data = req.body;
      const moodboard = await storage.updateMoodboard(id, data);
      
      if (!moodboard) {
        return res.status(404).json({ message: "Moodboard não encontrado" });
      }
      
      return res.status(200).json(moodboard);
    } catch (error) {
      console.error("Erro ao atualizar moodboard:", error);
      return res.status(500).json({ message: "Erro ao atualizar moodboard" });
    }
  });
  
  app.delete("/api/moodboards/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const success = await storage.deleteMoodboard(id);
      
      if (!success) {
        return res.status(404).json({ message: "Moodboard não encontrado" });
      }
      
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir moodboard:", error);
      return res.status(500).json({ message: "Erro ao excluir moodboard" });
    }
  });
  
  // Rota para busca visual com IA
  /*
  app.post("/api/ai/visual-search", async (req: Request, res: Response) => {
    try {
      const { imageBase64, catalogId, maxResults = 5 } = req.body;
      const userId = req.session?.userId || parseInt(req.body.userId as string);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      if (!imageBase64) {
        return res.status(400).json({ message: "Imagem não fornecida" });
      }
      
      // ** ERRO AQUI: Módulo não encontrado **
      // const { searchSimilarProducts } = await import('./visual-search-service'); 
      
      const products = await storage.getProducts(userId, catalogId ? parseInt(catalogId) : undefined);
      if (!products || products.length === 0) {
        return res.status(404).json({ message: "Nenhum produto encontrado" });
      }

      // ** Lógica de busca visual precisa ser implementada aqui **
      // const similarProducts = await searchSimilarProducts(imageBase64, products, maxResults);
      const similarProducts = products.slice(0, maxResults); // Placeholder

      return res.status(200).json({
        results: similarProducts,
        totalProducts: products.length
      });

    } catch (error) {
      console.error("Erro na busca visual:", error);
      // Corrigir tipo do erro
      const message = error instanceof Error ? error.message : "Erro desconhecido"; 
      return res.status(500).json({ message: "Erro ao processar busca visual", error: message });
    }
  });
  */
  
  // Rota para upload e processamento de catálogos
  app.post("/api/catalogs/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      console.log("=== INÍCIO UPLOAD CATÁLOGO ===");
      if (!req.file) {
        console.log("Erro: Nenhum arquivo enviado");
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }
      
      // Extrair informações do arquivo
      const file = req.file;
      console.log("File object:", JSON.stringify(file, null, 2));
      
      let filePath: string = '';
      let s3Key: string | null = null;
      const fileName = file.originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase() || '';
      
      // Verificar quem está fazendo o upload (obter o ID do usuário)
      const userId = req.params.userId || req.query.userId || req.body.userId || req.session?.userId || 1;
      console.log(`Upload realizado pelo usuário: ${userId}`);
      
      // Verificar se estamos usando S3 ou armazenamento local
      if (useS3Storage && file.hasOwnProperty('location')) {
        // Upload via S3 - multer-s3 v3 usa 'location'
        s3Key = (file as any).key;
        const s3Location = (file as any).location;
        filePath = s3Key; // Usar o caminho S3 como filePath
        console.log(`Arquivo recebido via S3 v3: ${fileName} (${fileType}), S3 Key: ${s3Key}, Location: ${s3Location}`);
      } else if (useS3Storage && (file as any).s3) {
        // Upload via S3 - multer-s3 v2
        s3Key = (file as any).key || (file as any).s3?.key;
        filePath = s3Key; // Usar o caminho S3 como filePath
        console.log(`Arquivo recebido via S3 v2: ${fileName} (${fileType}), S3 Key: ${s3Key}`);
      } else if (file.path) {
        // Upload local tradicional
        filePath = file.path;
        console.log(`Arquivo recebido localmente: ${fileName} (${fileType}), salvo em: ${filePath}`);
        
        // Se o S3 estiver configurado, fazer upload do arquivo para S3 (migração)
        if (useS3Storage) {
          try {
            console.log(`Migrando arquivo local para S3 - filepath: ${filePath}, userId: ${userId}`);
            const userIdNum = typeof userId === 'string' ? parseInt(userId) : userId;
            
            // Importar módulo s3 para upload
            const { uploadFileToS3 } = await import('./s3-service.js');
            
            // Fazer upload diretamente com o módulo S3
            s3Key = await uploadFileToS3(filePath, userIdNum, 'catalogs', 'temp');
            console.log(`Arquivo migrado para S3 com sucesso. S3 Key: ${s3Key}`);
          } catch (s3Error) {
            console.error("Erro ao migrar arquivo para S3, continuando com armazenamento local:", s3Error);
            s3Key = null; // Garante que o s3Key é nulo em caso de erro
          }
        }
      } else {
        // Fallback: Criar um caminho de arquivo temporário
        filePath = `./uploads/temp-${Date.now()}-${fileName}`;
        console.log(`Nenhum caminho de arquivo encontrado, usando fallback: ${filePath}`);
      }
      
      // Garantir que temos um fileUrl válido
      const fileUrl = s3Key || filePath;
      if (!fileUrl) {
        throw new Error("Não foi possível determinar um URL válido para o arquivo");
      }
      
      // Determinar o caminho de acesso efetivo ao arquivo
      // Se for S3, precisamos baixar para um caminho local temporário para processamento
      let processingFilePath = filePath;
      
      // Se estiver no S3, vamos baixar para um caminho local temporário
      if (useS3Storage && s3Key) {
        try {
          console.log(`Arquivo está no S3, baixando para processamento local...`);
          
          // Criar pasta temporária
          const tempDir = './uploads/temp';
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          // Caminho temporário para download
          const tempPath = path.join(tempDir, `${Date.now()}-${fileName}`);
          
          // Importar serviço S3
          const { downloadFileFromS3 } = await import('./s3-service.js');
          
          // Baixar arquivo do S3
          const fileBuffer = await downloadFileFromS3(s3Key);
          
          // Salvar localmente
          fs.writeFileSync(tempPath, fileBuffer);
          
          console.log(`Arquivo baixado do S3 para: ${tempPath}`);
          processingFilePath = tempPath;
        } catch (downloadError) {
          console.error(`Erro ao baixar arquivo do S3:`, downloadError);
          // Manter o caminho original em caso de erro
          console.log(`Usando o caminho original: ${filePath}`);
        }
      }
      
      console.log(`FileUrl final para o banco: ${fileUrl}`);
      console.log(`Caminho de processamento efetivo: ${processingFilePath}`);
      
      // Criar um novo catálogo no banco de dados
      const catalog = await storage.createCatalog({
        userId: typeof userId === 'string' ? parseInt(userId) : userId,
        fileName: fileName,
        fileUrl: fileUrl, // URL válido garantido
        processedStatus: "processing"
      });
      
      // ID do catálogo no banco relacional
      const catalogId = catalog.id;
      console.log(`Catálogo criado no banco de dados com ID: ${catalogId}`);
      
      // ID do catálogo no Firestore (pode ser o mesmo ou diferente)
      const firestoreCatalogId = req.body.firestoreCatalogId || catalogId;
      console.log(`ID do catálogo no Firestore: ${firestoreCatalogId}`);
      
      // Salvar o catálogo no Firestore também
      try {
        const { createCatalogInFirestore } = await import('./firestore-service');
        let productsData: any[] = [];
        let extractionInfo = "";
        
        try {
          // ======= PROCESSAMENTO BASEADO NO TIPO DE ARQUIVO =======
          if (fileType === 'xlsx' || fileType === 'xls') {
            console.log(`---> Chamando processExcelWithAI para: ${processingFilePath}`);
            console.log(`---> User ID: ${userId}, Catalog ID (Local): ${catalog.id}, Firestore Catalog ID: ${firestoreCatalogId}`); // Log IDs

            // *** GARANTIR QUE APENAS A IA É CHAMADA ***
            productsData = await processExcelWithAI(processingFilePath);
            
            // *** LOG DETALHADO DO RESULTADO DA IA ***
            console.log(`<<< Retorno de processExcelWithAI: Tipo=${typeof productsData}, É Array=${Array.isArray(productsData)}, Comprimento=${productsData?.length ?? 'N/A'}`);
            if (Array.isArray(productsData) && productsData.length > 0) {
                console.log(`<<< Amostra do Retorno da IA (Primeiro Produto): ${JSON.stringify(productsData[0], null, 2)}`);
            } else if (!Array.isArray(productsData)) {
                console.error("ERRO GRAVE: processExcelWithAI NÃO RETORNOU UM ARRAY!");
                productsData = []; // Força array vazio para evitar erros posteriores
            } else {
                console.log("<<< Retorno da IA foi um array vazio.");
            }

            extractionInfo = `IA extraiu ${productsData.length} produtos do Excel.`;
            
          } else if (fileType === 'pdf') {
            console.log("---> Chamando processamento de PDF...");
            // Mantenha sua lógica robusta de processamento de PDF aqui
            // Exemplo: const { processPdf } = await import('./pdf-processor');
            // productsData = await processPdf(processingFilePath, ...);
            extractionInfo = "Processamento de PDF (lógica a implementar/revisar).";
            // ** Substituir pelo seu código real de processamento PDF **
            console.warn("Lógica de processamento de PDF precisa ser implementada/revisada aqui.");
            productsData = []; // Placeholder

          } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileType)) {
             console.log("---> Chamando processamento de Imagem...");
             // Mantenha sua lógica de processamento de Imagem aqui
             // Exemplo: const { processImage } = await import('./image-processor');
             // productsData = await processImage(processingFilePath, ...);
             extractionInfo = "Processamento de Imagem (lógica a implementar/revisar).";
            // ** Substituir pelo seu código real de processamento de Imagem **
             console.warn("Lógica de processamento de Imagem precisa ser implementada/revisada aqui.");
             productsData = []; // Placeholder
          } else {
            console.error(`Erro: Formato de arquivo não suportado: ${fileType}`);
            throw new Error(`Formato de arquivo não suportado: ${fileType}. Use Excel, PDF ou imagens.`);
          }

          // ======= FIM DO PROCESSAMENTO BASEADO NO TIPO =======

          console.log(`Processamento do tipo ${fileType} concluído. Produtos a serem salvos: ${productsData?.length ?? 0}`);

          // ======= SALVAR PRODUTOS (Comum a todos os tipos) =======
          if (!Array.isArray(productsData)) {
              console.error("ERRO FATAL: productsData não é um array após o processamento!");
              productsData = []; // Tenta evitar mais erros
          }

          // Salvar no Firestore
          const productsToSaveFirestore = productsData.map(p => ({
            ...p, 
            userId: userId.toString() || 'unknown_user', 
            catalogId: firestoreCatalogId?.toString() || `unknown-catalog-${catalog?.id || 'new'}`, 
            localCatalogId: catalog?.id || null, 
            createdAt: new Date(),
            updatedAt: new Date()
          }));
          const { saveProductsToFirestore, updateCatalogStatusInFirestore } = await import('./firestore-service');
          
          const fsCatalogIdStr = firestoreCatalogId?.toString() || `unknown-catalog-${catalog?.id || 'new'}`; 
          const catalogIdForFirestore: string = fsCatalogIdStr;
          
          // @ts-ignore - Ignorar erro de tipo persistente
          const productIds = await saveProductsToFirestore(productsToSaveFirestore, catalogIdForFirestore); 
          console.log(`${productIds.length} produtos salvos no Firestore.`);
          // @ts-ignore - Ignorar erro de tipo persistente
          await updateCatalogStatusInFirestore(catalogIdForFirestore, "completed", productsData.length); 

          // Salvar no Banco Local (PostgreSQL)
          const savedLocalProducts = [];
          const localUserIdNum = typeof userId === 'number' ? userId : parseInt(userId.toString()); // Garantir número
          const localCatalogIdNum = catalog?.id; // Já deve ser número ou undefined

          if (localCatalogIdNum === undefined || isNaN(localCatalogIdNum)) {
              console.error("ERRO: ID do catálogo local inválido ou ausente. Não é possível salvar produtos no PG.");
          } else {
              for (const productData of productsData) {
                try {
                  const productToSaveLocal = {
                    userId: localUserIdNum,
                    catalogId: localCatalogIdNum,
                    name: productData.name || "Produto S/ Nome", // Usar fallback
                    code: productData.code || `CODE-${Date.now()}`, // Usar fallback
                    description: productData.description || productData.name || "", // Usar fallback
                    price: productData.price || 0,
                    category: productData.category || 'Geral',
                    manufacturer: productData.manufacturer || '',
                    location: productData.location || '',
                    colors: Array.isArray(productData.colors) ? productData.colors : [],
                    materials: Array.isArray(productData.materials) ? productData.materials : [],
                    sizes: Array.isArray(productData.sizes) ? productData.sizes : [],
                    imageUrl: productData.imageUrl || null,
                    isEdited: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  };
                  const savedProduct = await storage.createProduct(productToSaveLocal);
                  savedLocalProducts.push(savedProduct);
                } catch (dbError) {
                  console.error('Erro ao salvar produto no banco local PG:', dbError, productData);
                }
              }
              console.log(`${savedLocalProducts.length} produtos salvos no banco de dados local PG.`);
          }

          // Declarar updatedCatalog fora do if para estar acessível na resposta
          let updatedCatalog: Catalog | undefined = undefined; 
          if (localCatalogIdNum) { 
              updatedCatalog = await storage.updateCatalogStatus(localCatalogIdNum, "completed");
          }

          // ======= RESPOSTA DE SUCESSO =======
          return res.status(201).json({
            message: `Catálogo processado com sucesso (${fileType} via IA).`,
            catalog: updatedCatalog,
            extractionInfo,
            totalProductsSaved: savedLocalProducts.length,
            sampleProducts: savedLocalProducts.slice(0, 3),
            firestoreCatalogId
          });

        } catch (processingError) {
           // ======= TRATAMENTO DE ERRO DE PROCESSAMENTO =======
            console.error("Erro durante o processamento do catálogo:", processingError);
            try {
              const { updateCatalogStatusInFirestore } = await import('./firestore-service');
              const fsCatalogId = firestoreCatalogId?.toString() || `unknown-catalog-${catalog?.id || 'new'}`;
              // Verificar a assinatura de updateCatalogStatusInFirestore em firestore-service.ts
              // Assumindo que espera (catalogId, status, productCount)
              await updateCatalogStatusInFirestore(fsCatalogId, "failed", 0); // Passar 0 como productCount
            } catch (fsError) { console.error("Erro ao atualizar status Firestore para falha:", fsError); }
            
            if (catalog?.id) {
                await storage.updateCatalogStatus(catalog.id, "failed");
            } else {
                console.error("Não foi possível atualizar status do catálogo local: ID do catálogo não encontrado.");
            }
            return res.status(400).json({
              message: "Falha ao processar o catálogo",
              error: processingError instanceof Error ? processingError.message : "Erro desconhecido",
              catalog: catalog ? { id: catalog.id, fileName: catalog.fileName } : { fileName: fileName }
            });
        }
      } catch (error) {
         // ======= TRATAMENTO DE ERRO GERAL (UPLOAD/SETUP INICIAL) =======
        console.error("Erro geral no upload/setup inicial:", error);
        return res.status(500).json({
          message: "Erro no processamento do upload inicial",
          error: error instanceof Error ? error.message : "Erro desconhecido"
        });
      }
    } catch (error) {
       // ======= TRATAMENTO DE ERRO GERAL (UPLOAD/SETUP INICIAL) =======
      console.error("Erro geral no upload/setup inicial:", error);
      return res.status(500).json({
        message: "Erro no processamento do upload inicial",
        error: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  });

  // Rotas para imagens
  app.get("/api/images/:userId/:catalogId/:filename", (req: Request, res: Response) => {
    const { userId, catalogId, filename } = req.params;
    const filePath = path.join("uploads", userId, catalogId, filename);
    
    if (fs.existsSync(filePath)) {
      const contentType = mime.lookup(filePath) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.status(404).json({ message: "Imagem não encontrada" });
    }
  });

  // Servidor WebSocket
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('Cliente WebSocket conectado');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Mensagem recebida:', data);
        
        // Broadcast para todos os clientes
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify(data));
          }
        });
      } catch (error) {
        console.error('Erro ao processar mensagem WebSocket:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('Cliente WebSocket desconectado');
    });
  });

  return httpServer;
}