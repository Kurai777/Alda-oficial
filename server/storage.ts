import { 
  users, type User, type InsertUser,
  products, type Product, type InsertProduct,
  catalogs, type Catalog, type InsertCatalog,
  quotes, type Quote, type InsertQuote,
  moodboards, type Moodboard, type InsertMoodboard,
  designProjects, type DesignProject, type NewDesignProject,
  designProjectItems, type DesignProjectItem, type NewDesignProjectItem,
  aiDesignChatMessages, type AiDesignChatMessage, type InsertAiDesignChatMessage,
  FloorPlan, type InsertFloorPlan, insertFloorPlanSchema, floorPlans,
  FloorPlanArea, type InsertFloorPlanArea, insertFloorPlanAreaSchema, floorPlanAreas
} from "@shared/schema";
import session from "express-session";
import { pool, db } from "./db";
import connectPgSimple from "connect-pg-simple";
import { eq, and, ilike, or, inArray, sql, isNotNull, getTableColumns, desc } from 'drizzle-orm';

// Criar store de sessão PostgreSQL
const PostgresSessionStore = connectPgSimple(session);

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
  getProductsByCatalogId(catalogId: number): Promise<Product[]>; // Busca produtos por catalogId
  getProductsByImageUrl(imageUrl: string): Promise<Product[]>; // Busca produtos que usam a mesma URL de imagem
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  updateProductImageUrl(id: number, imageUrl: string): Promise<Product | undefined>; // Atualiza apenas a URL da imagem
  deleteProduct(id: number): Promise<boolean>;
  deleteProductsByCatalogId(catalogId: number): Promise<number>; // Retorna número de produtos excluídos

  // Catalog methods
  getCatalog(id: number): Promise<Catalog | undefined>;
  getCatalogsByUserId(userId: number | string): Promise<Catalog[]>;
  createCatalog(catalog: InsertCatalog): Promise<Catalog>;
  updateCatalogStatus(id: number, status: string): Promise<Catalog | undefined>;
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
  
  // Design Projects methods
  getDesignProject(id: number): Promise<DesignProject | undefined>;
  getAllDesignProjects(userId: number | string): Promise<DesignProject[]>;
  createDesignProject(project: NewDesignProject): Promise<DesignProject>;
  updateDesignProject(id: number, project: Partial<NewDesignProject>): Promise<DesignProject | undefined>;
  deleteDesignProject(id: number): Promise<void>;
  
  // Design Project Items methods
  getDesignProjectItems(projectId: number): Promise<DesignProjectItem[]>;
  createDesignProjectItem(item: NewDesignProjectItem): Promise<DesignProjectItem>;
  updateDesignProjectItem(itemId: number, data: Partial<NewDesignProjectItem>): Promise<DesignProjectItem | undefined>;

  // AI Design Chat Messages methods
  getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]>;
  createAiDesignChatMessage(message: InsertAiDesignChatMessage): Promise<AiDesignChatMessage>;

  // Search products
  searchProducts(userId: number | string, searchText: string): Promise<Product[]>;
  findRelevantProducts(userId: number, description: string): Promise<Product[]>;
  getProductsDetails(productIds: number[]): Promise<Record<number, Product>>;
  findProductsByEmbedding(userId: number, imageEmbeddingVector: number[], limit?: number): Promise<(Product & { distance?: number })[]>;

  // FloorPlan methods
  createFloorPlan(data: InsertFloorPlan): Promise<FloorPlan>;
  getFloorPlansByAiProject(aiProjectId: number): Promise<FloorPlan[]>;
  getFloorPlanById(id: number): Promise<FloorPlan | undefined>;
  updateFloorPlan(id: number, data: Partial<Omit<InsertFloorPlan, 'id' | 'userId' | 'aiDesignProjectId' | 'createdAt'>>): Promise<FloorPlan | undefined>;

  // FloorPlanArea methods
  createFloorPlanArea(data: InsertFloorPlanArea): Promise<FloorPlanArea>;
  getFloorPlanAreasByFloorPlanId(floorPlanId: number): Promise<FloorPlanArea[]>;
  updateFloorPlanArea(areaId: number, data: Partial<Omit<InsertFloorPlanArea, 'id' | 'userId' | 'floorPlanId' | 'createdAt'>>): Promise<FloorPlanArea | undefined>;
  deleteFloorPlanArea(areaId: number): Promise<boolean>;
  getFloorPlanAreaById(areaId: number): Promise<FloorPlanArea | undefined>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;
  
  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      tableName: 'session',
      createTableIfMissing: true 
    });
  }
  
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user;
    } catch (error) {
      console.error('Error getting user by email:', error);
      return undefined;
    }
  }
  
  async createUser(insertUser: InsertUser): Promise<User> {
    try {
      const userToInsert = {
        email: insertUser.email,
        password: insertUser.password,
        name: insertUser.name || null,
        companyName: insertUser.companyName,
      };
      const result = await db.insert(users).values(userToInsert).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }
  
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    try {
      const updateData = {
        ...userData,
        updatedAt: new Date()
      };
      delete (updateData as any).id; // id não deve ser atualizado
      const result = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
      return result[0];
    } catch (error) {
      console.error('Error updating user:', error);
      return undefined;
    }
  }
  
  // Product methods
  async getProduct(id: number): Promise<Product | undefined> {
    try {
      // console.log(`Buscando produto com ID: ${id}`);
      const [product] = await db.select().from(products).where(eq(products.id, id));
      // console.log(`Produto encontrado:`, product);
      return product;
    } catch (error) {
      console.error('Error getting product:', error);
      return undefined;
    }
  }
  
  async getProductsByUserId(userId: number | string, catalogId?: number): Promise<Product[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      // console.log(`Buscando produtos para userId=${parsedUserId}, catalogId=${catalogId}`);
      
      if (catalogId) {
        // console.log(`Filtrando por catalogId=${catalogId}`);
        const query = db.select().from(products).where(
          and(eq(products.userId, parsedUserId), eq(products.catalogId, catalogId))
        );
        // console.log(`Query SQL (aproximada): ${query.toSQL ? query.toSQL().sql : 'Não disponível'}`);
        const result = await query;
        // console.log(`Encontrados ${result.length} produtos com catalogId=${catalogId}`);
        return result;
      } else {
        // console.log(`Retornando todos os produtos do usuário ${parsedUserId}`);
        const query = db.select().from(products).where(eq(products.userId, parsedUserId));
        // console.log(`Query SQL (aproximada): ${query.toSQL ? query.toSQL().sql : 'Não disponível'}`);
        const result = await query;
        // console.log(`Encontrados ${result.length} produtos`);
        return result;
      }
    } catch (error) {
      console.error('Error getting products by user ID:', error);
      return [];
    }
  }
  
  async getProductsByCategory(userId: number | string, category: string): Promise<Product[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      
      return await db.select().from(products).where(
        and(
          eq(products.userId, parsedUserId),
          eq(products.category, category)
        )
      );
    } catch (error) {
      console.error('Error getting products by category:', error);
      return [];
    }
  }
  
  async createProduct(insertProductData: InsertProduct): Promise<Product> {
    try {
      const productForDb: { [K in keyof InsertProduct]?: InsertProduct[K] } = { ...insertProductData };

      if (Array.isArray(insertProductData.colors)) {
        productForDb.colors = [...insertProductData.colors];
      } else if (insertProductData.colors === null || insertProductData.colors === undefined) {
        productForDb.colors = insertProductData.colors === undefined ? undefined : [];
      } 

      if (Array.isArray(insertProductData.materials)) {
        productForDb.materials = [...insertProductData.materials];
      } else if (insertProductData.materials === null || insertProductData.materials === undefined) {
        productForDb.materials = insertProductData.materials === undefined ? undefined : [];
      }

      if (Array.isArray(insertProductData.sizes)) {
        productForDb.sizes = insertProductData.sizes.map((s: {width?: number, height?: number, depth?: number, label?: string}) => ({ ...s }));
      } else if (insertProductData.sizes === null || insertProductData.sizes === undefined) {
        productForDb.sizes = insertProductData.sizes === undefined ? undefined : [];
      }
  
      if (productForDb.colors === undefined) delete productForDb.colors; 
      if (productForDb.materials === undefined) delete productForDb.materials;
      if (productForDb.sizes === undefined) delete productForDb.sizes;

      const [createdProduct] = await db.insert(products)
        .values(productForDb as InsertProduct)
        .returning();
      return createdProduct;
    } catch (error) {
      console.error('Error creating product in storage:', error);
      if (error instanceof Error && 'message' in error && (error as any).detail) {
          console.error('Error detail:', (error as any).detail);
      }
      throw error; 
    }
  }
  
  async updateProduct(id: number, productUpdateData: Partial<InsertProduct>): Promise<Product | undefined> {
    try {
      const dataToSet: { [key: string]: any } = {};
      let hasChanges = false;

      for (const key in productUpdateData) {
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(productUpdateData, key)) {
          
          const value = (productUpdateData as any)[key]; // Usar any aqui para acesso genérico

          if (key === 'embedding') {
            dataToSet.embedding = value;
            hasChanges = true;
            continue; // Processado, ir para a próxima chave
          }
          
          // Para outras chaves que não 'embedding':
          const typedKey = key as keyof Omit<InsertProduct, 'embedding'>; // Tipar mais estritamente para o restante

          if (value === undefined) {
             continue; 
          }
          hasChanges = true;
  
          if (typedKey === 'colors') {
            dataToSet.colors = value === null ? [] : (Array.isArray(value) ? [...value] : []);
          } else if (typedKey === 'materials') {
            dataToSet.materials = value === null ? [] : (Array.isArray(value) ? [...value] : []);
          } else if (typedKey === 'sizes') {
            dataToSet.sizes = value === null ? [] : (Array.isArray(value) ? value.map(s => (typeof s === 'object' && s !== null ? { ...s } : s)) : []);
          } else {
            // Certificar que typedKey ainda é uma chave válida para dataToSet após o Omit
            dataToSet[key] = value; // Usar key (string) para atribuição genérica
          }
        }
      }
      
      // A lógica para verificar se houve mudanças ou se o embedding foi explicitamente setado para null pode precisar de ajuste
      // Esta condição original pode não capturar corretamente o caso de productUpdateData.embedding ser null
      // if (!hasChanges && !Object.keys(productUpdateData).includes('embedding') ) { 
      // Considerar se productUpdateData continha APENAS embedding (null ou não)
      let onlyEmbeddingUpdate = Object.keys(productUpdateData).length === 1 && Object.prototype.hasOwnProperty.call(productUpdateData, 'embedding');

      if (!hasChanges && !onlyEmbeddingUpdate) { 
         const existingProduct = await this.getProduct(id);
         return existingProduct; 
      }
      
      // delete (dataToSet as any).updatedAt; // updatedAt já foi removido anteriormente
  
      delete (dataToSet as any).id;
      delete (dataToSet as any).userId; 
      delete (dataToSet as any).catalogId; 
      delete (dataToSet as any).createdAt; 
        
      const [updatedProduct] = await db.update(products).set(dataToSet).where(eq(products.id, id)).returning();
      return updatedProduct;
    } catch (error) {
      console.error(`Error updating product ${id} in storage:`, error);
      if (error instanceof Error && 'message' in error && (error as any).detail) {
        console.error('Error detail:', (error as any).detail);
      }
      return undefined;
    }
  }
  
  async deleteProduct(id: number): Promise<boolean> {
    try {
      const result = await db.delete(products).where(eq(products.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting product:', error);
      return false;
    }
  }
  
  async getProductsByCatalogId(catalogId: number): Promise<Product[]> {
    try {
      const result = await db.select().from(products).where(eq(products.catalogId, catalogId));
      return result;
    } catch (error) {
      console.error('Error getting products by catalogId:', error);
      return [];
    }
  }
  
  async getProducts(userId: number, catalogId?: number): Promise<Product[]> {
    return this.getProductsByUserId(userId, catalogId);
  }
  
  async getProductsByImageUrl(imageUrl: string): Promise<Product[]> {
    try {
      const result = await db.select().from(products).where(eq(products.imageUrl, imageUrl));
      return result;
    } catch (error) {
      console.error('Error getting products by imageUrl:', error);
      return [];
    }
  }
  
  async updateProductImageUrl(id: number, imageUrl: string): Promise<Product | undefined> {
    try {
      const [product] = await db.update(products).set({ imageUrl: imageUrl, isEdited: true }).where(eq(products.id, id)).returning();
      return product;
    } catch (error) {
      console.error(`Error updating product image URL: ${error}`);
      return undefined;
    }
  }
  
  async deleteProductsByCatalogId(catalogId: number): Promise<number> {
    try {
      const result = await db.delete(products).where(eq(products.catalogId, catalogId)).returning();
      return result.length;
    } catch (error) {
      console.error('Error deleting products by catalog ID:', error);
      return 0;
    }
  }
  
  async getCatalog(id: number): Promise<Catalog | undefined> {
    try {
      const [catalog] = await db.select().from(catalogs).where(eq(catalogs.id, id));
      return catalog;
    } catch (error) {
      console.error('Error getting catalog:', error);
      return undefined;
    }
  }
  
  async getCatalogsByUserId(userId: number | string): Promise<Catalog[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      const results = await db.select().from(catalogs).where(eq(catalogs.userId, parsedUserId));
      return results;
    } catch (error) {
      console.error('Error getting catalogs by user ID:', error);
      return [];
    }
  }
  
  async getCatalogs(userId: number | string): Promise<Catalog[]> {
    return this.getCatalogsByUserId(userId);
  }
  
  async createCatalog(insertCatalog: InsertCatalog): Promise<Catalog> {
    try {
      const { firebaseUserId, firestoreCatalogId, ...catalogToInsert } = insertCatalog;
      const [catalog] = await db.insert(catalogs).values(catalogToInsert).returning();
      return catalog;
    } catch (error) {
      console.error('Error creating catalog:', error);
      throw error;
    }
  }
  
  async updateCatalogStatus(id: number, status: string): Promise<Catalog | undefined> {
    try {
      const [catalog] = await db.update(catalogs).set({ processedStatus: status }).where(eq(catalogs.id, id)).returning();
      return catalog;
    } catch (error) {
      console.error('Error updating catalog status:', error);
      return undefined;
    }
  }
    
  async deleteCatalog(id: number): Promise<boolean> {
    try {
      await this.deleteProductsByCatalogId(id);
      const result = await db.delete(catalogs).where(eq(catalogs.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting catalog:', error);
      return false;
    }
  }
  
  async getQuote(id: number): Promise<Quote | undefined> {
    try {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
      return quote;
    } catch (error) {
      console.error('Error getting quote:', error);
      return undefined;
    }
  }
  
  async getQuotesByUserId(userId: number): Promise<Quote[]> {
    try {
      return await db.select().from(quotes).where(eq(quotes.userId, userId));
    } catch (error) {
      console.error('Error getting quotes by user ID:', error);
      return [];
    }
  }
  
  async getQuotes(userId: number): Promise<Quote[]> {
    return this.getQuotesByUserId(userId);
  }
  
  async createQuote(insertQuote: InsertQuote): Promise<Quote> {
    // Removido throw Error para Drizzle type issues, implementação básica:
    try {
      const [quote] = await db.insert(quotes).values(insertQuote).returning();
      return quote;
    } catch (error) {
      console.error('Error creating quote:', error);
      throw error;
    }
  }
  
  async updateQuote(id: number, quoteUpdate: Partial<InsertQuote>): Promise<Quote | undefined> {
    // Removido throw Error, implementação básica:
    try {
      const dataToSet = { ...quoteUpdate, updatedAt: new Date() };
      delete (dataToSet as any).id; delete (dataToSet as any).userId; delete (dataToSet as any).createdAt;
      const [quote] = await db.update(quotes).set(dataToSet).where(eq(quotes.id, id)).returning();
      return quote;
    } catch (error) {
      console.error('Error updating quote:', error);
      return undefined;
    }
  }
  
  async deleteQuote(id: number): Promise<boolean> {
    try {
      const result = await db.delete(quotes).where(eq(quotes.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting quote:', error);
      return false;
    }
  }
  
  async getMoodboard(id: number): Promise<Moodboard | undefined> {
    try {
      const [moodboard] = await db.select().from(moodboards).where(eq(moodboards.id, id));
      return moodboard;
    } catch (error) {
      console.error('Error getting moodboard:', error);
      return undefined;
    }
  }
  
  async getMoodboardsByUserId(userId: number): Promise<Moodboard[]> {
    try {
      return await db.select().from(moodboards).where(eq(moodboards.userId, userId)).orderBy(desc(moodboards.updatedAt));
    } catch (error) {
      console.error('Error getting moodboards by user ID:', error);
      return [];
    }
  }
  
  async getMoodboards(userId: number): Promise<Moodboard[]> {
    return this.getMoodboardsByUserId(userId);
  }
  
  async createMoodboard(insertMoodboardData: InsertMoodboard): Promise<Moodboard> {
    try {
      const dataToInsert: InsertMoodboard = {
        userId: insertMoodboardData.userId,
        projectName: insertMoodboardData.projectName,
        productIds: Array.isArray(insertMoodboardData.productIds) ? insertMoodboardData.productIds : [],
        quoteId: insertMoodboardData.quoteId,
        clientName: insertMoodboardData.clientName,
        architectName: insertMoodboardData.architectName,
        fileUrl: insertMoodboardData.fileUrl,
        description: insertMoodboardData.description,
        style: insertMoodboardData.style,
        colorPalette: Array.isArray(insertMoodboardData.colorPalette) ? insertMoodboardData.colorPalette : [],
        generatedImageUrl: insertMoodboardData.generatedImageUrl,
        iaPrompt: insertMoodboardData.iaPrompt,
        status: insertMoodboardData.status || 'pending_generation',
      };
      Object.keys(dataToInsert).forEach(keyStr => {
        const key = keyStr as keyof InsertMoodboard;
        if (dataToInsert[key] === undefined) delete dataToInsert[key];
      });
      const [moodboard] = await db.insert(moodboards).values(dataToInsert).returning();
      return moodboard;
    } catch (error) {
      console.error('Error creating moodboard in storage:', error);
      throw error;
    }
  }
  
  async updateMoodboard(id: number, moodboardUpdateData: Partial<InsertMoodboard>): Promise<Moodboard | undefined> {
    try {
      const dataToSet: Partial<InsertMoodboard> = { ...moodboardUpdateData }; 
      if (moodboardUpdateData.colorPalette !== undefined) {
        dataToSet.colorPalette = Array.isArray(moodboardUpdateData.colorPalette) ? moodboardUpdateData.colorPalette : [];
      }
      if (moodboardUpdateData.productIds !== undefined) {
        dataToSet.productIds = Array.isArray(moodboardUpdateData.productIds) ? moodboardUpdateData.productIds : [];
      }
      
      let hasValidUpdateField = false;
      Object.keys(dataToSet).forEach(keyStr => {
        const key = keyStr as keyof Partial<InsertMoodboard>;
        if (dataToSet[key] === undefined) {
          delete dataToSet[key];
        } else {
          hasValidUpdateField = true;
        }
      });

      if (!hasValidUpdateField) {
        return this.getMoodboard(id); 
      }
      
      const finalUpdatePayload = { ...dataToSet, updatedAt: new Date() };

      const [moodboard] = await db.update(moodboards).set(finalUpdatePayload).where(eq(moodboards.id, id)).returning();
      return moodboard;
    } catch (error) {
      console.error(`Error updating moodboard ${id} in storage:`, error);
      return undefined;
    }
  }
  
  async deleteMoodboard(id: number): Promise<boolean> {
    const result = await db.delete(moodboards).where(eq(moodboards.id, id)).returning();
    return result.length > 0;
  }
  
  async getDesignProject(id: number): Promise<DesignProject | undefined> {
    const [project] = await db.select().from(designProjects).where(eq(designProjects.id, id));
    return project;
  }
  
  async getAllDesignProjects(userId: number | string): Promise<DesignProject[]> {
    const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
    return await db.select().from(designProjects).where(eq(designProjects.userId, parsedUserId)).orderBy(desc(designProjects.createdAt));
  }
  
  async createDesignProject(insertProject: NewDesignProject): Promise<DesignProject> {
    const [project] = await db.insert(designProjects).values(insertProject).returning();
    return project;
  }
  
  async updateDesignProject(id: number, projectUpdate: Partial<NewDesignProject>): Promise<DesignProject | undefined> {
    const updateData = { ...projectUpdate, updatedAt: new Date() };
    delete (updateData as any).id; 
    const [project] = await db.update(designProjects).set(updateData).where(eq(designProjects.id, id)).returning();
    return project;
  }
  
  async deleteDesignProject(id: number): Promise<void> {
    const messagesToDelete = await db.select({id: aiDesignChatMessages.id}).from(aiDesignChatMessages).where(eq(aiDesignChatMessages.projectId, id));
    if (messagesToDelete.length > 0) {
      await db.delete(aiDesignChatMessages).where(inArray(aiDesignChatMessages.id, messagesToDelete.map(m => m.id!)));
    }
    await db.delete(designProjectItems).where(eq(designProjectItems.designProjectId, id));
    await db.delete(designProjects).where(eq(designProjects.id, id));
  }

  async getDesignProjectItems(projectId: number): Promise<DesignProjectItem[]> {
    if (!projectId) return [];
    return await db.select().from(designProjectItems).where(eq(designProjectItems.designProjectId, projectId)).orderBy(desc(designProjectItems.createdAt));
  }
  
  async createDesignProjectItem(data: NewDesignProjectItem): Promise<DesignProjectItem> {
    if (!data.designProjectId) throw new Error("designProjectId is required");
    const [newItem] = await db.insert(designProjectItems).values(data).returning();
    if (!newItem) throw new Error("Failed to create design project item.");
    return newItem;
  }

  async updateDesignProjectItem(itemId: number, data: Partial<NewDesignProjectItem>): Promise<DesignProjectItem | undefined> {
    try {
      const updatePayload = { ...data, updatedAt: new Date() };
      delete (updatePayload as any).id; delete (updatePayload as any).designProjectId; delete (updatePayload as any).createdAt;
      if (Object.keys(updatePayload).length === 1 && updatePayload.updatedAt) {
         const existingItem = await db.select().from(designProjectItems).where(eq(designProjectItems.id, itemId)).limit(1);
         if (existingItem.length > 0) return existingItem[0];
         return undefined; // Retorna undefined se o item não for encontrado, em vez de potencialmente erro
      }
      const [updatedItem] = await db.update(designProjectItems).set(updatePayload).where(eq(designProjectItems.id, itemId)).returning();
      if (!updatedItem) return undefined; // Adicionado para consistência se o update não retornar nada
      return updatedItem;
    } catch (error) {
      console.error(`Error updating design project item ${itemId}:`, error);
      return undefined; // Alterado de throw error;
    }
  }

  async getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]> {
    return await db.select().from(aiDesignChatMessages).where(eq(aiDesignChatMessages.projectId, projectId)).orderBy(aiDesignChatMessages.createdAt);
  }
  
  async createAiDesignChatMessage(message: InsertAiDesignChatMessage): Promise<AiDesignChatMessage> {
    const [newMessage] = await db.insert(aiDesignChatMessages).values(message).returning();
    return newMessage;
  }

  async searchProducts(userId: number | string, searchText: string): Promise<Product[]> {
    console.log(`searchProducts chamado com userId: ${userId}, searchText: ${searchText}`);
    // Implementação básica: Retorna array vazio. TODO: Implementar lógica de busca.
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      if (!searchText || searchText.trim() === '') return [];

      const results = await db.select()
        .from(products)
        .where(and(
          eq(products.userId, parsedUserId),
          or(
            ilike(products.name, `%${searchText}%`),
            ilike(products.description, `%${searchText}%`),
            ilike(products.category, `%${searchText}%`),
            ilike(products.code, `%${searchText}%`)
          )
        ))
        .limit(50); // Limitar resultados para performance
      return results;
    } catch (error) {
      console.error('Error in searchProducts:', error);
      return [];
    }
  }

  async findRelevantProducts(userId: number, description: string): Promise<Product[]> {
    console.log(`findRelevantProducts chamado com userId: ${userId}, description: ${description}`);
    // Implementação básica: Reutiliza searchProducts. TODO: Implementar lógica mais específica se necessário.
    return this.searchProducts(userId, description);
  }

  async getProductsDetails(productIds: number[]): Promise<Record<number, Product>> {
    console.log(`getProductsDetails chamado com productIds: ${productIds}`);
    // Implementação básica: Retorna objeto vazio. TODO: Implementar lógica de busca.
    if (!productIds || productIds.length === 0) return {};
    try {
      const result = await db.select().from(products).where(inArray(products.id, productIds));
      const productsMap: Record<number, Product> = {};
      result.forEach(product => {
        productsMap[product.id] = product;
      });
      return productsMap;
    } catch (error) {
      console.error('Error in getProductsDetails:', error);
      return {};
    }
  }

  async findProductsByEmbedding(userId: number, imageEmbeddingVector: number[], limit: number = 5): Promise<(Product & { distance?: number })[]> {
    if (!imageEmbeddingVector || imageEmbeddingVector.length === 0) return [];
    const embeddingStringInput = `[${imageEmbeddingVector.join(',')}]`;
    try {
      const results = await db.select({
        product: getTableColumns(products),
        distance: sql<number>`${products.embedding} <-> ${embeddingStringInput}`.as('distance')
      })
      .from(products)
      .where(and(eq(products.userId, userId), isNotNull(products.embedding)))
      .orderBy(sql`${products.embedding} <-> ${embeddingStringInput}`)
      .limit(limit);
      return results.map(res => ({ ...res.product, distance: res.distance }));
    } catch (error) {
      console.error(`Error finding products by embedding for userId ${userId}:`, error);
      return [];
    }
  }

  async createFloorPlan(data: InsertFloorPlan): Promise<FloorPlan> {
    const validatedData: InsertFloorPlan = insertFloorPlanSchema.parse(data);
    const valuesToInsert: typeof floorPlans.$inferInsert = {
      userId: validatedData.userId,
      aiDesignProjectId: validatedData.aiDesignProjectId,
      name: validatedData.name!,
      originalImageUrl: validatedData.originalImageUrl!,
      processedImageUrl: validatedData.processedImageUrl,
      iaPrompt: validatedData.iaPrompt,
      iaStatus: validatedData.iaStatus || 'pending_upload',
      processingErrors: validatedData.processingErrors,
    };
    const [newFloorPlan] = await db.insert(floorPlans).values(valuesToInsert).returning();
    if (!newFloorPlan) throw new Error("Failed to create floor plan.");
    return newFloorPlan;
  }

  async getFloorPlansByAiProject(aiProjectId: number): Promise<FloorPlan[]> {
    return await db.select().from(floorPlans).where(eq(floorPlans.aiDesignProjectId, aiProjectId)).orderBy(desc(floorPlans.createdAt));
  }

  async getFloorPlanById(id: number): Promise<FloorPlan | undefined> {
    const [floorPlan] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
    return floorPlan;
  }

  async updateFloorPlan(id: number, data: Partial<Omit<InsertFloorPlan, 'id' | 'userId' | 'aiDesignProjectId' | 'createdAt'>>): Promise<FloorPlan | undefined> {
    const updatePayload: { [key: string]: any } = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        updatePayload[key] = (data as any)[key];
      }
    }
    if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedAt = new Date();
    } else {
        return this.getFloorPlanById(id);
    }

    const [updatedFloorPlan] = await db.update(floorPlans).set(updatePayload).where(eq(floorPlans.id, id)).returning();
    return updatedFloorPlan;
  }

  async createFloorPlanArea(data: InsertFloorPlanArea): Promise<FloorPlanArea> {
    const validatedData = insertFloorPlanAreaSchema.parse(data);
    const [newArea] = await db.insert(floorPlanAreas).values(validatedData).returning();
    if (!newArea) throw new Error("Failed to create floor plan area.");
    return newArea;
  }

  async getFloorPlanAreasByFloorPlanId(floorPlanId: number): Promise<FloorPlanArea[]> {
    return await db.select().from(floorPlanAreas).where(eq(floorPlanAreas.floorPlanId, floorPlanId)).orderBy(desc(floorPlanAreas.createdAt));
  }

  async updateFloorPlanArea(areaId: number, data: Partial<Omit<InsertFloorPlanArea, 'id' | 'userId' | 'floorPlanId' | 'createdAt'>>): Promise<FloorPlanArea | undefined> {
    const updatePayload: { [key: string]: any } = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key) && (data as any)[key] !== undefined) {
        updatePayload[key] = (data as any)[key];
      }
    }
    if (Object.keys(updatePayload).length === 0) return this.getFloorPlanAreaById(areaId);
    updatePayload.updatedAt = new Date();
    const [updatedArea] = await db.update(floorPlanAreas).set(updatePayload).where(eq(floorPlanAreas.id, areaId)).returning();
    return updatedArea;
  }

  async getFloorPlanAreaById(areaId: number): Promise<FloorPlanArea | undefined> {
    const [area] = await db.select().from(floorPlanAreas).where(eq(floorPlanAreas.id, areaId));
    return area;
  }

  async deleteFloorPlanArea(areaId: number): Promise<boolean> {
    const result = await db.delete(floorPlanAreas).where(eq(floorPlanAreas.id, areaId)).returning({ id: floorPlanAreas.id });
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage(); 