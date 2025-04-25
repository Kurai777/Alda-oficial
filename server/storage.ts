import { 
  users, type User, type InsertUser,
  products, type Product, type InsertProduct,
  catalogs, type Catalog, type InsertCatalog,
  quotes, type Quote, type InsertQuote,
  moodboards, type Moodboard, type InsertMoodboard,
  aiDesignProjects, type AiDesignProject, type InsertAiDesignProject,
  aiDesignChatMessages, type AiDesignChatMessage, type InsertAiDesignChatMessage
} from "@shared/schema";
import session from "express-session";
import { pool } from "./db";

export interface IStorage {
  // Armazenamento de sessões
  sessionStore: session.Store;
  
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<User>): Promise<User | undefined>;

  // Product methods
  getProduct(id: number): Promise<Product | undefined>;
  getProductsByUserId(userId: number | string, catalogId?: number): Promise<Product[]>;
  getProductsByCategory(userId: number | string, category: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;
  deleteProductsByCatalogId(catalogId: number): Promise<number>; // Retorna número de produtos excluídos

  // Catalog methods
  getCatalog(id: number): Promise<Catalog | undefined>;
  getCatalogsByUserId(userId: number | string): Promise<Catalog[]>;
  createCatalog(catalog: InsertCatalog): Promise<Catalog>;
  updateCatalogStatus(id: number, status: string, firestoreCatalogId?: string): Promise<Catalog | undefined>;
  deleteCatalog(id: number): Promise<boolean>;

  // Quote methods
  getQuote(id: number): Promise<Quote | undefined>;
  getQuotesByUserId(userId: number): Promise<Quote[]>;
  createQuote(quote: InsertQuote): Promise<Quote>;
  updateQuote(id: number, quote: Partial<InsertQuote>): Promise<Quote | undefined>;
  deleteQuote(id: number): Promise<boolean>;

  // Moodboard methods
  getMoodboard(id: number): Promise<Moodboard | undefined>;
  getMoodboardsByUserId(userId: number): Promise<Moodboard[]>;
  createMoodboard(moodboard: InsertMoodboard): Promise<Moodboard>;
  updateMoodboard(id: number, moodboard: Partial<InsertMoodboard>): Promise<Moodboard | undefined>;
  deleteMoodboard(id: number): Promise<boolean>;
  
  // AI Design Projects methods
  getAiDesignProject(id: number): Promise<AiDesignProject | undefined>;
  getAllAiDesignProjects(userId: number | string): Promise<AiDesignProject[]>;
  createAiDesignProject(project: InsertAiDesignProject): Promise<AiDesignProject>;
  updateAiDesignProject(id: number, project: Partial<AiDesignProject>): Promise<AiDesignProject | undefined>;
  deleteAiDesignProject(id: number): Promise<void>;
  
  // AI Design Chat Messages methods
  getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]>;
  createAiDesignChatMessage(message: InsertAiDesignChatMessage): Promise<AiDesignChatMessage>;
}

import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";

const PostgresSessionStore = connectPgSimple(session);
const MemoryStore = createMemoryStore(session);

export class MemStorage implements IStorage {
  // AI Design Project methods
  async getAiDesignProject(id: number): Promise<AiDesignProject | undefined> {
    return this.aiDesignProjects.get(id);
  }
  
  async getAllAiDesignProjects(userId: number | string): Promise<AiDesignProject[]> {
    return Array.from(this.aiDesignProjects.values()).filter(
      (project) => project.userId === userId
    );
  }
  
  async createAiDesignProject(insertProject: InsertAiDesignProject): Promise<AiDesignProject> {
    const id = this.aiDesignProjectId++;
    const project: AiDesignProject = { 
      ...insertProject, 
      id, 
      createdAt: new Date(),
      status: "pending",
      generatedFloorPlanUrl: null,
      generatedRenderUrl: null,
      floorPlanImageUrl: insertProject.floorPlanImageUrl || null,
      renderImageUrl: insertProject.renderImageUrl || null,
      quoteId: insertProject.quoteId || null,
      moodboardId: insertProject.moodboardId || null
    };
    this.aiDesignProjects.set(id, project);
    return project;
  }
  
  async updateAiDesignProject(id: number, projectUpdate: Partial<AiDesignProject>): Promise<AiDesignProject | undefined> {
    const existingProject = this.aiDesignProjects.get(id);
    if (!existingProject) return undefined;
    
    const updatedProject = { ...existingProject, ...projectUpdate };
    this.aiDesignProjects.set(id, updatedProject);
    return updatedProject;
  }
  
  async deleteAiDesignProject(id: number): Promise<void> {
    // Excluir todas as mensagens de chat associadas ao projeto
    const chatMessages = Array.from(this.aiDesignChatMessages.values())
      .filter(message => message.projectId === id);
    
    chatMessages.forEach(message => {
      this.aiDesignChatMessages.delete(message.id);
    });
    
    // Excluir o projeto
    this.aiDesignProjects.delete(id);
  }
  
  // AI Design Chat Messages methods
  async getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]> {
    return Array.from(this.aiDesignChatMessages.values())
      .filter(message => message.projectId === projectId)
      .sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return dateA - dateB;
      });
  }
  
  async createAiDesignChatMessage(insertMessage: InsertAiDesignChatMessage): Promise<AiDesignChatMessage> {
    const id = this.aiDesignChatMessageId++;
    const message: AiDesignChatMessage = {
      ...insertMessage,
      id,
      createdAt: new Date(),
      attachmentUrl: insertMessage.attachmentUrl || null
    };
    this.aiDesignChatMessages.set(id, message);
    return message;
  }
  sessionStore: session.Store;
  
  private users: Map<number, User>;
  private products: Map<number, Product>;
  private catalogs: Map<number, Catalog>;
  private quotes: Map<number, Quote>;
  private moodboards: Map<number, Moodboard>;
  private aiDesignProjects: Map<number, AiDesignProject>;
  private aiDesignChatMessages: Map<number, AiDesignChatMessage>;
  
  private userId: number;
  private productId: number;
  private catalogId: number;
  private quoteId: number;
  private moodboardId: number;
  private aiDesignProjectId: number;
  private aiDesignChatMessageId: number;

  constructor() {
    // Inicializar o sessionStore
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // Limpar sessões expiradas a cada 24 horas
    });
    this.users = new Map();
    this.products = new Map();
    this.catalogs = new Map();
    this.quotes = new Map();
    this.moodboards = new Map();
    this.aiDesignProjects = new Map();
    this.aiDesignChatMessages = new Map();
    
    this.userId = 1;
    this.productId = 1;
    this.catalogId = 1;
    this.quoteId = 1;
    this.moodboardId = 1;
    this.aiDesignProjectId = 1;
    this.aiDesignChatMessageId = 1;

    // Add demo user
    this.createUser({
      email: "demo@example.com",
      password: "password123",
      companyName: "Móveis Elegance"
    });
    
    // Somente dados reais serão usados
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userId++;
    const user: User = { ...insertUser, id, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  // Product methods
  async getProduct(id: number): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getProductsByUserId(userId: number | string, catalogId?: number): Promise<Product[]> {
    // Converter userId para número ou string para comparação
    const userIdToCompare = typeof userId === 'string' ? userId : userId;
    
    // Filtrar produtos por usuário
    const userProducts = Array.from(this.products.values()).filter(
      (product) => {
        // Verificar userId
        let userMatch = false;
        
        if (typeof userIdToCompare === 'string' && typeof product.userId === 'string') {
          userMatch = product.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof product.userId === 'number') {
          userMatch = product.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'string' && typeof product.userId === 'number') {
          userMatch = product.userId.toString() === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof product.userId === 'string') {
          userMatch = userIdToCompare.toString() === product.userId;
        }
        
        return userMatch;
      }
    );
    
    // Se catalogId for especificado, filtrar adicionalmente por ele
    if (catalogId !== undefined) {
      console.log(`Filtrando produtos do usuário ${userId} por catalogId=${catalogId}`);
      return userProducts.filter(product => product.catalogId === catalogId);
    }
    
    console.log(`Retornando todos os produtos do usuário ${userId}`);
    return userProducts;
  }

  async getProductsByCategory(userId: number | string, category: string): Promise<Product[]> {
    // Converter userId para número ou string para comparação
    const userIdToCompare = typeof userId === 'string' ? userId : userId;
    
    return Array.from(this.products.values()).filter(
      (product) => {
        // Verificar userId
        let userMatch = false;
        
        if (typeof userIdToCompare === 'string' && typeof product.userId === 'string') {
          userMatch = product.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof product.userId === 'number') {
          userMatch = product.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'string' && typeof product.userId === 'number') {
          userMatch = product.userId.toString() === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof product.userId === 'string') {
          userMatch = userIdToCompare.toString() === product.userId;
        }
        
        return userMatch && product.category === category;
      }
    );
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = this.productId++;
    
    // Garantir que arrays sejam tratados corretamente
    const colors = Array.isArray(insertProduct.colors) ? insertProduct.colors : [];
    const materials = Array.isArray(insertProduct.materials) ? insertProduct.materials : [];
    
    // Garantir que sizes é formatado corretamente
    const sizes = Array.isArray(insertProduct.sizes) 
      ? insertProduct.sizes.map(size => ({
          width: typeof size.width === 'number' ? size.width : undefined,
          height: typeof size.height === 'number' ? size.height : undefined,
          depth: typeof size.depth === 'number' ? size.depth : undefined,
          label: typeof size.label === 'string' ? size.label : undefined
        }))
      : [];
    
    // Criar produto com tipos corretos
    const product: Product = { 
      ...insertProduct, 
      id, 
      createdAt: new Date(),
      colors,
      materials,
      sizes,
      catalogId: insertProduct.catalogId || null,
      description: insertProduct.description || null,
      category: insertProduct.category || null,
      imageUrl: insertProduct.imageUrl || null,
      // Campos de integração com Firebase
      firestoreId: insertProduct.firestoreId || null,
      firebaseUserId: insertProduct.firebaseUserId || null
    };
    
    this.products.set(id, product);
    return product;
  }

  async updateProduct(id: number, productUpdate: Partial<InsertProduct>): Promise<Product | undefined> {
    const existingProduct = this.products.get(id);
    if (!existingProduct) return undefined;

    // Garantir que arrays sejam tratados corretamente
    let updatedColors = existingProduct.colors;
    let updatedMaterials = existingProduct.materials;
    let updatedSizes = existingProduct.sizes;
    
    // Atualizar colors se fornecido
    if (productUpdate.colors !== undefined) {
      updatedColors = Array.isArray(productUpdate.colors) ? productUpdate.colors : [];
    }
    
    // Atualizar materials se fornecido
    if (productUpdate.materials !== undefined) {
      updatedMaterials = Array.isArray(productUpdate.materials) ? productUpdate.materials : [];
    }
    
    // Atualizar sizes se fornecido
    if (productUpdate.sizes !== undefined) {
      updatedSizes = Array.isArray(productUpdate.sizes) 
        ? productUpdate.sizes.map(size => ({
            width: typeof size.width === 'number' ? size.width : undefined,
            height: typeof size.height === 'number' ? size.height : undefined,
            depth: typeof size.depth === 'number' ? size.depth : undefined,
            label: typeof size.label === 'string' ? size.label : undefined
          }))
        : existingProduct.sizes;
    }
    
    // Criar produto atualizado com tipos corretos
    const updatedProduct: Product = { 
      ...existingProduct,
      ...productUpdate,
      colors: updatedColors,
      materials: updatedMaterials,
      sizes: updatedSizes,
      catalogId: productUpdate.catalogId !== undefined ? productUpdate.catalogId : existingProduct.catalogId,
      description: productUpdate.description !== undefined ? productUpdate.description : existingProduct.description,
      category: productUpdate.category !== undefined ? productUpdate.category : existingProduct.category,
      imageUrl: productUpdate.imageUrl !== undefined ? productUpdate.imageUrl : existingProduct.imageUrl,
      // Preservar ou atualizar campos de integração com Firebase
      firestoreId: productUpdate.firestoreId !== undefined ? productUpdate.firestoreId : existingProduct.firestoreId,
      firebaseUserId: productUpdate.firebaseUserId !== undefined ? productUpdate.firebaseUserId : existingProduct.firebaseUserId
    };
    
    this.products.set(id, updatedProduct);
    return updatedProduct;
  }

  async deleteProduct(id: number): Promise<boolean> {
    console.log(`Excluindo produto com ID ${id}`);
    return this.products.delete(id);
  }
  
  async deleteProductsByCatalogId(catalogId: number): Promise<number> {
    console.log(`Excluindo todos os produtos do catálogo com ID ${catalogId}`);
    let deletedCount = 0;
    
    // Encontrar todos os produtos do catálogo
    const productsToDelete = Array.from(this.products.values())
      .filter(product => product.catalogId === catalogId);
      
    // Excluir cada produto
    for (const product of productsToDelete) {
      if (this.products.delete(product.id)) {
        deletedCount++;
      }
    }
    
    console.log(`${deletedCount} produtos excluídos do catálogo ${catalogId}`);
    return deletedCount;
  }

  // Catalog methods
  async getCatalog(id: number): Promise<Catalog | undefined> {
    return this.catalogs.get(id);
  }

  async getCatalogsByUserId(userId: number | string): Promise<Catalog[]> {
    // Converter userId para número ou string para comparação
    const userIdToCompare = typeof userId === 'string' ? userId : userId;
    
    return Array.from(this.catalogs.values()).filter(
      (catalog) => {
        // Verificar userId
        if (typeof userIdToCompare === 'string' && typeof catalog.userId === 'string') {
          return catalog.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof catalog.userId === 'number') {
          return catalog.userId === userIdToCompare;
        } else if (typeof userIdToCompare === 'string' && typeof catalog.userId === 'number') {
          return catalog.userId.toString() === userIdToCompare;
        } else if (typeof userIdToCompare === 'number' && typeof catalog.userId === 'string') {
          return userIdToCompare.toString() === catalog.userId;
        }
        return false;
      }
    );
  }

  async createCatalog(insertCatalog: InsertCatalog): Promise<Catalog> {
    const id = this.catalogId++;
    
    // Garantir que os campos sejam tratados corretamente
    const catalog: Catalog = { 
      ...insertCatalog, 
      id, 
      createdAt: new Date(),
      processedStatus: insertCatalog.processedStatus || "pending",
      firestoreCatalogId: insertCatalog.firestoreCatalogId || null,
      firebaseUserId: insertCatalog.firebaseUserId || null
    };
    
    this.catalogs.set(id, catalog);
    return catalog;
  }

  async updateCatalogStatus(id: number, status: string, firestoreCatalogId?: string, firebaseUserId?: string): Promise<Catalog | undefined> {
    const existingCatalog = this.catalogs.get(id);
    if (!existingCatalog) return undefined;

    const updatedCatalog = { 
      ...existingCatalog, 
      processedStatus: status,
      // Atualizar firestoreCatalogId se fornecido
      ...(firestoreCatalogId ? { firestoreCatalogId } : {}),
      // Atualizar firebaseUserId se fornecido
      ...(firebaseUserId ? { firebaseUserId } : { firebaseUserId: existingCatalog.firebaseUserId || null })
    };
    
    this.catalogs.set(id, updatedCatalog);
    return updatedCatalog;
  }
  
  async deleteCatalog(id: number): Promise<boolean> {
    console.log(`Excluindo catálogo com ID ${id}`);
    
    // Primeiro, excluir todos os produtos associados a este catálogo
    await this.deleteProductsByCatalogId(id);
    
    // Depois, excluir o catálogo
    const result = this.catalogs.delete(id);
    console.log(`Catálogo ${id} ${result ? 'excluído com sucesso' : 'não encontrado'}`);
    
    return result;
  }

  // Quote methods
  async getQuote(id: number): Promise<Quote | undefined> {
    return this.quotes.get(id);
  }

  async getQuotesByUserId(userId: number): Promise<Quote[]> {
    return Array.from(this.quotes.values()).filter(
      (quote) => quote.userId === userId
    );
  }

  async createQuote(insertQuote: InsertQuote): Promise<Quote> {
    const id = this.quoteId++;
    const quote: Quote = { ...insertQuote, id, createdAt: new Date() };
    this.quotes.set(id, quote);
    return quote;
  }

  async updateQuote(id: number, quoteUpdate: Partial<InsertQuote>): Promise<Quote | undefined> {
    const existingQuote = this.quotes.get(id);
    if (!existingQuote) return undefined;

    const updatedQuote = { ...existingQuote, ...quoteUpdate };
    this.quotes.set(id, updatedQuote);
    return updatedQuote;
  }

  async deleteQuote(id: number): Promise<boolean> {
    return this.quotes.delete(id);
  }

  // Moodboard methods
  async getMoodboard(id: number): Promise<Moodboard | undefined> {
    return this.moodboards.get(id);
  }

  async getMoodboardsByUserId(userId: number): Promise<Moodboard[]> {
    return Array.from(this.moodboards.values()).filter(
      (moodboard) => moodboard.userId === userId
    );
  }

  async createMoodboard(insertMoodboard: InsertMoodboard): Promise<Moodboard> {
    const id = this.moodboardId++;
    const moodboard: Moodboard = { ...insertMoodboard, id, createdAt: new Date() };
    this.moodboards.set(id, moodboard);
    return moodboard;
  }

  async updateMoodboard(id: number, moodboardUpdate: Partial<InsertMoodboard>): Promise<Moodboard | undefined> {
    const existingMoodboard = this.moodboards.get(id);
    if (!existingMoodboard) return undefined;

    const updatedMoodboard = { ...existingMoodboard, ...moodboardUpdate };
    this.moodboards.set(id, updatedMoodboard);
    return updatedMoodboard;
  }

  async deleteMoodboard(id: number): Promise<boolean> {
    return this.moodboards.delete(id);
  }
}

export const storage = new MemStorage();
