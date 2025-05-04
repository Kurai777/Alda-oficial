import type { Express, Request, Response, NextFunction } from "express";
import { Router } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { type InsertUser } from '@shared/schema';
import multer from "multer";
import * as fs from "fs";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { DecodedIdToken } from "firebase-admin/auth";
import mime from "mime-types";
import { createCanvas } from "canvas";
import { deleteDataFromFirestore } from "./test-upload.js";
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
import { processExcelWithAI } from './ai-excel-processor.js';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import firebaseAppClient from '../client/src/lib/firebase';
import { fixProductImages } from './excel-fixed-image-mapper';
import { extractAndUploadImagesSequentially, type ExtractedImageInfo } from './excel-image-extractor';
import { Catalog as SharedCatalog } from "@shared/schema";
import { spawn } from 'child_process';
import { runPythonColumnExtractor } from './excel-image-extractor';
import { processCatalogInBackground } from './catalog-processor';
import bcrypt from 'bcrypt';
import { generateQuotePdf, generateQuotePdfWithPuppeteer } from './pdf-generator';
import { User } from '@shared/schema';
import OpenAI from 'openai';

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

const SALT_ROUNDS = 10;

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

// Middleware Multer específico para upload de logo (em memória para processar e enviar ao S3)
const logoUploadInMemory = multer({ 
  storage: multer.memoryStorage(), // Salvar em memória
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB para logo
  fileFilter: (req, file, cb) => {
    // Aceitar apenas imagens comuns
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo inválido para logo. Use PNG, JPG, WEBP.'));
    }
  }
});

// Multer para busca visual (memória)
const visualSearchUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite 10MB para imagem de busca
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas para busca visual.'));
    }
  }
});

// Configurar cliente OpenAI (assumindo variável de ambiente)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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

// Função de tratamento de erro específica do Multer
function handleMulterError(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    // Erros conhecidos do Multer (ex: limite de tamanho)
    console.error("!!!! ERRO DO MULTER DETECTADO !!!!", err);
    return res.status(400).json({ message: `Erro de Upload (Multer): ${err.message}`, code: err.code });
  } else if (err) {
    // Outros erros durante o upload (ex: erro S3)
    console.error("!!!! ERRO DESCONHECIDO DURANTE UPLOAD (antes da rota) !!!!", err);
    return res.status(500).json({ message: `Erro inesperado durante upload: ${err.message}` });
  }
  // Se não houve erro no multer, passar para o próximo middleware/rota
  next();
}

// Middleware simples para verificar autenticação via sessão
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: "Autenticação necessária." });
  }
  next();
};

export async function registerRoutes(app: Express): Promise<void> {
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
  app.get("/backend/healthcheck", (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  // ========================================
  // NOVAS ROTAS DE AUTENTICAÇÃO (SESSÃO + BCRYPT)
  // ========================================

  // Registro de Usuário (rota original)
  app.post("/backend/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, senha e nome são obrigatórios" });
      }

      // --- COMENTAR TEMPORARIAMENTE A VERIFICAÇÃO DE EMAIL --- 
      /*
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email já cadastrado" }); 
      }
      */
      // --- FIM DO COMENTÁRIO ---

      // Hash da senha
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Criar usuário no banco de dados
      const user = await storage.createUser({
        email,
        password: hashedPassword, // Salvar senha com hash
        name,
        companyName: companyName || "Empresa Padrão",
        // Remover firebaseId
      });

      // Iniciar sessão automaticamente após registro
      req.session.userId = user.id;
      console.log(`Usuário ${user.id} registrado e sessão iniciada.`);

      return res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
        // Remover firebaseId
      });
    } catch (error) {
      console.error("Erro ao registrar usuário:", error);
      return res.status(500).json({ message: "Erro interno ao registrar usuário" });
    }
  });

  // Login de Usuário
  app.post("/backend/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }

      // Buscar usuário pelo email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        console.log(`Tentativa de login falhou: Email ${email} não encontrado.`);
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      // RESTAURAR COMPARAÇÃO BCRYPT ORIGINAL
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        console.log(`Tentativa de login falhou: Senha incorreta para ${email}.`);
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      
      // Iniciar sessão
      req.session.userId = user.id;
      console.log(`Usuário ${user.id} logado e sessão iniciada.`);

      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
        // Remover firebaseId
      });
    } catch (error) {
      console.error("Erro ao fazer login:", error);
      return res.status(500).json({ message: "Erro interno durante o login" });
    }
  });

  // Obter Usuário Logado (Verificar Sessão)
  app.get("/backend/auth/me", requireAuth, async (req: Request, res: Response) => {
    // O middleware requireAuth já garante que req.session.userId existe
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        // Isso não deveria acontecer se a sessão é válida, mas checar por segurança
        console.error(`Sessão válida (userId: ${req.session.userId}) mas usuário não encontrado no DB.`);
        req.session.destroy(() => {}); // Destruir sessão inválida
        return res.status(401).json({ message: "Usuário da sessão não encontrado." });
      }

      console.log(`Usuário ${user.id} autenticado via sessão.`);
      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
        // Remover firebaseId
      });
    } catch (error) {
      console.error("Erro ao obter usuário (/api/auth/me):", error);
      return res.status(500).json({ message: "Erro ao obter dados do usuário" });
    }
  });

  // --- ADICIONAR/MODIFICAR ROTA PUT /api/auth/me ---
  app.put("/backend/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const receivedData = req.body;

      if (!receivedData || typeof receivedData !== 'object') {
        return res.status(400).json({ message: "Dados inválidos." });
      }

      // Mapear de camelCase (frontend) para snake_case (DB/schema)
      const updateDataForDb: Partial<InsertUser & { company_logo_url?: string | null, company_address?: string | null, company_phone?: string | null, company_cnpj?: string | null, quote_payment_terms?: string | null, quote_validity_days?: number | null, cash_discount_percentage?: number | null }> = {};

      if (receivedData.name !== undefined) updateDataForDb.name = receivedData.name;
      if (receivedData.companyName !== undefined) updateDataForDb.companyName = receivedData.companyName;
      if (receivedData.companyAddress !== undefined) updateDataForDb.company_address = receivedData.companyAddress;
      if (receivedData.companyPhone !== undefined) updateDataForDb.company_phone = receivedData.companyPhone;
      if (receivedData.companyCnpj !== undefined) updateDataForDb.company_cnpj = receivedData.companyCnpj;
      if (receivedData.companyLogoUrl !== undefined) updateDataForDb.company_logo_url = receivedData.companyLogoUrl;
      if (receivedData.quotePaymentTerms !== undefined) updateDataForDb.quote_payment_terms = receivedData.quotePaymentTerms;
      if (receivedData.quoteValidityDays !== undefined) updateDataForDb.quote_validity_days = receivedData.quoteValidityDays;
      if (receivedData.cashDiscountPercentage !== undefined) updateDataForDb.cash_discount_percentage = receivedData.cashDiscountPercentage;
      
      // Não permitir atualização de email/senha aqui
      delete updateDataForDb.email;
      delete updateDataForDb.password;
      
      // Adicionar verificação se o objeto mapeado não está vazio
      if (Object.keys(updateDataForDb).length === 0) {
          return res.status(400).json({ message: "Nenhum dado válido para atualizar." });
      }

      console.log(`Atualizando perfil para userId: ${userId}`, updateDataForDb);

      // Chamar storage.updateUser com os dados mapeados (snake_case)
      // A função updateUser precisa aceitar esses campos
      const updatedUser = await storage.updateUser(userId, updateDataForDb);

      if (!updatedUser) {
        return res.status(404).json({ message: "Usuário não encontrado." });
      }

      console.log(`Perfil atualizado para userId: ${userId}`);
      // Retornar dados atualizados (sem senha)
      const { password, ...userToSend } = updatedUser;
      return res.status(200).json(userToSend);

    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      return res.status(500).json({ message: "Erro interno ao atualizar perfil." });
    }
  });
  // --- FIM DA ROTA PUT --- 

  // ===================================================
  // ADICIONAR ROTAS COMPATÍVEIS COM O CLIENTE (/api/...)
  // ===================================================

  // Registro de Usuário (rota compatível)
  app.post("/api/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, senha e nome são obrigatórios" });
      }

      // Hash da senha
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Criar usuário no banco de dados
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        companyName: companyName || "Empresa Padrão",
      });

      // Iniciar sessão automaticamente após registro
      req.session.userId = user.id;
      console.log(`Usuário ${user.id} registrado e sessão iniciada via /api/register.`);

      return res.status(201).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
      });
    } catch (error) {
      console.error("Erro ao registrar usuário via /api/register:", error);
      return res.status(500).json({ message: "Erro interno ao registrar usuário" });
    }
  });

  // Login de Usuário (rota compatível)
  app.post("/api/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }

      // Buscar usuário pelo email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        console.log(`Tentativa de login falhou: Email ${email} não encontrado.`);
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        console.log(`Tentativa de login falhou: Senha incorreta para ${email}.`);
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      
      // Iniciar sessão
      req.session.userId = user.id;
      console.log(`Usuário ${user.id} logado e sessão iniciada via /api/login.`);

      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
      });
    } catch (error) {
      console.error("Erro ao fazer login via /api/login:", error);
      return res.status(500).json({ message: "Erro interno durante o login" });
    }
  });

  // Obter Usuário Logado (rota compatível)
  app.get("/api/user", async (req: Request, res: Response) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ message: "Usuário não autenticado" });
    }
    
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        console.error(`Sessão válida (userId: ${req.session.userId}) mas usuário não encontrado no DB.`);
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Usuário da sessão não encontrado." });
      }

      console.log(`Usuário ${user.id} autenticado via sessão em /api/user.`);
      return res.status(200).json({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName
      });
    } catch (error) {
      console.error("Erro ao obter usuário (/api/user):", error);
      return res.status(500).json({ message: "Erro ao obter dados do usuário" });
    }
  });

  // Logout de Usuário (rota compatível)
  app.post("/api/logout", (req: Request, res: Response) => {
    if (req.session) {
      console.log(`Deslogando usuário ${req.session.userId} via /api/logout`);
      req.session.destroy((err) => {
        if (err) {
          console.error("Erro ao destruir sessão:", err);
          return res.status(500).json({ message: "Erro ao encerrar sessão" });
        }
        res.clearCookie('connect.sid');
        return res.status(200).json({ message: "Logout realizado com sucesso" });
      });
    } else {
      return res.status(200).json({ message: "Nenhuma sessão ativa para encerrar" });
    }
  });

  // Logout de Usuário (rota original)
  app.post("/backend/auth/logout", (req: Request, res: Response) => {
    if (req.session) {
      console.log(`Deslogando usuário ${req.session.userId}`);
      req.session.destroy((err) => {
        if (err) {
          console.error("Erro ao destruir sessão:", err);
          return res.status(500).json({ message: "Erro ao encerrar sessão" });
        }
        // Limpar o cookie no cliente também
        res.clearCookie('connect.sid'); // Use o nome padrão ou o nome configurado do seu cookie de sessão
        return res.status(200).json({ message: "Logout realizado com sucesso" });
      });
    } else {
      return res.status(200).json({ message: "Nenhuma sessão ativa para encerrar" });
    }
  });

  // ========================================
  // ROTAS PROTEGIDAS
  // ========================================

  // Rotas de produtos (Aplicar requireAuth)
  app.get("/backend/products", requireAuth, async (req: Request, res: Response) => {
    try {
      // Usar ID da sessão autenticada
      const userId = req.session.userId!;
      const catalogId = req.query.catalogId ? parseInt(req.query.catalogId as string) : undefined;

      const products = await storage.getProducts(userId, catalogId);
      
      // CORRIGIDO: Converter Datas para ISOString antes de enviar JSON
      const productsForJson = products.map(p => ({
        ...p,
        // Garante que createdAt é string segura para JSON
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      }));
      
      // Retornar array de produtos formatado
      return res.status(200).json(productsForJson);
    } catch (error) {
      console.error("Erro ao obter produtos:", error);
      return res.status(500).json({ message: "Erro ao obter produtos" });
    }
  });

  app.get("/backend/products/:id", requireAuth, async (req: Request, res: Response) => {
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

  app.post("/backend/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
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
  
  app.put("/backend/products/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const data = req.body;
      const product = await storage.updateProduct(id, {
        ...data,
        userId: req.session.userId!,
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
  
  app.delete("/backend/products/:id", requireAuth, async (req: Request, res: Response) => {
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

  // Rotas de catálogos (Aplicar requireAuth)
  app.get("/backend/catalogs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const catalogs = await storage.getCatalogs(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("Erro ao obter catálogos:", error);
      return res.status(500).json({ message: "Erro ao obter catálogos" });
    }
  });
  
  app.post("/backend/catalogs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      // Criar catálogo no banco de dados
      const catalog = await storage.createCatalog({
        ...req.body,
        userId,
        createdAt: new Date()
      });
      
      return res.status(201).json(catalog);
    } catch (error) {
      console.error("Erro ao criar catálogo:", error);
      return res.status(500).json({ message: "Erro ao criar catálogo" });
    }
  });
  
  app.get("/backend/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const catalog = await storage.getCatalog(id);
      
      if (!catalog) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      // Verificar permissão
      if (catalog.userId !== req.session.userId) {
        return res.status(403).json({ message: "Acesso negado" });
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
  
  app.put("/backend/catalogs/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      if (!status) {
        return res.status(400).json({ message: "Status é obrigatório" });
      }
      
      const catalog = await storage.getCatalog(id);
      if (!catalog || catalog.userId !== req.session.userId) {
        return res.status(403).json({ message: "Acesso negado ou catálogo não encontrado" });
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
  
  app.post("/backend/catalogs/:id/remap-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const catalogId = parseInt(req.params.id);
      const userId = req.session.userId!;
      
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
  
  app.post("/backend/catalogs/remap-all-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
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
  
  app.delete("/backend/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      console.log(`Iniciando exclusão do catálogo ${id}`);
      
      const catalog = await storage.getCatalog(id);
      
      if (!catalog) {
        console.log(`Catálogo ${id} não encontrado`);
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }
      
      console.log(`Catálogo ${id} encontrado, pertence ao usuário ${catalog.userId}`);
      
      if (catalog.userId !== req.session.userId) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      
      // Primeiro, excluir todos os produtos associados a este catálogo
      const deletedProductsCount = await storage.deleteProductsByCatalogId(id);
      console.log(`${deletedProductsCount} produtos excluídos do catálogo ${id}`);
      
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
  
  // Rotas de orçamentos (Aplicar requireAuth)
  app.get("/backend/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const quotes = await storage.getQuotes(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      console.error("Erro ao obter orçamentos:", error);
      return res.status(500).json({ message: "Erro ao obter orçamentos" });
    }
  });
  
  app.get("/backend/quotes/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.post("/backend/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
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
  
  app.put("/backend/quotes/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.delete("/backend/quotes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const quote = await storage.getQuote(id);
      if (!quote || quote.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      
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
  
  // <<< MOVER ROTAS DE PDF PARA FORA DA ROTA POST /quotes >>>
  // Rota PDF Principal (com fallback)
  app.post("/backend/quotes/generate-pdf-puppeteer", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ message: "Usuário não encontrado ou não autorizado." });
      }
      const quoteData = req.body;
      if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
        return res.status(400).json({ message: "Dados do orçamento inválidos ou incompletos." });
      }

      console.log("Tentando gerar PDF com Puppeteer...");
      try {
        const pdfBuffer = await generateQuotePdfWithPuppeteer(quoteData, user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_P.pdf"`);
        console.log("✅ PDF gerado com Puppeteer.");
        return res.send(pdfBuffer);
      } catch (puppeteerError) {
        console.error("⚠️ Falha no Puppeteer, tentando fallback pdf-lib:", puppeteerError);
        try {
          const pdfBytes = await generateQuotePdf(quoteData, user); // Fallback
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_Lib.pdf"`);
          console.log("✅ PDF gerado com pdf-lib (fallback).");
          return res.send(Buffer.from(pdfBytes));
        } catch (fallbackError) {
          console.error("❌ Falha no fallback pdf-lib:", fallbackError);
          return res.status(500).json({ message: "Erro interno ao gerar PDF (ambos métodos falharam)", error: String(fallbackError) });
        }
      }
    } catch (error) {
      console.error("Erro geral na rota /generate-pdf-puppeteer:", error);
      return res.status(500).json({ message: "Erro interno no servidor" });
    }
  });

  // Rota PDF (pdf-lib direto)
  app.post("/backend/quotes/generate-pdf", requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId!;
        const user = await storage.getUser(userId);
        if (!user) return res.status(403).json({ message: "Usuário não encontrado" });
        const quoteData = req.body;
        if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
           return res.status(400).json({ message: "Dados inválidos" });
        }
        console.log("Gerando PDF via pdf-lib (rota direta)...");
        const pdfBytes = await generateQuotePdf(quoteData, user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_Lib.pdf"`);
        console.log("✅ PDF gerado com pdf-lib (rota direta).");
        return res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error("Erro na rota /generate-pdf (pdf-lib):", error);
        return res.status(500).json({ message: "Erro ao gerar PDF com pdf-lib", error: String(error) });
    }
  });

  // Rota PDF (html-pdf - pode ser removida se não usada)
  /*
  app.post("/backend/quotes/generate-pdf-htmlpdf", requireAuth, async (req, res) => { 
      // ... (lógica html-pdf)
  });
  */

  // ========================================
  // ROTAS DE MOODBOARDS
  // ========================================
  app.get("/backend/moodboards", requireAuth, async (req: Request, res: Response) => { 
      // ... (lógica get moodboards)
  });
  // ... (outras rotas moodboards)

  // ========================================
  // OUTRAS ROTAS (/upload-logo, /images)
  // ========================================
  app.post("/backend/upload-logo", requireAuth, logoUploadInMemory.single("logoFile"), handleMulterError, async (req: Request, res: Response) => {
     // ...
  });
  app.get("/backend/images/:userId/:catalogId/:filename", (req: Request, res: Response) => {
    // ...
  });
  
  // ========================================
  // ROTA DE UPLOAD DE CATÁLOGO (compatibilidade com cliente)
  // ========================================
  app.post("/backend/catalogs/upload", upload.single('file'), async (req: Request, res: Response) => {
    try {
      console.log("Processando upload de catálogo via rota /backend/catalogs/upload...");
      
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }
      
      // Extrair informações do arquivo
      const file = req.file;
      const fileName = file.originalname;
      const fileType = fileName.split('.').pop()?.toLowerCase() || '';
      
      // Detectar se está usando S3 ou armazenamento local
      const isS3File = (file as any).location !== undefined || (file as any).key !== undefined;
      
      // Obter o caminho ou a URL do arquivo
      let fileUrl = '';
      let s3Key = null;
      
      if (isS3File) {
        // Para multer-s3, a URL está em location e a chave em key
        fileUrl = (file as any).location || '';
        s3Key = (file as any).key || '';
        console.log(`Arquivo S3 recebido: ${fileName} (${fileType}), URL S3: ${fileUrl}, Key: ${s3Key}`);
      } else {
        // Para armazenamento local, a caminho está em path
        fileUrl = file.path || '';
        console.log(`Arquivo local recebido: ${fileName} (${fileType}), caminho: ${fileUrl}`);
      }
      
      // Verificar quem está fazendo o upload (obter o ID do usuário)
      const userId = req.body.userId || req.session.userId || 1;
      console.log(`Upload realizado pelo usuário: ${userId}`);
      
      // Criar um novo catálogo no banco de dados
      const catalog = await storage.createCatalog({
        userId: typeof userId === 'string' ? parseInt(userId) : userId,
        name: req.body.name || fileName,
        description: req.body.description || `Catálogo importado de ${fileName}`,
        createdAt: new Date(),
        status: "processing",
        fileUrl: fileUrl, // Agora sempre terá um valor
        fileName: fileName,
        s3Key: s3Key
      });
      
      // ID do catálogo no banco relacional
      const catalogId = catalog.id;
      console.log(`Catálogo criado no banco de dados com ID: ${catalogId}`);
      
      // Retornar resposta de sucesso
      res.status(200).json({
        message: "Catálogo enviado com sucesso",
        catalogId,
        status: "processing"
      });
      
      // Disparar processamento em background (não bloquear a resposta)
      // Esta parte deve ser implementada de acordo com a lógica de processamento
      // específica do seu aplicativo
      
    } catch (error) {
      console.error("Erro ao processar upload de catálogo:", error);
      res.status(500).json({
        message: "Erro ao processar o arquivo",
        error: (error as Error).message
      });
    }
  });
  
  console.log("Rotas da API configuradas no app com prefixo /backend.");
}