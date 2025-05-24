import type { Express, Request, Response, NextFunction, Router as ExpressRouter } from "express";
import { storage } from "./storage.js";
import { type InsertUser } from '@shared/schema';
import multer from "multer";
import * as fs from "fs";
import path from "path";
import mime from "mime-types";
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
import { fixProductImages } from './excel-fixed-image-mapper.js';
import { extractAndUploadImagesSequentially, type ExtractedImageInfo } from './excel-image-extractor.js';
import { processCatalogInBackground } from './catalog-processor.js';
import bcrypt from 'bcrypt';
import { generateQuotePdf } from './pdf-generator.js';
import { User } from '@shared/schema';
import OpenAI from 'openai';
import { triggerInpaintingForItem, processDesignProjectImage, generateFinalRenderForProject } from './ai-design-processor.js';

type MoodboardCreateInput = {
  userId: number;
  projectName: string;
  productIds: number[];
  fileUrl?: string;
  clientName?: string;
  architectName?: string;
  quoteId?: number;
};

const SALT_ROUNDS = 10;

const logoUploadInMemory = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo inválido para logo. Use PNG, JPG, WEBP.'));
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
      cb(new Error('Apenas imagens são permitidas para busca visual.'));
    }
  }
});

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function handleMulterError(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    console.error("!!!! ERRO DO MULTER DETECTADO !!!!", err);
    return res.status(400).json({ message: `Erro de Upload (Multer): ${err.message}`, code: err.code });
  } else if (err) {
    console.error("!!!! ERRO DESCONHECIDO DURANTE UPLOAD (antes da rota) !!!!", err);
    return res.status(500).json({ message: `Erro inesperado durante upload: ${err.message}` });
  }
  next();
}

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: "Autenticação necessária." });
  }
  next();
};

export async function registerRoutes(router: ExpressRouter, upload: multer.Multer): Promise<void> {
  router.get("/healthcheck", (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  router.post("/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, senha e nome são obrigatórios" });
      }
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email já cadastrado" });
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        companyName: companyName || "Empresa Padrão",
      });
      req.session.userId = user.id;
      return res.status(201).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName });
    } catch (error) {
      console.error("Erro ao registrar usuário:", error);
      return res.status(500).json({ message: "Erro interno ao registrar usuário" });
    }
  });

  router.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha são obrigatórios" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      req.session.userId = user.id;
      return res.status(200).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName });
    } catch (error) {
      console.error("Erro ao fazer login:", error);
      return res.status(500).json({ message: "Erro interno durante o login" });
    }
  });

  router.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Usuário da sessão não encontrado." });
      }
      return res.status(200).json({ id: user.id, email: user.email, name: user.name, companyName: user.companyName, companyLogoUrl: user.companyLogoUrl, companyAddress: user.companyAddress, companyPhone: user.companyPhone, companyCnpj: user.companyCnpj, quotePaymentTerms: user.quotePaymentTerms, quoteValidityDays: user.quoteValidityDays, cashDiscountPercentage: user.cashDiscountPercentage });
    } catch (error) {
      console.error("Erro ao obter usuário (/auth/me):", error);
      return res.status(500).json({ message: "Erro ao obter dados do usuário" });
    }
  });

  router.put("/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const receivedData = req.body;
      if (!receivedData || typeof receivedData !== 'object') {
        return res.status(400).json({ message: "Dados inválidos." });
      }
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

      delete updateDataForDb.email;
      delete updateDataForDb.password;

      if (Object.keys(updateDataForDb).length === 0) {
          return res.status(400).json({ message: "Nenhum dado válido para atualizar." });
      }
      const updatedUser = await storage.updateUser(userId, updateDataForDb);
      if (!updatedUser) {
        return res.status(404).json({ message: "Usuário não encontrado." });
      }
      const { password, ...userToSend } = updatedUser;
      return res.status(200).json(userToSend);
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      return res.status(500).json({ message: "Erro interno ao atualizar perfil." });
    }
  });

  router.post("/auth/logout", (req: Request, res: Response) => {
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: "Erro ao encerrar sessão" });
        }
        res.clearCookie('connect.sid'); 
        return res.status(200).json({ message: "Logout realizado com sucesso" });
      });
    } else {
      return res.status(200).json({ message: "Nenhuma sessão ativa para encerrar" });
    }
  });

  // Rota para buscar detalhes de múltiplos produtos por IDs
  router.get("/products/batch", requireAuth, async (req: Request, res: Response) => {
    try {
      const idsString = req.query.ids as string;

      if (!idsString) {
        return res.status(400).json({ message: "Nenhum ID de produto fornecido." });
      }

      const productIds = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

      if (productIds.length === 0) {
        return res.status(400).json({ message: "IDs de produto inválidos ou vazios." });
      }

      const productsDetailsMap = await storage.getProductsDetails(productIds);
      return res.status(200).json(productsDetailsMap);

    } catch (error) {
      console.error("Erro ao buscar detalhes de produtos em batch:", error);
      const message = error instanceof Error ? error.message : "Erro interno ao buscar produtos.";
      return res.status(500).json({ message });
    }
  });

  router.get("/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const catalogId = req.query.catalogId ? parseInt(req.query.catalogId as string) : undefined;
      const products = await storage.getProducts(userId, catalogId);
      const productsForJson = products.map(p => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      }));
      return res.status(200).json(productsForJson);
    } catch (error) {
      console.error("Erro ao obter produtos:", error);
      return res.status(500).json({ message: "Erro ao obter produtos" });
    }
  });

  router.get("/products/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const product = await storage.getProduct(id);
      if (!product) return res.status(404).json({ message: "Produto não encontrado" });
      return res.status(200).json(product);
    } catch (error) {
      console.error("Erro ao obter produto:", error);
      return res.status(500).json({ message: "Erro ao obter produto" });
    }
  });

  router.post("/products", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const product = await storage.createProduct({ ...req.body, userId, createdAt: new Date(), updatedAt: new Date() });
      return res.status(201).json(product);
    } catch (error) {
      console.error("Erro ao criar produto:", error);
      return res.status(500).json({ message: "Erro ao criar produto" });
    }
  });

  router.put("/products/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const data = req.body;
      const product = await storage.updateProduct(id, { ...data, userId: req.session.userId!, updatedAt: new Date(), isEdited: true });
      if (!product) return res.status(404).json({ message: "Produto não encontrado" });
      return res.status(200).json(product);
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      return res.status(500).json({ message: "Erro ao atualizar produto" });
    }
  });

  router.delete("/products/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const success = await storage.deleteProduct(id);
      if (!success) return res.status(404).json({ message: "Produto não encontrado" });
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      return res.status(500).json({ message: "Erro ao excluir produto" });
    }
  });

  router.get("/catalogs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const catalogs = await storage.getCatalogs(userId);
      return res.status(200).json(catalogs);
    } catch (error) {
      console.error("Erro ao obter catálogos:", error);
      return res.status(500).json({ message: "Erro ao obter catálogos" });
    }
  });

  router.post("/catalogs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const catalog = await storage.createCatalog({ ...req.body, userId, createdAt: new Date() });
      return res.status(201).json(catalog);
    } catch (error) {
      console.error("Erro ao criar catálogo:", error);
      return res.status(500).json({ message: "Erro ao criar catálogo" });
    }
  });

  router.get("/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const catalog = await storage.getCatalog(id);
      if (!catalog) return res.status(404).json({ message: "Catálogo não encontrado" });
      if (catalog.userId !== req.session.userId) return res.status(403).json({ message: "Acesso negado" });
      const products = await storage.getProducts(catalog.userId, id);
      return res.status(200).json({ ...catalog, products });
    } catch (error) {
      console.error("Erro ao obter catálogo:", error);
      return res.status(500).json({ message: "Erro ao obter catálogo" });
    }
  });

  router.put("/catalogs/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      if (!status) return res.status(400).json({ message: "Status é obrigatório" });
      const catalog = await storage.getCatalog(id);
      if (!catalog || catalog.userId !== req.session.userId) {
        return res.status(403).json({ message: "Acesso negado ou catálogo não encontrado" });
      }
      const success = await storage.updateCatalogStatus(id, status);
      if (!success) return res.status(404).json({ message: "Catálogo não encontrado" });
      return res.status(200).json({ message: "Status atualizado com sucesso" });
    } catch (error) {
      console.error("Erro ao atualizar status do catálogo:", error);
      return res.status(500).json({ message: "Erro ao atualizar status do catálogo" });
    }
  });

  router.post("/catalogs/:id/remap-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const catalogId = parseInt(req.params.id);
      const userId = req.session.userId!;
      if (isNaN(catalogId)) return res.status(400).json({ message: "ID inválido" });
      const catalog = await storage.getCatalog(catalogId);
      if (!catalog || catalog.userId !== userId) {
          return res.status(404).json({ message: "Catálogo não encontrado ou não pertence ao usuário" });
      }
      const result = await fixProductImages(userId, catalogId);
      if (result.success) {
        return res.status(200).json({ message: result.message, updatedCount: result.updated });
      } else {
          return res.status(500).json({ message: "Erro ao corrigir imagens", error: result.message });
      }
    } catch (error) {
      console.error("Erro na rota /remap-images:", error);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return res.status(500).json({ message: "Erro interno no servidor", error: message });
    }
  });

  router.post("/catalogs/remap-all-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const catalogs = await storage.getCatalogs(userId);
      if (!catalogs || catalogs.length === 0) {
        return res.status(404).json({ message: "Nenhum catálogo encontrado" });
      }
      const results = [];
      let totalUpdated = 0;
        for (const catalog of catalogs) {
          try {
            const result = await fixProductImages(userId, catalog.id);
            results.push({
              catalogId: catalog.id, catalogName: catalog.fileName, status: result.success ? "completed" : "error",
              updatedCount: result.updated, message: result.message
            });
            if(result.success) totalUpdated += result.updated;
          } catch (catalogError) {
             const message = catalogError instanceof Error ? catalogError.message : String(catalogError);
            results.push({
              catalogId: catalog.id, catalogName: catalog.fileName, status: "error", updatedCount: 0, message: message
            });
          }
        }
        return res.status(200).json({
        message: `Remapeamento concluído. ${totalUpdated} produtos atualizados em ${catalogs.length} catálogos.`,
          totalUpdated, catalogsProcessed: results.filter(r => r.status === "completed").length, results
        });
    } catch (error) {
      console.error("Erro na rota /remap-all-images:", error);
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      return res.status(500).json({ message: "Erro interno no servidor", error: message });
    }
  });

  router.delete("/catalogs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const catalog = await storage.getCatalog(id);
      if (!catalog) return res.status(404).json({ message: "Catálogo não encontrado" });
      if (catalog.userId !== req.session.userId) return res.status(403).json({ message: "Acesso negado" });
      const deletedProductsCount = await storage.deleteProductsByCatalogId(id);
      const success = await storage.deleteCatalog(id);
      if (!success) return res.status(500).json({ message: "Erro ao excluir catálogo" });
      return res.status(200).json({ message: "Catálogo excluído com sucesso", productsDeleted: deletedProductsCount });
    } catch (error) {
      console.error("Erro ao excluir catálogo:", error);
      return res.status(500).json({ message: "Erro ao excluir catálogo", error: String(error) });
    }
  });

  router.get("/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const quotes = await storage.getQuotes(userId);
      return res.status(200).json(quotes);
    } catch (error) {
      console.error("Erro ao obter orçamentos:", error);
      return res.status(500).json({ message: "Erro ao obter orçamentos" });
    }
  });

  router.get("/quotes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const quote = await storage.getQuote(id);
      if (!quote) return res.status(404).json({ message: "Orçamento não encontrado" });
      if (quote.userId !== req.session.userId) return res.status(403).json({ message: "Acesso negado" });
      return res.status(200).json(quote);
    } catch (error) {
      console.error("Erro ao obter orçamento:", error);
      return res.status(500).json({ message: "Erro ao obter orçamento" });
    }
  });

  router.post("/quotes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const quote = await storage.createQuote({ ...req.body, userId, createdAt: new Date() });
      return res.status(201).json(quote);
    } catch (error) {
      console.error("Erro ao criar orçamento:", error);
      return res.status(500).json({ message: "Erro ao criar orçamento" });
    }
  });

  router.put("/quotes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const data = req.body;
      const quoteToUpdate = await storage.getQuote(id);
      if (!quoteToUpdate || quoteToUpdate.userId !== req.session.userId) return res.status(403).json({ message: "Acesso negado ou orçamento não encontrado"});
      const quote = await storage.updateQuote(id, data);
      if (!quote) return res.status(404).json({ message: "Orçamento não encontrado" });
      return res.status(200).json(quote);
    } catch (error) {
      return res.status(500).json({ message: "Erro ao atualizar orçamento" });
    }
  });

  router.delete("/quotes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const quote = await storage.getQuote(id);
      if (!quote || quote.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      const success = await storage.deleteQuote(id);
      if (!success) return res.status(404).json({ message: "Orçamento não encontrado" });
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir orçamento:", error);
      return res.status(500).json({ message: "Erro ao excluir orçamento" });
    }
  });

  router.post("/quotes/generate-pdf", requireAuth, async (req: Request, res: Response) => {
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
      const pdfBytes = await generateQuotePdf(quoteData, user);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}.pdf"`);
      res.send(pdfBytes);
    } catch (error) {
      console.error("Erro ao gerar PDF do orçamento:", error);
      const message = error instanceof Error ? error.message : "Erro interno ao gerar PDF";
      return res.status(500).json({ message });
    }
  });

  router.get("/moodboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const moodboards = await storage.getMoodboards(userId);
      return res.status(200).json(moodboards);
    } catch (error) {
      console.error("Erro ao obter moodboards:", error);
      return res.status(500).json({ message: "Erro ao obter moodboards" });
    }
  });

  router.get("/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const moodboard = await storage.getMoodboard(id);
      if (!moodboard) return res.status(404).json({ message: "Moodboard não encontrado" });
      if (moodboard.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      const products = [];
      for (const productId of moodboard.productIds) {
        const product = await storage.getProduct(productId);
        if (product) products.push(product);
      }
      return res.status(200).json({ ...moodboard, products });
    } catch (error) {
      console.error("Erro ao obter moodboard:", error);
      return res.status(500).json({ message: "Erro ao obter moodboard" });
    }
  });

  router.post("/moodboards", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const input: MoodboardCreateInput = { ...req.body, userId };
      const moodboard = await storage.createMoodboard(input);
      return res.status(201).json(moodboard);
    } catch (error) {
      console.error("Erro ao criar moodboard:", error);
      return res.status(500).json({ message: "Erro ao criar moodboard" });
    }
  });

  router.put("/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const data = req.body;
      const moodboardToUpdate = await storage.getMoodboard(id);
      if(!moodboardToUpdate || moodboardToUpdate.userId !== req.session.userId) return res.status(403).json({message: "Acesso negado ou moodboard não encontrado"});
      const moodboard = await storage.updateMoodboard(id, data);
      if (!moodboard) return res.status(404).json({ message: "Moodboard não encontrado" });
      return res.status(200).json(moodboard);
    } catch (error) {
      console.error("Erro ao atualizar moodboard:", error);
      return res.status(500).json({ message: "Erro ao atualizar moodboard" });
    }
  });

  router.delete("/moodboards/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "ID inválido" });
      const moodboard = await storage.getMoodboard(id);
      if (!moodboard || moodboard.userId !== req.session.userId) return res.status(403).json({ message: 'Acesso negado' });
      const success = await storage.deleteMoodboard(id);
      if (!success) return res.status(404).json({ message: "Moodboard não encontrado" });
      return res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir moodboard:", error);
      return res.status(500).json({ message: "Erro ao excluir moodboard" });
    }
  });

  router.post("/catalogs/upload", requireAuth, upload.single("file"), handleMulterError, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const localUser = await storage.getUser(userId);
      if (!localUser) {
         return res.status(500).json({ message: "Erro interno: dados do usuário inconsistentes." });
      }
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }
      const { originalname, size } = req.file as any;
      const location = (req.file as any).location || req.file.path;
      const s3Bucket = (req.file as any).bucket;
      const s3Key = (req.file as any).key;
      const s3Etag = (req.file as any).etag;

      const catalogData = {
        userId: localUser.id,
        fileName: originalname,
        fileUrl: location,
        fileType: originalname.split('.').pop()?.toLowerCase() || '',
        fileSize: size,
        s3Bucket: s3Bucket,
        s3Key: s3Key,
        s3Url: location,
        s3Etag: s3Etag,
        processedStatus: 'queued' as 'queued',
      };
      const catalog = await storage.createCatalog(catalogData);

      const processingFilePath = s3Key || req.file.path;

      const jobData = {
        catalogId: catalog.id, userId: localUser.id, 
        s3Key: s3Key,
        processingFilePath: processingFilePath,
        fileName: originalname, fileType: catalogData.fileType,
        isS3Upload: !!s3Key
      };
      await processCatalogInBackground(jobData);
      return res.status(201).json({
        message: `Catálogo "${originalname}" enviado e na fila para processamento.`,
        catalogId: catalog.id, s3Url: location
      });
    } catch (error) {
      console.error("Erro GERAL na rota de upload:", error);
      return res.status(500).json({
        message: `Erro interno ao processar upload: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });

  router.get("/images/:userId/:catalogId/:filename", (req: Request, res: Response) => {
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

  router.post("/ai-design-projects", requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const { name, clientRenderImageUrl, clientFloorPlanImageUrl } = req.body;
        if (!name) {
            return res.status(400).json({ message: "Nome do projeto é obrigatório." });
        }
        const newProject = await storage.createDesignProject({
            userId,
            name,
            clientRenderImageUrl: clientRenderImageUrl || null,
            clientFloorPlanImageUrl: clientFloorPlanImageUrl || null,
            status: 'new',
        });
        return res.status(201).json(newProject);
    } catch (error) {
        console.error("Erro ao criar projeto de design AI:", error);
        return res.status(500).json({ message: "Erro interno ao criar projeto de design AI." });
    }
  });

  router.get("/ai-design-projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const projects = await storage.getAllDesignProjects(userId);
      return res.status(200).json(projects);
    } catch (error) {
      console.error("Erro ao buscar lista de projetos de design AI:", error);
      const message = error instanceof Error ? error.message : "Erro interno ao buscar lista de projetos.";
      return res.status(500).json({ message });
    }
  });

  router.get("/ai-design-projects/:projectId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectIdParam = req.params.projectId;
      const userId = req.session.userId!;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) return res.status(400).json({ message: "ID de projeto deve ser um número." });
      
      const project = await storage.getDesignProject(projectId);
      
      if (!project) return res.status(404).json({ message: "Projeto de design não encontrado." });
      if (project.userId !== userId) return res.status(403).json({ message: "Acesso negado." });
      
      // Buscar os itens do projeto
      const items = await storage.getDesignProjectItems(projectId);
      
      // Adicionar os itens ao objeto do projeto
      return res.status(200).json({ ...project, items });
    } catch (error) {
      console.error("Erro ao buscar projeto de design:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });

  router.get("/ai-design-projects/:projectId/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectIdParam = req.params.projectId;
      const userId = req.session.userId!;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) return res.status(400).json({ message: "ID de projeto deve ser um número." });
      const project = await storage.getDesignProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto não encontrado." });
      if (project.userId !== userId) return res.status(403).json({ message: "Acesso negado." });
      const items = await storage.getDesignProjectItems(projectId);
      return res.status(200).json(items); 
    } catch (error) {
      console.error("Erro ao buscar itens do projeto de design:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });

  router.put("/ai-design-projects/:projectId/items/:itemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectIdParam = req.params.projectId;
      const itemIdParam = req.params.itemId;
      const userId = req.session.userId!;
      const updateData = req.body; 
      const projectId = parseInt(projectIdParam);
      const itemId = parseInt(itemIdParam);
      if (isNaN(projectId) || isNaN(itemId)) {
        return res.status(400).json({ message: "IDs de projeto e item devem ser números." });
      }
      const project = await storage.getDesignProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto não encontrado." });
      if (project.userId !== userId) return res.status(403).json({ message: "Acesso negado." });

      delete updateData.id;
      delete updateData.designProjectId;
      delete updateData.createdAt;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "Nenhum dado fornecido para atualização." });
      }
      const updatedItem = await storage.updateDesignProjectItem(itemId, updateData);
      if (!updatedItem) return res.status(404).json({ message: "Item não encontrado ou não pôde ser atualizado." });

      const baseImageUrlForInpainting = project.clientRenderImageUrl || project.clientFloorPlanImageUrl;
      if (updateData.selectedProductId && baseImageUrlForInpainting) { 
          triggerInpaintingForItem(updatedItem.id, projectId, baseImageUrlForInpainting)
            .then(() => console.log(`[Routes] Inpainting para item ${updatedItem.id} iniciado.`))
            .catch(err => console.error(`[Routes] Erro ao disparar inpainting para item ${updatedItem.id}:`, err));
      }
      return res.status(200).json(updatedItem);
    } catch (error) {
      console.error("Erro ao atualizar item de design:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });

  router.post("/ai-design-projects/:projectId/generate-final-render", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectIdParam = req.params.projectId;
      const userId = req.session.userId!;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) return res.status(400).json({ message: "ID de projeto deve ser um número." });
      const project = await storage.getDesignProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto não encontrado." });
      if (project.userId !== userId) return res.status(403).json({ message: "Acesso negado." });
      generateFinalRenderForProject(projectId)
        .then(() => console.log(`[Routes] Render final para projeto ${projectId} iniciado.`))
        .catch(err => console.error(`[Routes] Erro ao disparar render final para projeto ${projectId}:`, err));
      return res.status(202).json({ message: "Processamento do render final iniciado." });
    } catch (error) {
      console.error("Erro na rota /generate-final-render:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });

  router.post("/ai-design-projects/:projectId/initiate-image-analysis", 
    requireAuth, 
    upload.single('projectImage'), 
    handleMulterError, 
    async (req: Request, res: Response) => {
    try {
      const projectIdParam = req.params.projectId;
      const userId = req.session.userId!;
      const projectId = parseInt(projectIdParam);
      if (isNaN(projectId)) return res.status(400).json({ message: "ID de projeto deve ser um número." });
      if (!req.file) return res.status(400).json({ message: "Nenhum arquivo de imagem enviado." });

      let project = await storage.getDesignProject(projectId);
      if (!project) return res.status(404).json({ message: "Projeto não encontrado." });
      if (project.userId !== userId) return res.status(403).json({ message: "Acesso negado." });

      const imageUrl = (req.file as any).location || req.file.path;
      if (!imageUrl) {
        return res.status(500).json({ message: "Falha ao obter URL da imagem após upload." });
      }
      const updatedProject = await storage.updateDesignProject(projectId, {
        clientRenderImageUrl: imageUrl, status: 'processing', updatedAt: new Date(),
      });
      if (!updatedProject) {
        return res.status(500).json({ message: "Falha ao atualizar projeto com URL da imagem." });
      }
      processDesignProjectImage(projectId, imageUrl, req.body.userMessageText)
        .then(() => console.log(`[API Upload Image] processDesignProjectImage para projeto ${projectId} concluído.`))
        .catch(err => console.error(`[API Upload Image] Erro em processDesignProjectImage para ${projectId}:`, err));
      return res.status(200).json(updatedProject);
    } catch (error) {
      console.error("Erro em /initiate-image-analysis:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });

  router.post("/upload-logo", requireAuth, logoUploadInMemory.single("logoFile"), handleMulterError, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      if (!req.file) return res.status(400).json({ message: "Nenhum arquivo de logo enviado." });
      const fileBuffer = req.file.buffer;
      const originalName = req.file.originalname;
      const logoUrl = await uploadBufferToS3(fileBuffer, originalName, userId, 'profile', 'logo');
      if (!logoUrl) throw new Error("Falha ao fazer upload do logo para S3.");
      return res.status(200).json({ logoUrl: logoUrl }); 
    } catch (error) {
      console.error("Erro no upload do logo:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      if (!res.headersSent) {
         res.status(500).json({ message });
      } else {
         res.end();
      }
    }
  });

  router.post("/products/visual-search", requireAuth, visualSearchUpload.single("searchImage"), handleMulterError, async (req: Request, res: Response) => {
    if (!openai) return res.status(503).json({ message: "Serviço de IA não configurado." });
    if (!req.file) return res.status(400).json({ message: "Nenhuma imagem enviada." });

    const userId = req.session.userId!;
    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    try {
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:${mimeType};base64,${base64Image}`;
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
            role: "user",
            content: [
                { type: "text", text: "Descreva os principais atributos visuais deste produto em poucas palavras-chave (ex: cor, forma, estilo, material)." },
                { type: "image_url", image_url: { url: imageUrl } }
            ]
        }],
        max_tokens: 100 
      });
      const description = aiResponse.choices[0].message.content;
      if (!description) throw new Error("Não foi possível obter descrição da IA.");

      const products = await storage.findRelevantProducts(userId, description);
      return res.status(200).json({ descriptionFromAI: description, products });
    } catch (error) {
      console.error("Erro na busca visual:", error);
      const message = error instanceof Error ? error.message : "Erro interno.";
      return res.status(500).json({ message });
    }
  });
}