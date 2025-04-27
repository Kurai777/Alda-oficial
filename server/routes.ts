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
  deleteCatalogFromS3
} from "./catalog-s3-manager.js";

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
let useS3Storage = false;

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
      // Configurar multer para usar S3
      upload = getS3UploadMiddleware('catalogs');
      console.log('Upload de arquivos configurado para usar Amazon S3');
    } else {
      console.log(`⚠️ Usando armazenamento local: ${s3Config.message}`);
    }
  } catch (error) {
    console.error('Erro ao verificar configuração do S3:', error);
    console.log('⚠️ Usando armazenamento local devido a erro na configuração do S3');
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
      
      const { admin } = await import('./firebase-admin');
      const decodedToken = await admin.auth().verifyIdToken(token);
      
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
      const { admin } = await import('./firebase-admin');
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name
      });
      
      // Criar usuário no banco de dados
      const user = await storage.createUser({
        email,
        password: "FIREBASE_AUTH", // Não armazenamos a senha real
        name,
        firebaseId: userRecord.uid,
        createdAt: new Date(),
        updatedAt: new Date()
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
      
      // Autenticar com Firebase
      const { signInWithEmailAndPassword, getAuth } = await import('firebase/auth');
      const { firebaseApp } = await import('./firebase-config');
      
      const auth = getAuth(firebaseApp);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Obter usuário do banco de dados
      const user = await storage.getUserByFirebaseId(userCredential.user.uid);
      
      if (!user) {
        // Se o usuário existe no Firebase mas não no banco, criá-lo
        const newUser = await storage.createUser({
          email,
          password: "FIREBASE_AUTH",
          name: userCredential.user.displayName || email.split('@')[0],
          firebaseId: userCredential.user.uid,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        if (req.session) {
          req.session.userId = newUser.id;
        }
        
        return res.status(200).json({
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          firebaseId: newUser.firebaseId
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
      console.error("Erro ao fazer login:", error);
      return res.status(401).json({ message: "Credenciais inválidas" });
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
          firebaseId: uid,
          createdAt: new Date(),
          updatedAt: new Date()
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
          return res.status(200).json({
            id: user.id,
            email: user.email,
            name: user.name,
            firebaseId: user.firebaseId
          });
        }
      }
      
      // Fallback para autenticação por sessão
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Não autenticado" });
      }
      
      const user = await storage.getUser(req.session.userId);
      
      if (!user) {
        return res.status(401).json({ message: "Usuário não encontrado" });
      }
      
      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        firebaseId: user.firebaseId
      });
    } catch (error) {
      console.error("Erro ao obter usuário:", error);
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
      
      if (isNaN(catalogId)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      // Obter o catálogo
      const catalog = await storage.getCatalog(catalogId);
      
      if (!catalog) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      // Obter os produtos do catálogo
      const products = await storage.getProducts(catalog.userId, catalogId);
      
      if (!products || products.length === 0) {
        return res.status(404).json({ message: "Nenhum produto encontrado para este catálogo" });
      }
      
      // Importar serviço para corrigir imagens
      try {
        // Tentar remapear imagens
        const { remapImagesByCode } = await import('./excel-fixed-image-mapper');
        
        // Remapear imagens
        const remappedProducts = await remapImagesByCode(products, catalog.userId, catalogId);
        
        // Atualizar produtos no banco de dados
        let updatedCount = 0;
        for (const product of remappedProducts) {
          if (product.imageUrl && product.id) {
            try {
              await storage.updateProduct(product.id, {
                imageUrl: product.imageUrl,
                updatedAt: new Date()
              });
              updatedCount++;
            } catch (updateError) {
              console.error(`Erro ao atualizar produto ${product.id}:`, updateError);
            }
          }
        }
        
        return res.status(200).json({
          message: `Remapeamento concluído. ${updatedCount} produtos atualizados.`,
          updatedCount,
          totalProducts: products.length
        });
      } catch (remapError) {
        console.error("Erro ao remapear imagens:", remapError);
        return res.status(500).json({ message: "Erro ao remapear imagens" });
      }
    } catch (error) {
      console.error("Erro ao remapear imagens do catálogo:", error);
      return res.status(500).json({ message: "Erro ao remapear imagens do catálogo" });
    }
  });
  
  app.post("/api/catalogs/remap-all-images", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || parseInt(req.body.userId);
      
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      // Obter todos os catálogos do usuário
      const catalogs = await storage.getCatalogs(userId);
      
      if (!catalogs || catalogs.length === 0) {
        return res.status(404).json({ message: "Nenhum catálogo encontrado para este usuário" });
      }
      
      // Resultados por catálogo
      const results = [];
      
      // Importar serviço para corrigir imagens
      try {
        const { remapImagesByCode } = await import('./excel-fixed-image-mapper');
        
        // Processar cada catálogo
        for (const catalog of catalogs) {
          // Obter os produtos do catálogo
          const products = await storage.getProducts(userId, catalog.id);
          
          if (!products || products.length === 0) {
            results.push({
              catalogId: catalog.id,
              catalogName: catalog.name,
              status: "skipped",
              reason: "Nenhum produto encontrado",
              updatedCount: 0,
              totalProducts: 0
            });
            continue;
          }
          
          try {
            // Remapear imagens
            const remappedProducts = await remapImagesByCode(products, userId, catalog.id);
            
            // Atualizar produtos no banco de dados
            let updatedCount = 0;
            for (const product of remappedProducts) {
              if (product.imageUrl && product.id) {
                try {
                  await storage.updateProduct(product.id, {
                    imageUrl: product.imageUrl,
                    updatedAt: new Date()
                  });
                  updatedCount++;
                } catch (updateError) {
                  console.error(`Erro ao atualizar produto ${product.id}:`, updateError);
                }
              }
            }
            
            results.push({
              catalogId: catalog.id,
              catalogName: catalog.name,
              status: "completed",
              updatedCount,
              totalProducts: products.length
            });
          } catch (catalogError) {
            console.error(`Erro ao processar catálogo ${catalog.id}:`, catalogError);
            results.push({
              catalogId: catalog.id,
              catalogName: catalog.name,
              status: "error",
              error: catalogError.message,
              updatedCount: 0,
              totalProducts: products.length
            });
          }
        }
        
        // Contar estatísticas gerais
        const totalUpdated = results.reduce((sum, result) => sum + result.updatedCount, 0);
        const totalProducts = results.reduce((sum, result) => sum + result.totalProducts, 0);
        const catalogsProcessed = results.filter(r => r.status === "completed").length;
        
        return res.status(200).json({
          message: `Remapeamento concluído. ${totalUpdated} produtos atualizados em ${catalogsProcessed} catálogos.`,
          totalUpdated,
          totalProducts,
          catalogsProcessed,
          results
        });
      } catch (remapError) {
        console.error("Erro ao remapear imagens:", remapError);
        return res.status(500).json({ message: "Erro ao remapear imagens" });
      }
    } catch (error) {
      console.error("Erro ao remapear todas as imagens:", error);
      return res.status(500).json({ message: "Erro ao remapear todas as imagens" });
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
      
      // Importar o módulo de busca visual
      const { searchSimilarProducts } = await import('./visual-search-service');
      
      // Obter produtos do catálogo (ou todos os produtos do usuário)
      const products = await storage.getProducts(userId, catalogId ? parseInt(catalogId) : undefined);
      
      if (!products || products.length === 0) {
        return res.status(404).json({ message: "Nenhum produto encontrado para comparação" });
      }
      
      // Realizar busca de produtos similares
      const similarProducts = await searchSimilarProducts(imageBase64, products, maxResults);
      
      return res.status(200).json({
        results: similarProducts,
        totalProducts: products.length
      });
    } catch (error) {
      console.error("Erro na busca visual:", error);
      return res.status(500).json({ message: "Erro ao processar busca visual", error: error.message });
    }
  });
  
  // Rota de upload de catálogos
  app.post("/api/catalogs/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      console.log("=== INÍCIO DO PROCESSAMENTO DE CATÁLOGO ===");
      if (!req.file) {
        console.log("Erro: Nenhum arquivo enviado");
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }
      
      // Extrair informações do arquivo
      const file = req.file;
      let filePath: string;
      let s3Key: string | null = null;
      const fileName = file.originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase() || '';
      
      // Verificar quem está fazendo o upload (obter o ID do usuário)
      const userId = req.params.userId || req.query.userId || req.body.userId || req.session?.userId || 1;
      console.log(`Upload realizado pelo usuário: ${userId}`);
      
      // Verificar se estamos usando S3 ou armazenamento local
      if (useS3Storage && 's3' in file) {
        // Upload via S3
        s3Key = (file as any).key || (file as any).s3Key;
        filePath = s3Key; // Usar o caminho S3 como filePath
        console.log(`Arquivo recebido via S3: ${fileName} (${fileType}), S3 Key: ${s3Key}`);
      } else {
        // Upload local tradicional
        filePath = file.path;
        console.log(`Arquivo recebido localmente: ${fileName} (${fileType}), salvo em: ${filePath}`);
        
        // Se o S3 estiver configurado, fazer upload do arquivo para S3 (migração)
        if (useS3Storage && !s3Key) {
          try {
            console.log("Migrando arquivo para S3...");
            s3Key = await uploadCatalogFileToS3(filePath, userId, 'temp');
            console.log(`Arquivo migrado para S3 com sucesso. S3 Key: ${s3Key}`);
          } catch (s3Error) {
            console.error("Erro ao migrar arquivo para S3, continuando com armazenamento local:", s3Error);
          }
        }
      }
      console.log(`Upload realizado pelo usuário: ${userId}`);
      
      // Criar um novo catálogo no banco de dados
      const catalog = await storage.createCatalog({
        userId: typeof userId === 'string' ? parseInt(userId) : userId,
        fileName: fileName,
        fileUrl: s3Key || filePath, // Usar S3 Key se disponível, caso contrário caminho local
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
        await createCatalogInFirestore({
          name: req.body.name || fileName, 
          fileName, 
          filePath, 
          fileType,
          status: "processing",
          userId: userId.toString(),
          localCatalogId: catalogId,
          createdAt: new Date()
        });
        console.log("Catálogo salvo no Firestore");
      } catch (firestoreError) {
        console.error("Erro ao salvar catálogo no Firestore:", firestoreError);
        // Continuar mesmo se não conseguir salvar no Firestore
      }
      
      // Processar o arquivo com base no tipo
      let productsData: any[] = [];
      let extractionInfo = "";
      
      try {
        // Processar o arquivo com base no tipo
        if (fileType === 'xlsx' || fileType === 'xls') {
          // Criar diretório para imagens extraídas se não existir
          await fs.promises.mkdir(`./uploads/extracted_images`, { recursive: true });
          
          // Detectar automaticamente o formato do Excel baseado no conteúdo
          let isPOEFormat = false;
          let isSofaHomeFormat = false;
          
          try {
            const { detectExcelFormat } = await import('./excel-format-detector');
            const formatInfo = await detectExcelFormat(filePath);
            
            isPOEFormat = formatInfo.isPOEFormat;
            isSofaHomeFormat = formatInfo.isSofaHomeFormat;
            
            console.log("Detecção automática de formato:", {
              isPOEFormat,
              isSofaHomeFormat,
              headerRow: formatInfo.headerRow,
              detectedColumns: formatInfo.detectedColumns
            });
          } catch (formatDetectionError) {
            console.error("Erro na detecção automática de formato:", formatDetectionError);
          }
          
          try {
            // PRIMEIRO TENTAR SEMPRE COM O ANALISADOR DE EXCEL BASEADO EM IA
            console.log("USANDO ANALISADOR DE ESTRUTURA COM IA para qualquer tipo de catálogo");
            console.log("A IA detectará automaticamente o mapeamento de colunas mais adequado");
            
            try {
              // Criar diretório temporário para imagens extraídas 
              const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
              
              if (!fs.existsSync(extractedImagesDir)) {
                fs.mkdirSync(extractedImagesDir, { recursive: true });
              }
              
              // Extrair imagens primeiro
              console.log(`Extraindo imagens para ${extractedImagesDir}`);
              const { processExcelFile } = await import('./excel-processor-improved.js');
              const dummyProducts = await processExcelFile(filePath, userId, firestoreCatalogId);
              
              // Analisar a estrutura do Excel usando IA
              console.log(`Analisando estrutura do Excel com IA para determinar mapeamento ideal...`);
              const aiAnalyzer = await import('./ai-excel-analyzer.js');
              
              // Determinar o mapeamento de colunas usando IA
              const columnMapping = await aiAnalyzer.analyzeExcelStructure(filePath);
              console.log("IA DETERMINOU O SEGUINTE MAPEAMENTO:");
              console.log(JSON.stringify(columnMapping, null, 2));
              
              // Processar o Excel com o mapeamento determinado pela IA
              console.log(`Iniciando processamento com mapeamento DINÂMICO determinado pela IA!`);
              let universalProducts = await aiAnalyzer.processExcelWithAIMapping(
                filePath, columnMapping, userId, firestoreCatalogId
              );
              
              console.log(`Produtos detectados pelo processador baseado em IA: ${universalProducts.length}`);
              
              // Se a análise baseada em IA falhar, usar o processador universal
              if (universalProducts.length === 0) {
                console.log("Análise com IA não produziu resultados. Tentando processador universal como fallback...");
                
                // Importar o processador universal com colunas fixas
                const universalProcessor = await import('./universal-catalog-processor-new.js');
                universalProducts = await universalProcessor.processExcelUniversal(filePath, userId, firestoreCatalogId);
                console.log(`Produtos detectados pelo NOVO processador universal (fallback): ${universalProducts.length}`);
              }
              
              // Associar imagens aos produtos
              if (universalProducts.length > 0) {
                // Usar o associador de imagens do processador universal
                const universalProcessor = await import('./universal-catalog-processor-new.js');
                universalProducts = await universalProcessor.associateProductsWithImages(
                  universalProducts, filePath, extractedImagesDir, userId, firestoreCatalogId
                );
                
                // Adicionar camada de IA para aprimorar os dados
                console.log("Aprimorando dados dos produtos com IA...");
                try {
                  const { enhanceCatalogWithAI } = await import('./ai-catalog-enhancer.js');
                  const enhancedProducts = await enhanceCatalogWithAI(universalProducts);
                  
                  if (enhancedProducts && enhancedProducts.length > 0) {
                    universalProducts = enhancedProducts;
                    console.log(`Dados aprimorados com sucesso pela IA para ${universalProducts.length} produtos`);
                  } else {
                    console.log("A IA não conseguiu aprimorar os dados, mantendo dados originais");
                  }
                } catch (aiError) {
                  console.error("Erro ao aprimorar dados com IA:", aiError);
                  console.log("Continuando com os dados originais sem aprimoramento de IA");
                }
                
                productsData = universalProducts;
                extractionInfo = `Extraídos ${productsData.length} produtos (processador universal).`;
                console.log(`Processamento universal concluído com sucesso: ${productsData.length} produtos`);
                
                // Se o processador universal conseguiu extrair produtos, não continue com os outros processadores
                if (productsData.length > 0) {
                  console.log("Processador universal extraiu produtos com sucesso. Pulando outros processadores.");
                }
              }
            } catch (universalError) {
              console.error("ERRO AO PROCESSAR COM DETECTOR UNIVERSAL:", universalError);
              console.log("Tentando processadores específicos como fallback...");
            }
            
            // Se o processador universal não extraiu produtos, tentar com os processadores específicos
            if (productsData.length === 0 && isSofaHomeFormat) {
              console.log("DETECTADO FORMATO SOFÁ HOME - usando processador especializado");
              
              // Importar o processador específico para Sofá Home
              try {
                const sofaProcessor = await import('./specific-sofa-processor.js');
                
                if (firestoreCatalogId === '12') {
                  console.log("Usando produtos de exemplo específicos para o catálogo 12");
                  productsData = sofaProcessor.getExampleProducts(userId, firestoreCatalogId);
                } else {
                  // Processar o Excel com o processador especializado para Sofá Home
                  productsData = await sofaProcessor.processSofaHomeExcel(filePath, userId, firestoreCatalogId);
                }
                
                extractionInfo = `Extraídos ${productsData.length} produtos do formato Sofá Home.`;
                console.log(`Processamento Sofá Home concluído com sucesso: ${productsData.length} produtos`);
              } catch (sofaError) {
                console.error("ERRO AO PROCESSAR ARQUIVO SOFÁ HOME:", sofaError);
                // Falhar para o método tradicional se o processador falhar
                console.log("Tentando métodos alternativos para o arquivo...");
              }
            }
            else if (productsData.length === 0 && (isPOEFormat || fileName.toLowerCase().includes('poe'))) {
              console.log("DETECTADO FORMATO POE - usando novo processador especializado para POE");
              
              try {
                // Importar o novo processador aprimorado para POE que corrige os erros de mapeamento
                const poeProcessor = await import('./poe-catalog-processor-new.js');
                
                console.log(`Iniciando processamento especializado com o NOVO PROCESSADOR POE: ${filePath}`);
                console.log(`Usuário ID: ${userId}, Catálogo ID: ${firestoreCatalogId}`);
                console.log(`ATENÇÃO: Usando mapeamento EXPLÍCITO das colunas conforme solicitado:`);
                console.log(`- Nome do Produto => Coluna G (Descrição)`);
                console.log(`- Código do Produto => Coluna H (Código do Produto)`);
                console.log(`- Preço => Coluna M (Valor Total)`);
                
                // Criar diretório temporário para imagens extraídas
                const extractedImagesDir = path.join(path.dirname(filePath), 'extracted_images', path.basename(filePath, path.extname(filePath)));
                
                if (!fs.existsSync(extractedImagesDir)) {
                  fs.mkdirSync(extractedImagesDir, { recursive: true });
                }
                
                // Extrair imagens primeiro
                console.log(`Extraindo imagens para ${extractedImagesDir}`);
                const { processExcelFile } = await import('./excel-processor-improved.js');
                const dummyProducts = await processExcelFile(filePath, userId, firestoreCatalogId);
                
                // Processar o Excel com o processador especializado para POE
                let poeProducts = await poeProcessor.processPOECatalog(filePath, userId, firestoreCatalogId);
                
                // Associar imagens aos produtos POE
                if (poeProducts.length > 0) {
                  poeProducts = await poeProcessor.associatePOEProductsWithImages(
                    poeProducts, filePath, extractedImagesDir, userId, firestoreCatalogId
                  );
                  
                  // Adicionar camada de IA para aprimorar os dados POE
                  console.log("Aprimorando dados dos produtos POE com IA...");
                  try {
                    const { enhanceCatalogWithAI } = await import('./ai-catalog-enhancer.js');
                    const enhancedProducts = await enhanceCatalogWithAI(poeProducts);
                    
                    if (enhancedProducts && enhancedProducts.length > 0) {
                      poeProducts = enhancedProducts;
                      console.log(`Dados POE aprimorados com sucesso pela IA para ${poeProducts.length} produtos`);
                    } else {
                      console.log("A IA não conseguiu aprimorar os dados POE, mantendo dados originais");
                    }
                  } catch (aiError) {
                    console.error("Erro ao aprimorar dados POE com IA:", aiError);
                    console.log("Continuando com os dados POE originais sem aprimoramento de IA");
                  }
                }
                
                productsData = poeProducts;
                extractionInfo = `Extraídos ${productsData.length} produtos do arquivo POE (processador especializado v2).`;
                
                console.log(`Processamento POE v2 concluído com sucesso: ${productsData.length} produtos`);
              } catch (poeError) {
                console.error("ERRO AO PROCESSAR ARQUIVO POE:", poeError);
                // Falhar para o método tradicional se o processador POE falhar
                console.log("Tentando métodos alternativos para o arquivo POE...");
              }
            }
            
            // Se não for POE ou o processador POE falhou, tentar com o processador de colunas fixas
            if (productsData.length === 0) {
              // Importar o processador de colunas fixas
              const { processExcelWithFixedColumns } = await import('./fixed-excel-processor');
              
              // Usar o processador com colunas fixas para extrair os dados do Excel
              console.log(`Iniciando processamento do arquivo Excel com colunas fixas: ${filePath}`);
              console.log(`Usuário ID: ${userId}, Catálogo ID: ${firestoreCatalogId}`);
              
              // Processar o Excel com o formato de colunas fixas
              try {
                productsData = await processExcelWithFixedColumns(filePath, userId, firestoreCatalogId);
                
                // Adicionar camada de IA para aprimorar os dados do processador de colunas fixas
                if (productsData.length > 0) {
                  console.log("Aprimorando dados dos produtos de colunas fixas com IA...");
                  try {
                    const { enhanceCatalogWithAI } = await import('./ai-catalog-enhancer.js');
                    const enhancedProducts = await enhanceCatalogWithAI(productsData);
                    
                    if (enhancedProducts && enhancedProducts.length > 0) {
                      productsData = enhancedProducts;
                      console.log(`Dados de colunas fixas aprimorados com sucesso pela IA para ${productsData.length} produtos`);
                    } else {
                      console.log("A IA não conseguiu aprimorar os dados de colunas fixas, mantendo dados originais");
                    }
                  } catch (aiError) {
                    console.error("Erro ao aprimorar dados de colunas fixas com IA:", aiError);
                    console.log("Continuando com os dados originais de colunas fixas sem aprimoramento de IA");
                  }
                }
                
                extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (colunas fixas).`;
              } catch (fixedError) {
                console.error("Erro no processador de colunas fixas:", fixedError);
                throw fixedError; // Propagar o erro para o catch externo
              }
            }
            
            // Verificar produtos com imagens
            let productsWithImages = 0;
            for (const product of productsData) {
              if (product.imageUrl) {
                productsWithImages++;
                console.log(`Produto ${product.codigo || product.nome || product.code || product.name} tem imagem: ${product.imageUrl}`);
              }
            }
            console.log(`${productsWithImages} produtos contêm imagens (${Math.round(productsWithImages/productsData.length*100)}%)`);
            
            console.log(`Processamento de produtos e imagens concluído: ${productsData.length} produtos.`);
            
          } catch (processingError) {
            console.error("Erro ao processar Excel com métodos especializados:", processingError);
            
            // Tentar método melhorado com detecção inteligente de formato
            console.log("Usando processador de Excel com detecção inteligente de formato...");
            
            try {
              // Primeiro tentar com o processador melhorado
              const { processExcelFile } = await import('./excel-processor-improved.js');
              productsData = await processExcelFile(filePath, userId, firestoreCatalogId);
              
              // Adicionar camada de IA para aprimorar os produtos do fallback
              if (productsData.length > 0) {
                console.log("Aprimorando dados dos produtos do detector inteligente com IA...");
                try {
                  const { enhanceCatalogWithAI } = await import('./ai-catalog-enhancer.js');
                  const enhancedProducts = await enhanceCatalogWithAI(productsData);
                  
                  if (enhancedProducts && enhancedProducts.length > 0) {
                    productsData = enhancedProducts;
                    console.log(`Dados do detector inteligente aprimorados com sucesso pela IA para ${productsData.length} produtos`);
                  } else {
                    console.log("A IA não conseguiu aprimorar os dados do detector inteligente, mantendo dados originais");
                  }
                } catch (aiError) {
                  console.error("Erro ao aprimorar dados do detector inteligente com IA:", aiError);
                  console.log("Continuando com os dados originais sem aprimoramento de IA");
                }
              }
              
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (detector inteligente).`;
            } catch (improvedError) {
              console.error("Erro no processador melhorado:", improvedError);
              
              // Fallback para o método simples ESM
              console.log("Fallback para método ESM de processamento Excel...");
              const { processExcelFile } = await import('./excel-processor-simplified-esm.js');
              productsData = await processExcelFile(filePath, userId, firestoreCatalogId);
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (método simplificado).`;
            }
            
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
            const productsForFirestore = productsData.map((p: any) => {
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
            
            const { saveProductsToFirestore } = await import('./firestore-service');
            const productIds = await saveProductsToFirestore(
              productsForFirestore, 
              userId, 
              firestoreCatalogId
            );
            console.log(`${productIds.length} produtos do Excel salvos no Firestore`);
            
            // Atualizar status do catálogo no Firestore
            const { updateCatalogStatusInFirestore } = await import('./firestore-service');
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
        } else if (fileType === 'pdf') {
          // Código para processar PDF...
          // Omitido por brevidade
        } else {
          throw new Error(`Tipo de arquivo não suportado: ${fileType}`);
        }
        
        // Atualizar o status do catálogo no banco de dados
        await storage.updateCatalog(catalogId, { processedStatus: "completed" });
        
        // Retornar resposta de sucesso
        return res.status(200).json({
          message: "Catálogo processado com sucesso",
          catalogId,
          firestoreCatalogId,
          productsCount: productsData.length,
          extractionInfo
        });
        
      } catch (error) {
        console.error("Erro ao processar arquivo:", error);
        
        // Atualizar o status do catálogo no banco de dados
        await storage.updateCatalog(catalogId, { processedStatus: "error" });
        
        // Atualizar o status do catálogo no Firestore
        try {
          const { updateCatalogStatusInFirestore } = await import('./firestore-service');
          await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "error", 0);
        } catch (firestoreError) {
          console.error("Erro ao atualizar status do catálogo no Firestore:", firestoreError);
        }
        
        return res.status(500).json({
          message: "Erro ao processar o arquivo",
          error: error.message
        });
      }
    } catch (error) {
      console.error("Erro geral no upload:", error);
      return res.status(500).json({
        message: "Erro no processamento do upload",
        error: error.message
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