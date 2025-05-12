import type { Express, Request, Response, NextFunction } from "express";
import { Router } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { type InsertUser, type Catalog, type InsertCatalog, type DesignProject, type NewDesignProject, type DesignProjectItem, User, Catalog as SharedCatalog, type AiDesignChatMessage, type InsertAiDesignChatMessage } from '@shared/schema';
import multer from "multer";
import * as fs from "fs";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import mime from "mime-types";
import { createCanvas } from "canvas";
// @ts-ignore
import { deleteDataFromFirestore } from "./test-upload.js";
// @ts-ignore
import { getS3UploadMiddleware, checkS3Configuration, uploadBufferToS3 } from "./s3-service.js";
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
// @ts-ignore
import { processExcelWithAI } from './ai-excel-processor.js';
import { fixProductImages } from './excel-fixed-image-mapper';
import { extractAndUploadImagesSequentially, type ExtractedImageInfo } from './excel-image-extractor';
import { spawn } from 'child_process';
import { runPythonColumnExtractor } from './excel-image-extractor';
import { processCatalogInBackground } from './catalog-processor';
import bcrypt from 'bcrypt';
import { generateQuotePdf, generateQuotePdfWithPuppeteer } from './pdf-generator';
import OpenAI from 'openai';
import { processDesignProjectImage } from './ai-design-processor';

const SALT_ROUNDS = 10;

interface HttpError extends Error {
  status?: number;
  isOperational?: boolean;
  code?: string;
}

function globalErrorHandler(err: HttpError, req: Request, res: Response, next: NextFunction) {
  console.error("----------------------------------------");
  console.error("GLOBAL ERROR HANDLER CAUGHT AN ERROR:");
  console.error("Timestamp:", new Date().toISOString());
  console.error("Route:", req.method, req.originalUrl);
  if (req.body && Object.keys(req.body).length > 0) {
    console.error("Request Body Keys:", Object.keys(req.body).join(', '));
  }
  console.error("Error Name:", err.name);
  console.error("Error Message:", err.message);
  if (err.code) {
    console.error("Original Error Code:", err.code);
  }
  if (err.status) {
    console.error("HTTP Status:", err.status);
  }
  if (err.stack) {
    console.error("Stack Trace:", err.stack);
  }
  console.error("----------------------------------------");

  const statusCode = err.status || 500;
  let responseMessage = "Ocorreu um erro interno no servidor.";
  if (err.isOperational || (statusCode >= 400 && statusCode < 500)) {
    responseMessage = err.message || "Ocorreu um erro.";
  }

  if (res.headersSent) {
    console.error("Headers já enviados, não foi possível enviar resposta de erro formatada.");
    return next(err);
  }

  res.status(statusCode).json({
    status: 'error',
    message: responseMessage,
  });
}

type MoodboardCreateInput = {
  userId: number;
  projectName: string;
  productIds: number[];
  fileUrl?: string;
  clientName?: string;
  architectName?: string;
  quoteId?: number;
};

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

let useS3Storage = true;

const localStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

let upload = multer({ storage: localStorage });

const logoUploadInMemory = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      const err: HttpError = new Error('Tipo de arquivo inválido para logo. Use PNG, JPG, WEBP.');
      err.status = 400;
      err.isOperational = true;
      cb(err);
    }
  }
});

const renderUploadInMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      const err: HttpError = new Error('Tipo de arquivo inválido para render. Use PNG, JPG, WEBP, etc.');
      err.status = 400;
      err.isOperational = true;
      cb(err);
    }
  }
});

const visualSearchUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      const err: HttpError = new Error('Apenas imagens são permitidas para busca visual.');
      err.status = 400;
      err.isOperational = true;
      cb(err);
    }
  }
});

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function handleMulterError(err: any, req: Request, res: Response, next: NextFunction) {
  if (err) {
    console.error("!!!! MULTER ERROR DETECTED by handleMulterError !!!!", err);
    const httpErr: HttpError = new Error(err.message || 'Erro durante o upload do arquivo.');
    httpErr.status = (err instanceof multer.MulterError) ? 400 : 500;
    httpErr.isOperational = true;
    if (err.code) {
      httpErr.code = err.code;
    }
    return next(httpErr);
  }
  next();
}

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    const err: HttpError = new Error("Autenticação necessária.");
    err.status = 401;
    err.isOperational = true;
    return next(err);
  }
  next();
};

export async function registerRoutes(app: Express): Promise<void> {
  try {
    const s3Config = await checkS3Configuration();
    if (s3Config.status === 'success') {
      console.log(`✅ Amazon S3 conectado com sucesso - Bucket: ${s3Config.bucket}, Região: ${s3Config.region}`);
      useS3Storage = true;
      try {
        if (!fs.existsSync('./uploads')) {
          fs.mkdirSync('./uploads', { recursive: true });
        }
        // @ts-ignore
        const multerS3Setup = await import('./s3-service.js');
        if (typeof multerS3Setup.getS3UploadMiddleware !== 'function') {
          throw new Error('getS3UploadMiddleware não é uma função em s3-service.js');
        }
        upload = multerS3Setup.getS3UploadMiddleware('catalogs');
        console.log('Upload de arquivos configurado para usar Amazon S3');
      } catch (multerError: any) {
        console.error('ERRO CRÍTICO: Falha ao configurar Multer com S3:', multerError);
        throw new Error(`Configuração do Multer-S3 falhou: ${multerError.message}`);
      }
    } else {
      console.error(`ERRO CRÍTICO: Não foi possível conectar ao S3: ${s3Config.message}. Verifique as credenciais e configuração.`);
      throw new Error(`Configuração do S3 obrigatória para o funcionamento da aplicação: ${s3Config.message}`);
    }
  } catch (error: any) {
    console.error('ERRO CRÍTICO DURANTE A CONFIGURAÇÃO INICIAL DO S3:', error);
    throw new Error(`Falha crítica na inicialização das rotas (S3 Setup): ${error.message}`);
  }
  
  try {
    const { addS3ImageRoutes } = await import('./s3-image-routes');
    if (typeof addS3ImageRoutes !== 'function') {
        throw new Error('addS3ImageRoutes não é uma função em s3-image-routes.js');
    }
    await addS3ImageRoutes(app);
    console.log('Rotas de imagem S3 adicionadas com sucesso');
  } catch (error: any) {
    console.error('ERRO CRÍTICO: Não foi possível adicionar rotas de imagem S3:', error);
    throw new Error(`Configuração das rotas de imagem S3 é obrigatória: ${error.message}`);
  }

  app.get("/backend/healthcheck", (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/backend/test-route", (req: Request, res: Response) => {
    console.log("Rota de teste acessada!");
    res.status(200).json({ message: "Rota de teste funcionando!" });
  });

  app.post("/backend/auth/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, name, companyName } = req.body;
      if (!email || !password || !name) {
        const err: HttpError = new Error("Email, senha e nome são obrigatórios");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await storage.createUser({
        email, password: hashedPassword, name, companyName: companyName || "Empresa Padrão",
      });
      req.session.userId = user.id;
      return res.status(201).json({
        id: user.id, email: user.email, name: user.name, companyName: user.companyName
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        const err: HttpError = new Error("Este email já está cadastrado.");
        err.status = 409; err.isOperational = true; return next(err);
      }
      if (error.message && error.message.toLowerCase().includes('unique constraint failed: users.email')) {
          const err: HttpError = new Error("Este email já está cadastrado.");
          err.status = 409; err.isOperational = true; return next(err);
      }
      console.error("[Route /auth/register] Erro ao registrar usuário:", error);
      return next(error);
    }
  });

  app.post("/backend/auth/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        const err: HttpError = new Error("Email e senha são obrigatórios");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const user = await storage.getUserByEmail(email);
      if (!user) { const err: HttpError = new Error("Credenciais inválidas"); err.status = 401; err.isOperational = true; return next(err); }
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) { const err: HttpError = new Error("Credenciais inválidas"); err.status = 401; err.isOperational = true; return next(err); }
      req.session.userId = user.id;
      return res.status(200).json({
        id: user.id, email: user.email, name: user.name, companyName: user.companyName
      });
    } catch (error) {
      console.error("[Route /auth/login] Erro no login:", error);
      return next(error);
    }
  });

  app.get("/backend/auth/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        req.session.destroy(() => {}); 
        const err: HttpError = new Error("Usuário da sessão não encontrado.");
        err.status = 401; err.isOperational = true; return next(err);
      }
      return res.status(200).json({
        id: user.id, email: user.email, name: user.name, companyName: user.companyName
      });
    } catch (error) {
      console.error("[Route /auth/me] Erro ao obter usuário:", error);
      return next(error);
    }
  });

  app.put("/backend/auth/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const receivedData = req.body;
      if (!receivedData || typeof receivedData !== 'object' || Object.keys(receivedData).length === 0) {
        const err: HttpError = new Error("Dados inválidos ou vazios para atualização.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const updateDataForDb: Partial<InsertUser & { company_logo_url?: string | null, company_address?: string | null, company_phone?: string | null, company_cnpj?: string | null, quote_payment_terms?: string | null, quote_validity_days?: number | null, cash_discount_percentage?: number | null }> = {};
      const allowedFields: string[] = ['name', 'companyName', 'companyAddress', 'companyPhone', 'companyCnpj', 'companyLogoUrl', 'quotePaymentTerms', 'quoteValidityDays', 'cashDiscountPercentage'];
      const dbFieldMapping: Record<string, string> = {
          companyAddress: 'company_address', companyPhone: 'company_phone', companyCnpj: 'company_cnpj',
          companyLogoUrl: 'company_logo_url', quotePaymentTerms: 'quote_payment_terms',
          quoteValidityDays: 'quote_validity_days', cashDiscountPercentage: 'cash_discount_percentage'
      };
      for (const key of allowedFields) {
          if (key in receivedData && receivedData[key] !== undefined) {
              const dbKey = dbFieldMapping[key] || key;
              (updateDataForDb as any)[dbKey] = receivedData[key];
          }
      }
      if (Object.keys(updateDataForDb).length === 0) {
        const err: HttpError = new Error("Nenhum dado válido fornecido para atualização.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const updatedUser = await storage.updateUser(userId, updateDataForDb);
      if (!updatedUser) {
        const err: HttpError = new Error("Usuário não encontrado para atualização.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const { password, ...userToSend } = updatedUser;
      return res.status(200).json(userToSend);
    } catch (error) {
      console.error("[Route /auth/me PUT] Erro ao atualizar perfil:", error);
      return next(error);
    }
  });

  app.post("/backend/auth/logout", requireAuth, (req: Request, res: Response, next: NextFunction) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("[Route /auth/logout] Erro ao destruir sessão:", err);
        const httpErr: HttpError = new Error("Erro ao encerrar sessão");
        httpErr.status = 500; return next(httpErr);
      }
      res.clearCookie('connect.sid'); 
      return res.status(200).json({ message: "Logout realizado com sucesso" });
    });
  });

  app.post("/api/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, name, companyName } = req.body;
      if (!email || !password || !name) {
        const err: HttpError = new Error("Email, senha e nome são obrigatórios");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await storage.createUser({
        email, password: hashedPassword, name, companyName: companyName || "Empresa Padrão",
      });
      req.session.userId = user.id;
      return res.status(201).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('email') || (error.message && error.message.toLowerCase().includes('unique constraint failed: users.email'))) {
          const err: HttpError = new Error("Este email já está cadastrado.");
          err.status = 409; err.isOperational = true; return next(err);
      }
      console.error("[Route /api/register] Erro:", error);
      return next(error);
    }
  });

  app.post("/api/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        const err: HttpError = new Error("Email e senha são obrigatórios");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const user = await storage.getUserByEmail(email);
      if (!user) { const err: HttpError = new Error("Credenciais inválidas"); err.status = 401; err.isOperational = true; return next(err); }
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) { const err: HttpError = new Error("Credenciais inválidas"); err.status = 401; err.isOperational = true; return next(err); }
      req.session.userId = user.id;
      return res.status(200).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName });
    } catch (error) {
      console.error("[Route /api/login] Erro:", error);
      return next(error);
    }
  });

  app.get("/api/user", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        req.session.destroy(() => {});
        const err: HttpError = new Error("Usuário da sessão não encontrado.");
        err.status = 401; err.isOperational = true; return next(err);
      }
      return res.status(200).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName });
    } catch (error) {
      console.error("[Route /api/user] Erro:", error);
      return next(error);
    }
  });

  app.post("/api/logout", requireAuth, (req: Request, res: Response, next: NextFunction) => {
      req.session.destroy((err) => {
        if (err) {
        console.error("[Route /api/logout] Erro ao destruir sessão:", err);
        const httpErr: HttpError = new Error("Erro ao encerrar sessão");
        httpErr.status = 500; return next(httpErr);
        }
        res.clearCookie('connect.sid');
        return res.status(200).json({ message: "Logout realizado com sucesso" });
      });
  });

  app.get("/backend/products", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const catalogIdQuery = req.query.catalogId as string | undefined;
      const catalogId = catalogIdQuery ? parseInt(catalogIdQuery) : undefined;
      if (catalogIdQuery && isNaN(catalogId!)) {
        const err: HttpError = new Error("catalogId inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const products = await storage.getProducts(userId, catalogId);
      const productsForJson = products.map(p => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      }));
      return res.status(200).json(productsForJson);
    } catch (error) {
      console.error("[Route /products GET] Erro:", error);
      return next(error);
    }
  });

  app.get("/backend/products/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do produto inválido");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const product = await storage.getProduct(id);
      if (!product || product.userId !== req.session.userId!) {
        const err: HttpError = new Error("Produto não encontrado ou acesso negado");
        err.status = 404; err.isOperational = true; return next(err);
      }
      return res.status(200).json(product);
    } catch (error) {
      console.error(`[Route /products/:id GET ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });

  app.post("/backend/products", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const product = await storage.createProduct({ ...req.body, userId });
      return res.status(201).json(product);
    } catch (error) {
      console.error("[Route /products POST] Erro:", error);
      return next(error);
    }
  });
  
  app.put("/backend/products/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do produto inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const existingProduct = await storage.getProduct(id);
      if (!existingProduct || existingProduct.userId !== req.session.userId!) {
        const err: HttpError = new Error("Produto não encontrado ou acesso negado para atualização");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const data = req.body;
      delete data.userId; delete data.id;
      const product = await storage.updateProduct(id, { ...data, isEdited: true });
      if (!product) {
        const err: HttpError = new Error("Produto não encontrado após tentativa de atualização");
        err.status = 404; err.isOperational = true; return next(err);
      }
      return res.status(200).json(product);
    } catch (error) {
      console.error(`[Route /products/:id PUT ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.delete("/backend/products/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do produto inválido");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const existingProduct = await storage.getProduct(id);
      if (!existingProduct || existingProduct.userId !== req.session.userId!) {
        const err: HttpError = new Error("Produto não encontrado ou acesso negado para exclusão");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const success = await storage.deleteProduct(id);
      if (!success) {
        const err: HttpError = new Error("Falha ao excluir produto, ou produto não encontrado");
        err.status = 404; err.isOperational = true; return next(err);
      }
      return res.status(204).send();
    } catch (error) {
      console.error(`[Route /products/:id DELETE ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });

  app.get("/backend/catalogs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const catalogs = await storage.getCatalogs(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("[Route /catalogs GET] Erro:", error);
      return next(error);
    }
  });
  
  app.post("/backend/catalogs", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const { fileName, fileUrl, originalCatalogId } = req.body;
      if (!fileName || !fileUrl) {
        const err: HttpError = new Error("Nome do arquivo (fileName) e URL (fileUrl) são obrigatórios");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const catalog = await storage.createCatalog({
        userId,
        fileName,
        fileUrl,
        processedStatus: "pending",
        // originalCatalogId: originalCatalogId ? parseInt(originalCatalogId) : undefined,
      });
      return res.status(201).json(catalog);
    } catch (error) {
      console.error("[Route /catalogs POST] Erro:", error);
      return next(error);
    }
  });
  
  app.get("/backend/catalogs/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do catálogo inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const catalog = await storage.getCatalog(id);
      if (!catalog || catalog.userId !== req.session.userId!) {
        const err: HttpError = new Error("Catálogo não encontrado ou acesso negado");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const products = await storage.getProducts(catalog.userId, id);
      return res.status(200).json({ ...catalog, products });
    } catch (error) {
      console.error(`[Route /catalogs/:id GET ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.put("/backend/catalogs/:id/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do catálogo inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      if (!status || typeof status !== 'string') {
        const err: HttpError = new Error("Status é obrigatório e deve ser uma string");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const catalog = await storage.getCatalog(id);
      if (!catalog || catalog.userId !== req.session.userId!) {
        const err: HttpError = new Error("Catálogo não encontrado ou acesso negado");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const updatedCatalog = await storage.updateCatalogStatus(id, status);
      if(!updatedCatalog){
        const err: HttpError = new Error("Falha ao atualizar o status do catálogo.");
        err.status = 500;
        return next(err);
      }
      return res.status(200).json({ message: "Status atualizado com sucesso", catalog: updatedCatalog });
    } catch (error) {
      console.error(`[Route /catalogs/:id/status PUT ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.post("/backend/catalogs/:id/remap-images", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const catalogId = parseInt(req.params.id);
      const userId = req.session.userId!;
      if (isNaN(catalogId)) { 
        const err: HttpError = new Error("ID do catálogo inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const catalog = await storage.getCatalog(catalogId);
      if (!catalog || catalog.userId !== userId) {
          const err: HttpError = new Error("Catálogo não encontrado ou não pertence ao usuário");
          err.status = 404; err.isOperational = true; return next(err);
      }
      const result = await fixProductImages(userId, catalogId);
      return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      console.error(`[Route /catalogs/:id/remap-images POST ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.post("/backend/catalogs/remap-all-images", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const catalogs = await storage.getCatalogs(userId);
      if (!catalogs || catalogs.length === 0) {
        const err: HttpError = new Error("Nenhum catálogo encontrado para o usuário");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const results = [];
      let totalUpdatedAllCatalogs = 0;
        for (const catalog of catalogs) {
          try {
            const result = await fixProductImages(userId, catalog.id);
          results.push({ catalogId: catalog.id, catalogName: catalog.fileName, ...result });
          if(result.success) totalUpdatedAllCatalogs += result.updated || 0;
        } catch (catalogError: any) {
          results.push({ catalogId: catalog.id, catalogName: catalog.fileName, success: false, message: catalogError.message || "Erro desconhecido ao processar catálogo", updated: 0 });
        }
      }
        return res.status(200).json({
        message: `Remapeamento concluído. ${totalUpdatedAllCatalogs} produtos atualizados em ${catalogs.length} catálogos.`,
        totalUpdated: totalUpdatedAllCatalogs,
        details: results
      });
    } catch (error) {
      console.error("[Route /catalogs/remap-all-images POST] Erro:", error);
      return next(error);
    }
  });
  
  app.delete("/backend/catalogs/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do catálogo inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const catalog = await storage.getCatalog(id);
      if (!catalog || catalog.userId !== req.session.userId!) {
        const err: HttpError = new Error("Catálogo não encontrado ou acesso negado para exclusão");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const deletedProductsCount = await storage.deleteProductsByCatalogId(id);
      const success = await storage.deleteCatalog(id);
      if (!success) {
        const err: HttpError = new Error("Falha ao excluir catálogo do banco de dados");
        err.status = 500; return next(err);
      }
      return res.status(200).json({ 
        message: "Catálogo e seus produtos associados foram excluídos com sucesso.",
        productsDeleted: deletedProductsCount
      });
    } catch (error) {
      console.error(`[Route /catalogs/:id DELETE ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });

  // ========================================
  // ROTAS DE UPLOAD (Principalmente para Catálogos)
  // ========================================
  // app.post("/backend/catalogs/upload", requireAuth, upload.single('file'), handleMulterError, async (req: Request, res: Response, next: NextFunction) => {
  // Código antigo comentado para substituí-lo pela sugestão do ChatGPT
  // });

  app.post("/backend/catalogs/upload", requireAuth, upload.single('file'), handleMulterError, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
  
      if (!file) {
        const err: HttpError = new Error("Nenhum arquivo enviado");
        err.status = 400;
        err.isOperational = true;
        return next(err);
      }
  
      const fileName = file.originalname;
      const fileType = path.extname(fileName).substring(1).toLowerCase(); 
      const userId = req.session.userId!;
      
      const fileUrl = (file as any)?.location || file.path || '';
      const s3Key = (file as any)?.key || null; 
  
      const catalogData: InsertCatalog = {
        userId,
        fileName,
        fileUrl,
        processedStatus: "uploaded",
      };
  
      const catalog = await storage.createCatalog(catalogData);
  
      const jobData = {
        userId,
        catalogId: catalog.id,
        fileName,
        fileType: fileType,
        s3Key: s3Key,
        processingFilePath: fileUrl, 
      };
  
      processCatalogInBackground(jobData).catch(err => {
        console.error(`ERRO ASYNC no processamento background do catálogo ${catalog.id}:`, err);
        storage.updateCatalogStatus(catalog.id, 'failed').catch(updateErr => 
          console.error("Erro ao atualizar status para falho após erro background:", updateErr)
        );
      });
  
      return res.status(202).json({
        message: `Catálogo "${fileName}" enviado com sucesso e está na fila para processamento.`,
        catalogId: catalog.id,
        s3Url: (file as any)?.location || undefined
      });
    } catch (e: any) {
      console.error("[Route /catalogs/upload POST] Erro:", e);
      const errorToPass: HttpError = {
        name: e.name || 'UploadError',
        message: e.message || "Erro no upload do catálogo",
        status: e.status || 500,
        isOperational: e.isOperational || false,
        code: e.code
      };
      return next(errorToPass);
    }
  });
  
  app.get("/backend/quotes", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const quotes = await storage.getQuotes(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      console.error("[Route /quotes GET] Erro:", error);
      return next(error);
    }
  });
  
  app.get("/backend/quotes/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do orçamento inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const quote = await storage.getQuote(id);
      if (!quote || quote.userId !== req.session.userId!) {
        const err: HttpError = new Error("Orçamento não encontrado ou acesso negado");
        err.status = 404; err.isOperational = true; return next(err);
      }
      return res.status(200).json(quote);
    } catch (error) {
      console.error(`[Route /quotes/:id GET ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.post("/backend/quotes", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const quoteData = req.body;
      const quote = await storage.createQuote({ ...quoteData, userId });
      return res.status(201).json(quote);
    } catch (error) {
      console.error("[Route /quotes POST] Erro:", error);
      return next(error);
    }
  });
  
  app.put("/backend/quotes/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do orçamento inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const quote = await storage.getQuote(id);
      if (!quote || quote.userId !== req.session.userId!) {
        const err: HttpError = new Error("Orçamento não encontrado ou acesso negado para atualização");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const data = req.body;
      delete data.userId; delete data.id;
      const updatedQuote = await storage.updateQuote(id, data);
      if (!updatedQuote) {
         const err: HttpError = new Error("Falha ao atualizar orçamento"); 
         err.status = 500; return next(err);
      }
      return res.status(200).json(updatedQuote);
    } catch (error) {
      console.error(`[Route /quotes/:id PUT ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  app.delete("/backend/quotes/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        const err: HttpError = new Error("ID do orçamento inválido"); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const quote = await storage.getQuote(id);
      if (!quote || quote.userId !== req.session.userId!) {
        const err: HttpError = new Error("Orçamento não encontrado ou acesso negado para exclusão");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const success = await storage.deleteQuote(id);
      if (!success) {
        const err: HttpError = new Error("Falha ao excluir orçamento");
        err.status = 500; return next(err);
      }
      return res.status(204).send();
    } catch (error) {
      console.error(`[Route /quotes/:id DELETE ${req.params.id}] Erro:`, error);
      return next(error);
    }
  });
  
  //   app.post("/backend/quotes/generate-pdf-puppeteer", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  //     try {
  //       const userId = req.session.userId!;
  //       const user = await storage.getUser(userId);
  //       if (!user) {
  //         const err: HttpError = new Error("Usuário não encontrado"); 
  //         err.status = 403; err.isOperational = true; return next(err);
  //       }
  //       const quoteData = req.body;
  //       if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
  //         const err: HttpError = new Error("Dados do orçamento inválidos ou incompletos para PDF.");
  //         err.status = 400; err.isOperational = true; return next(err);
  //       }
  //       try {
  //         const pdfBuffer = await generateQuotePdfWithPuppeteer(quoteData, user);
  //         res.setHeader('Content-Type', 'application/pdf');
  //         res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_P.pdf"`);
  //         return res.send(pdfBuffer);
  //       } catch (puppeteerError: any) {
  //         console.error("⚠️ Falha no Puppeteer, tentando fallback pdf-lib:", puppeteerError);
  //         const pdfBytes = await generateQuotePdf(quoteData, user); // Supondo que generateQuotePdf usa pdf-lib
  //         res.setHeader('Content-Type', 'application/pdf');
  //         res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_Lib.pdf"`);
  //         return res.send(Buffer.from(pdfBytes));
  //       }
  //     } catch (error) {
  //       console.error("[Route /quotes/generate-pdf-puppeteer POST] Erro geral:", error);
  //       return next(error);
  //     }
  //   });

  app.post("/backend/quotes/generate-pdf", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
        const user = await storage.getUser(userId);
      if (!user) { 
        const err: HttpError = new Error("Usuário não encontrado"); 
        err.status = 403; err.isOperational = true; return next(err);
      }
        const quoteData = req.body;
        if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
         const err: HttpError = new Error("Dados do orçamento inválidos ou incompletos para PDF.");
         err.status = 400; err.isOperational = true; return next(err);
        }
        const pdfBytes = await generateQuotePdf(quoteData, user);
        res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/s+/g, '_')}_Lib.pdf"`);
        return res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error("[Route /quotes/generate-pdf POST] Erro:", error);
      return next(error);
    }
  });

  app.get("/backend/moodboards", requireAuth, async (req: Request, res: Response, next: NextFunction) => { 
    try {
      const userId = req.session.userId!;
      const moodboards = await storage.getMoodboards(userId);
      return res.status(200).json(moodboards);
    } catch (error) {
      console.error("[Route /moodboards GET] Erro:", error);
      return next(error);
    }
  });

  app.post("/backend/moodboards", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const { projectName, productIds, clientName, architectName, quoteId } = req.body as MoodboardCreateInput;
      if (!projectName || !productIds || !Array.isArray(productIds) || productIds.length === 0) {
        const err: HttpError = new Error("Nome do projeto e uma lista de IDs de produtos são obrigatórios.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      if (!productIds.every(id => typeof id === 'number' && !isNaN(id))) {
        const err: HttpError = new Error("Todos os IDs de produtos devem ser números válidos.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const moodboard = await storage.createMoodboard({
        userId, projectName, productIds,
        clientName: clientName || undefined, 
        architectName: architectName || undefined,
        quoteId: quoteId || undefined,
      });
      return res.status(201).json(moodboard);
    } catch (error) {
      console.error("[Route /moodboards POST] Erro:", error);
      return next(error);
    }
  });

  app.get("/backend/moodboards/:moodboardId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const moodboardId = parseInt(req.params.moodboardId);
      if (isNaN(moodboardId)) { 
        const err: HttpError = new Error("ID do moodboard inválido."); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const moodboard = await storage.getMoodboard(moodboardId);
      if (!moodboard || moodboard.userId !== userId) {
        const err: HttpError = new Error("Moodboard não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      return res.status(200).json(moodboard);
    } catch (error) {
      console.error(`[Route /moodboards/:id GET ${req.params.moodboardId}] Erro:`, error);
      return next(error);
    }
  });

  app.put("/backend/moodboards/:moodboardId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const moodboardId = parseInt(req.params.moodboardId);
      const dataToUpdate = req.body as Partial<MoodboardCreateInput>;
      if (isNaN(moodboardId)) { 
        const err: HttpError = new Error("ID do moodboard inválido."); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      if (Object.keys(dataToUpdate).length === 0) {
        const err: HttpError = new Error("Nenhum dado fornecido para atualização do moodboard.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      delete (dataToUpdate as any).userId; delete (dataToUpdate as any).id;
      const moodboard = await storage.getMoodboard(moodboardId);
      if (!moodboard || moodboard.userId !== userId) {
        const err: HttpError = new Error("Moodboard não encontrado ou acesso não autorizado para atualização.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const updatedMoodboard = await storage.updateMoodboard(moodboardId, dataToUpdate);
      if (!updatedMoodboard) {
          const err: HttpError = new Error("Falha ao atualizar moodboard.");
          err.status = 500; return next(err);
      }
      return res.status(200).json(updatedMoodboard);
    } catch (error) {
      console.error(`[Route /moodboards/:id PUT ${req.params.moodboardId}] Erro:`, error);
      return next(error);
    }
  });

  app.delete("/backend/moodboards/:moodboardId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const moodboardId = parseInt(req.params.moodboardId);
      if (isNaN(moodboardId)) { 
        const err: HttpError = new Error("ID do moodboard inválido."); 
        err.status = 400; err.isOperational = true; return next(err);
      }
      const moodboard = await storage.getMoodboard(moodboardId);
      if (!moodboard || moodboard.userId !== userId) {
        const err: HttpError = new Error("Moodboard não encontrado ou acesso não autorizado para exclusão.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const success = await storage.deleteMoodboard(moodboardId);
      if (!success) {
          const err: HttpError = new Error("Falha ao excluir moodboard.");
          err.status = 500; return next(err);
      }
      return res.status(204).send();
    } catch (error) {
      console.error(`[Route /moodboards/:id DELETE ${req.params.moodboardId}] Erro:`, error);
      return next(error);
    }
  });

  // =======================================
  // ROTAS DE DESIGN COM IA
  // =======================================
  app.post("/api/ai-design-projects", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const { name, title } = req.body;

      const projectName = name || title;

      if (!projectName || typeof projectName !== 'string' || projectName.trim() === '') {
        const err: HttpError = new Error("O nome/título do projeto é obrigatório.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      
      const projectData: NewDesignProject = {
        userId,
        name: projectName,
      };
      const newDesignProject = await storage.createDesignProject(projectData);
      return res.status(201).json(newDesignProject);
    } catch (error) {
      console.error("[Route /api/ai-design-projects POST] Erro:", error);
      return next(error);
    }
  });

  app.get("/api/ai-design-projects/:projectId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const projectId = parseInt(req.params.projectId);
      if (isNaN(projectId)) {
        const err: HttpError = new Error("ID do projeto de design inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }
      const project = await storage.getDesignProject(projectId);
      if (!project || project.userId !== userId) {
        const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      const items: DesignProjectItem[] = await storage.getDesignProjectItems(projectId);
      return res.status(200).json({ ...project, items: items ?? [] });
    } catch (error) {
      console.error(`[Route /api/ai-design-projects/:id GET ${req.params.projectId}] Erro:`, error);
      return next(error);
    }
  });

  app.post(
    "/api/ai-design-projects/:projectId/upload-render",
    requireAuth,
    renderUploadInMemory.single("renderFile"), 
    handleMulterError, 
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.session.userId!;
        const projectId = parseInt(req.params.projectId);
        if (isNaN(projectId)) {
          const err: HttpError = new Error("ID do projeto inválido.");
          err.status = 400; err.isOperational = true; return next(err);
        }
        if (!req.file || !req.file.buffer) {
          const err: HttpError = new Error("Nenhum arquivo de render enviado.");
          err.status = 400; err.isOperational = true; return next(err);
        }
        const project = await storage.getDesignProject(projectId);
        if (!project || project.userId !== userId) {
           const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
           err.status = 404; err.isOperational = true; return next(err);
        }
        const buffer = req.file.buffer;
        const filename = req.file.originalname; 
        const category = 'design-projects'; 
        const subId = projectId.toString(); 
        const renderImageUrl = await uploadBufferToS3(buffer, filename, userId, category, subId);
        await storage.updateDesignProject(projectId, { clientRenderImageUrl: renderImageUrl, status: 'render_uploaded', updatedAt: new Date() });
        
        processDesignProjectImage(projectId, renderImageUrl).catch(err => {
          console.error(`ERRO ASYNC no processamento de imagem do projeto de design ${projectId}:`, err);
          storage.updateDesignProject(projectId, { status: 'processing_failed', updatedAt: new Date() })
            .catch(updateErr => console.error("Erro ao atualizar status para falha (design project):", updateErr));
        });
        return res.status(202).json({
          message: "Imagem recebida. O processamento da IA foi iniciado.",
          projectId: projectId,
          imageUrl: renderImageUrl 
        });
      } catch (error) { 
        console.error(`[Route /api/ai-design-projects/:id/upload-render POST ${req.params.projectId}] Erro:`, error);
        return next(error);
      }
    }
  );

  app.put("/api/ai-design-projects/:projectId/items/:itemId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
     try {
        const userId = req.session.userId!;
      const projectId = parseInt(req.params.projectId);
      const itemId = parseInt(req.params.itemId);

      if (isNaN(projectId) || isNaN(itemId)) {
        const err: HttpError = new Error("ID do projeto ou do item inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      const project = await storage.getDesignProject(projectId);
      if (!project || project.userId !== userId) {
        const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }

      const items = await storage.getDesignProjectItems(projectId);
      const existingItem = items.find(item => item.id === itemId);

      if (!existingItem) {
        const err: HttpError = new Error("Item do projeto não encontrado.");
        err.status = 404; err.isOperational = true; return next(err);
      }
      
      const { originalObjectId, detectedObjectName, suggestedProductId, userFeedback, notes } = req.body;
      
      const updateData: Partial<DesignProjectItem> = {};
      // if (originalObjectId !== undefined) updateData.originalObjectId = originalObjectId; // Comentado - Verificar schema
      // if (detectedObjectName !== undefined) updateData.detectedObjectName = detectedObjectName; // Comentado - Verificar schema
      if (suggestedProductId !== undefined) updateData.suggestedProductId1 = suggestedProductId === null ? null : Number(suggestedProductId); // CORRIGIDO para suggestedProductId1
      if (userFeedback !== undefined) updateData.userFeedback = userFeedback; 
      // if (notes !== undefined) updateData.notes = notes; // Comentado - Verificar schema
      updateData.updatedAt = new Date();

      if (Object.keys(updateData).length === 1 && updateData.updatedAt) { // Apenas updatedAt
          const err: HttpError = new Error("Nenhum dado válido para atualizar o item do projeto.");
          err.status = 400; err.isOperational = true; return next(err);
      }

      // const updatedItem = await storage.updateDesignProjectItem(itemId, updateData); // Supondo que esta função existe

      // return res.status(200).json(updatedItem); // Supondo que esta linha deve ser executada
      // Retornar uma resposta de sucesso genérica ou o item existente (sem a atualização aplicada no DB ainda)
      // Isso é para fazer o código compilar. A lógica de storage.updateDesignProjectItem precisa ser implementada.
      return res.status(200).json({ message: "Atualização do item recebida (lógica de DB pendente)", itemBeforeUpdate: existingItem }); 

    } catch (error) {
      console.error(`[Route /api/ai-design-projects/:pid/items/:iid PUT] Erro:`, error);
      return next(error);
    }
  });

  // NOVA ROTA: GET para buscar mensagens de um projeto de design
  app.get("/api/ai-design-projects/:projectId/messages", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const projectId = parseInt(req.params.projectId);

      if (isNaN(projectId)) {
        const err: HttpError = new Error("ID do projeto inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      // Verificar se o projeto pertence ao usuário (opcional, mas bom para segurança)
      const project = await storage.getDesignProject(projectId);
      if (!project || project.userId !== userId) {
        const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }

      const messages = await storage.getAiDesignChatMessages(projectId);
      return res.status(200).json(messages);

    } catch (error) {
      console.error(`[Route /api/ai-design-projects/:id/messages GET] Erro:`, error);
      return next(error);
    }
  });

  // NOVA ROTA: POST para criar uma nova mensagem em um projeto de design
  app.post("/api/ai-design-projects/:projectId/messages", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const projectId = parseInt(req.params.projectId);
      const { role, content, attachmentUrl } = req.body;

      if (isNaN(projectId)) {
        const err: HttpError = new Error("ID do projeto inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      if (!role || !content) {
        const err: HttpError = new Error("Role e content são obrigatórios para a mensagem.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      // Verificar se o projeto pertence ao usuário (opcional, mas bom para segurança)
      const project = await storage.getDesignProject(projectId);
      if (!project || project.userId !== userId) {
        const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }

      const messageData: InsertAiDesignChatMessage = {
        projectId,
        role, // 'user' ou 'assistant'
        content,
        attachmentUrl: attachmentUrl || null, // attachmentUrl é opcional
      };

      const newMessage = await storage.createAiDesignChatMessage(messageData);

      // Se a mensagem criada tiver um anexo, disparar o processamento da imagem
      if (newMessage.attachmentUrl && newMessage.content) { // Passar também o conteúdo da mensagem
        console.log(`[Chat Message] Mensagem ${newMessage.id} com anexo ${newMessage.attachmentUrl}. Disparando processamento de imagem...`);
        processDesignProjectImage(projectId, newMessage.attachmentUrl, newMessage.content).catch(err => {
          console.error(`[Chat Message] ERRO ASYNC no processamento de imagem para anexo da mensagem ${newMessage.id} (projeto ${projectId}):`, err);
          // Opcional: Enviar outra mensagem no chat informando sobre a falha no processamento do anexo?
        });
      } else if (newMessage.attachmentUrl) {
        // Caso haja anexo mas não conteúdo (improvável para mensagens de usuário, mas para cobrir)
        console.log(`[Chat Message] Mensagem ${newMessage.id} com anexo ${newMessage.attachmentUrl} mas sem conteúdo de texto. Disparando processamento de imagem...`);
        processDesignProjectImage(projectId, newMessage.attachmentUrl).catch(err => {
          console.error(`[Chat Message] ERRO ASYNC no processamento de imagem (sem texto) para anexo da mensagem ${newMessage.id} (projeto ${projectId}):`, err);
        });
      }

      return res.status(201).json(newMessage);

    } catch (error) {
      console.error(`[Route /api/ai-design-projects/:id/messages POST] Erro:`, error);
      return next(error);
    }
  });

  // NOVA ROTA: POST para fazer upload de anexos para mensagens de chat de um projeto de design
  app.post("/api/ai-design-projects/:projectId/attachments", 
    requireAuth, 
    renderUploadInMemory.single("file"), // Usar o mesmo nome de campo que o FormData no frontend usa ('file')
    handleMulterError, // Reutilizar o handler de erro do Multer
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session.userId!;
      const projectId = parseInt(req.params.projectId);

      if (isNaN(projectId)) {
        const err: HttpError = new Error("ID do projeto inválido.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      if (!req.file || !req.file.buffer) {
        const err: HttpError = new Error("Nenhum arquivo enviado para anexo.");
        err.status = 400; err.isOperational = true; return next(err);
      }

      const project = await storage.getDesignProject(projectId);
      if (!project || project.userId !== userId) {
        const err: HttpError = new Error("Projeto de design não encontrado ou acesso não autorizado.");
        err.status = 404; err.isOperational = true; return next(err);
      }

      const buffer = req.file.buffer;
      const originalFilename = req.file.originalname;
      const category = 'design-project-attachments'; 
      const subId = projectId.toString(); 

      const attachmentS3Url = await uploadBufferToS3(buffer, originalFilename, userId, category, subId);
      
      console.log(`[Route /api/ai-design-projects/:id/attachments POST] Anexo ${originalFilename} enviado para ${attachmentS3Url}`);

      return res.status(200).json({ url: attachmentS3Url });

    } catch (error) {
      console.error(`[Route /api/ai-design-projects/:id/attachments POST] Erro ao fazer upload do anexo:`, error);
      return next(error);
    }
  });

  app.post("/backend/upload-logo", requireAuth, logoUploadInMemory.single("logoFile"), handleMulterError, async (req: Request, res: Response, next: NextFunction) => {
     try {
        const userId = req.session.userId!;
        if (!req.file || !req.file.buffer) {
          const err: HttpError = new Error("Nenhum arquivo de logo enviado ou buffer vazio.");
          err.status = 400; err.isOperational = true; return next(err);
        }
        const buffer = req.file.buffer;
        const filename = req.file.originalname;
        const category = 'logos'; 
        const logoUrl = await uploadBufferToS3(buffer, filename, userId, category, null);
        
        await storage.updateUser(userId, { companyLogoUrl: logoUrl });

        return res.status(200).json({ logoUrl: logoUrl });
     } catch (error) {
        console.error("[Route /upload-logo POST] Erro:", error);
        return next(error);
     }
  });
  
  console.log("Rotas da API configuradas no app.");

  app.use(globalErrorHandler);
}