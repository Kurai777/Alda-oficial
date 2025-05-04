import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { type InsertUser } from '@shared/schema';
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
import { generateQuotePdf } from './pdf-generator';

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

  // ========================================
  // NOVAS ROTAS DE AUTENTICAÇÃO (SESSÃO + BCRYPT)
  // ========================================

  // Registro de Usuário
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, senha e nome são obrigatórios" });
      }

      // Verificar se o usuário já existe
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email já cadastrado" }); // Usar 409 Conflict
      }

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
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }

      // Buscar usuário pelo email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        console.log(`Tentativa de login falhou: Email ${email} não encontrado.`);
        return res.status(401).json({ message: "Credenciais inválidas" }); // Não especificar se é email ou senha
      }

      // Verificar senha
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
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
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
  app.put("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const receivedData = req.body;

      if (!receivedData || typeof receivedData !== 'object') {
        return res.status(400).json({ message: "Dados inválidos." });
      }

      // Mapear de camelCase (frontend) para snake_case (DB/schema)
      const updateDataForDb: Partial<InsertUser & { company_logo_url?: string | null, company_address?: string | null, company_phone?: string | null, company_cnpj?: string | null, quote_payment_terms?: string | null, quote_validity_days?: number | null }> = {};

      if (receivedData.name !== undefined) updateDataForDb.name = receivedData.name;
      if (receivedData.companyName !== undefined) updateDataForDb.companyName = receivedData.companyName;
      if (receivedData.companyAddress !== undefined) updateDataForDb.company_address = receivedData.companyAddress;
      if (receivedData.companyPhone !== undefined) updateDataForDb.company_phone = receivedData.companyPhone;
      if (receivedData.companyCnpj !== undefined) updateDataForDb.company_cnpj = receivedData.companyCnpj;
      if (receivedData.companyLogoUrl !== undefined) updateDataForDb.company_logo_url = receivedData.companyLogoUrl; // Manter camelCase aqui se a coluna for camelCase, ou snake_case se for snake_case
      if (receivedData.quotePaymentTerms !== undefined) updateDataForDb.quote_payment_terms = receivedData.quotePaymentTerms;
      if (receivedData.quoteValidityDays !== undefined) updateDataForDb.quote_validity_days = receivedData.quoteValidityDays;
      
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

  // Logout de Usuário
  app.post("/api/auth/logout", (req: Request, res: Response) => {
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
  app.get("/api/products", requireAuth, async (req: Request, res: Response) => {
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

  app.get("/api/products/:id", requireAuth, async (req: Request, res: Response) => {
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

  app.post("/api/products", requireAuth, async (req: Request, res: Response) => {
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
  
  app.put("/api/products/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.delete("/api/products/:id", requireAuth, async (req: Request, res: Response) => {
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
  app.get("/api/catalogs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const catalogs = await storage.getCatalogs(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("Erro ao obter catálogos:", error);
      return res.status(500).json({ message: "Erro ao obter catálogos" });
    }
  });
  
  app.post("/api/catalogs", requireAuth, async (req: Request, res: Response) => {
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
  
  app.get("/api/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.put("/api/catalogs/:id/status", requireAuth, async (req: Request, res: Response) => {
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
  
  app.post("/api/catalogs/:id/remap-images", requireAuth, async (req: Request, res: Response) => {
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
  
  app.post("/api/catalogs/remap-all-images", requireAuth, async (req: Request, res: Response) => {
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
  
  app.delete("/api/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
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
  app.get("/api/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const quotes = await storage.getQuotes(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      console.error("Erro ao obter orçamentos:", error);
      return res.status(500).json({ message: "Erro ao obter orçamentos" });
    }
  });
  
  app.get("/api/quotes/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.post("/api/quotes", requireAuth, async (req: Request, res: Response) => {
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
  
  app.put("/api/quotes/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.delete("/api/quotes/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  // ROTA: Gerar PDF do Orçamento (voltando para pdf-lib básico)
  app.post("/api/quotes/generate-pdf", requireAuth, async (req: Request, res: Response) => {
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

      console.log("Gerando PDF para orçamento via pdf-lib...");
      // Chamar a função ANTIGA
      const pdfBytes = await generateQuotePdf(quoteData, user);

      const fileName = `Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); 

      // Enviar o buffer do PDF (converter Uint8Array para Buffer)
      res.send(Buffer.from(pdfBytes));

    } catch (error) {
      console.error("Erro ao gerar PDF do orçamento:", error);
      return res.status(500).json({ message: "Erro interno ao gerar PDF do orçamento." });
    }
  });
  
  // NOVA ROTA: Gerar PDF do Orçamento usando Puppeteer (template HTML avançado)
  app.post("/api/quotes/generate-pdf-puppeteer", requireAuth, async (req: Request, res: Response) => {
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

      console.log("Gerando PDF para orçamento via Puppeteer...");
      try {
        // Chamar a função que usa Puppeteer
        const pdfBuffer = await generateQuotePdfWithPuppeteer(quoteData, user);

        const fileName = `Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}_premium.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); 

        // Enviar o buffer do PDF
        res.send(pdfBuffer);
      } catch (puppeteerError) {
        console.error("Erro na geração com Puppeteer, tentando método alternativo:", puppeteerError);
        
        // Fallback para o método antigo se Puppeteer falhar
        console.log("Caindo para método alternativo pdf-lib...");
        const pdfBytes = await generateQuotePdf(quoteData, user);
        
        const fileName = `Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`); 
        
        res.send(Buffer.from(pdfBytes));
      }
    } catch (error) {
      console.error("Erro ao gerar PDF do orçamento:", error);
      return res.status(500).json({ message: "Erro interno ao gerar PDF do orçamento." });
    }
  });
  
  // Rotas de moodboards (Aplicar requireAuth)
  app.get("/api/moodboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const moodboards = await storage.getMoodboards(userId);
      return res.status(200).json(moodboards);
    } catch (error) {
      console.error("Erro ao obter moodboards:", error);
      return res.status(500).json({ message: "Erro ao obter moodboards" });
    }
  });
  
  app.get("/api/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const moodboard = await storage.getMoodboard(id);
      
      if (!moodboard) {
        return res.status(404).json({ message: "Moodboard não encontrado" });
      }
      
      // Verificar permissão
      if (moodboard.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      
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
  
  app.post("/api/moodboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
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
  
  app.put("/api/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
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
  
  app.delete("/api/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "ID inválido" });
      }
      
      const moodboard = await storage.getMoodboard(id);
      if (!moodboard || moodboard.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      
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
  
  // Rota para upload e processamento de catálogos (Aplicar requireAuth)
  app.post("/api/catalogs/upload", requireAuth, upload.single("file"), handleMulterError, async (req: Request, res: Response) => {
    console.log("=== INÍCIO TRY BLOCK DA ROTA UPLOAD ===");
    try {
      // REMOVER VERIFICAÇÃO FIREBASE - requireAuth já fez a verificação da sessão
      // if (!req.firebaseUser || !req.firebaseUser.uid) { ... }
      const userId = req.session.userId!; // Obter userId da SESSÃO

      // Obter usuário local (do nosso DB) para consistência
      const localUser = await storage.getUser(userId);
      if (!localUser) {
         // Isso seria um erro interno grave se requireAuth passou
         console.error(`Usuário da sessão ${userId} não encontrado no DB local durante upload!`);
         return res.status(500).json({ message: "Erro interno: dados do usuário inconsistentes." });
      }
      const localUserId = localUser.id;
      const userEmail = localUser.email; // Usar email do usuário local

      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      const { originalname, mimetype, size, bucket, key, location, etag } = req.file as any; // Usar 'as any' por enquanto devido à complexidade dos tipos de Multer S3

      console.log("File object:", JSON.stringify(req.file, null, 2));

      // Salvar metadados do catálogo no banco de dados
      const catalogData = {
        userId: localUserId, // Usar ID do usuário local
        fileName: originalname,
        fileUrl: location, // ADICIONAR fileUrl usando a location do S3
        fileType: originalname.split('.').pop()?.toLowerCase() || '',
        fileSize: size,
        s3Bucket: bucket,
        s3Key: key,
        s3Url: location,
        s3Etag: etag,
        processedStatus: 'queued' as 'queued',
        // REMOVER firebaseUserId
      };

      // Passar catalogData corrigido
      const catalog = await storage.createCatalog(catalogData);
      console.log(`Catálogo ${catalog.id} criado no banco com status 'queued'.`);

      // Adicionar ID do catálogo ao Firestore (se necessário)
      const firestoreId = catalog.id;
      console.log(`ID do catálogo no Firestore: ${firestoreId}`);

      // Agora, disparar o processamento em background
      // Primeiro, precisamos baixar o arquivo do S3 para um local temporário
      const tempDir = path.join(process.cwd(), 'uploads', 'temp');
      if (!fs.existsSync(tempDir)){
          fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, `${Date.now()}-${originalname}`);

      console.log("Arquivo está no S3, baixando para processamento local...");
      const { downloadFileFromS3 } = await import('./s3-service.js'); // Importar função de download

      // CORREÇÃO: Chamar download, pegar buffer e escrever no arquivo temporário
      try {
          const fileBuffer = await downloadFileFromS3(key);
          fs.writeFileSync(tempFilePath, fileBuffer);
          console.log(`Arquivo baixado do S3 e salvo em: ${tempFilePath}`);
      } catch (downloadError) {
          console.error(`Erro ao baixar ou salvar arquivo temporário ${key}:`, downloadError);
          // Atualizar status para falho se o download falhar
          await storage.updateCatalogStatus(catalog.id, 'failed');
          // Retornar erro 500
          return res.status(500).json({
            message: `Erro ao baixar arquivo do S3: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`
          });
      }
      // Fim da Correção

      // Preparar dados para o job
      const jobData = {
        catalogId: catalog.id,
        userId: localUserId, // Passar ID local para o job
        s3Key: key,
        processingFilePath: tempFilePath, // Caminho local temporário
        fileName: originalname,
        fileType: catalogData.fileType,
      };

      console.log(`Disparando processamento em background para catálogo ${catalog.id}...`);
      // ASSUMIR que processCatalogInBackground existe e foi importado
      await processCatalogInBackground(jobData); // Chamar processamento em background (NÃO await se for realmente background)

      return res.status(201).json({
        message: `Catálogo "${originalname}" enviado com sucesso e está na fila para processamento.`,
        catalogId: catalog.id,
        s3Url: location
      });
    } catch (error) {
      console.error("Erro GERAL na rota de upload:", error);
      // Tentar limpar arquivo temporário em caso de erro geral
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkErr) { /* Ignorar erro no unlink */ }
      }
      return res.status(500).json({
        message: `Erro interno ao processar upload: ${error instanceof Error ? error.message : String(error)}`
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

  // --- NOVA ROTA: Upload de Logo da Empresa ---
  app.post("/api/upload-logo", requireAuth, logoUploadInMemory.single("logoFile"), handleMulterError, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;

      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo de logo enviado." });
      }

      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype;

      console.log(`Recebido upload de logo: ${originalName}, tamanho: ${fileBuffer.length} bytes`);

      // Fazer upload do buffer para S3
      const logoUrl = await uploadBufferToS3(fileBuffer, originalName, userId, 'profile', 'logo');

      if (!logoUrl) {
           throw new Error("Falha ao fazer upload do logo para S3.");
      }

      console.log(`Logo salvo no S3 com URL: ${logoUrl}`);
      console.log("Preparando para enviar resposta JSON com sucesso...");
      
      // REVERTER PARA RESPOSTA ORIGINAL
      return res.status(200).json({ logoUrl: logoUrl }); 
      /* // Teste anterior comentado
      return res.status(200).json({ success: true, tempUrl: logoUrl }); 
      */

    } catch (error) {
      console.error("Erro no upload do logo:", error);
      const message = error instanceof Error ? error.message : "Erro interno no servidor durante upload do logo.";
      // GARANTIR RESPOSTA JSON NO ERRO
      if (!res.headersSent) { // Verificar se headers já não foram enviados
         res.status(500).json({ message });
      } else {
         console.error("Headers já enviados, não é possível enviar erro JSON.");
         // Apenas encerrar a resposta se possível
         res.end();
      }
    }
  });
  // --- FIM ROTA UPLOAD LOGO ---

  return httpServer;
}