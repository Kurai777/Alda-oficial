import { 
  users, type User, type InsertUser,
  products, type Product, type InsertProduct,
  catalogs, type Catalog, type InsertCatalog,
  quotes, type Quote, type InsertQuote,
  moodboards, type Moodboard, type InsertMoodboard,
  designProjects, type DesignProject, type NewDesignProject,
  designProjectItems, type DesignProjectItem, type NewDesignProjectItem,
  aiDesignChatMessages, type AiDesignChatMessage, type InsertAiDesignChatMessage
} from "@shared/schema";
import session from "express-session";
import { MemoryStore } from "express-session";
import { pool, db } from "./db";
import connectPgSimple from "connect-pg-simple";
import { eq, and, ilike, or, inArray, sql, isNotNull } from 'drizzle-orm';

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

  // AI Design Chat Messages methods
  getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]>;
  createAiDesignChatMessage(message: InsertAiDesignChatMessage): Promise<AiDesignChatMessage>;

  // Search products
  searchProducts(userId: number | string, searchText: string): Promise<Product[]>;
  findRelevantProducts(userId: number, description: string): Promise<Product[]>;
  getProductsDetails(productIds: number[]): Promise<Record<number, Product>>;
  findProductsByEmbedding(userId: number, imageEmbeddingVector: number[], limit?: number): Promise<Product[]>;
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
      delete updateData.id;
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
      console.log(`Buscando produto com ID: ${id}`);
      const [product] = await db.select().from(products).where(eq(products.id, id));
      console.log(`Produto encontrado:`, product);
      return product;
    } catch (error) {
      console.error('Error getting product:', error);
      return undefined;
    }
  }
  
  async getProductsByUserId(userId: number | string, catalogId?: number): Promise<Product[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      console.log(`Buscando produtos para userId=${parsedUserId}, catalogId=${catalogId}`);
      
      if (catalogId) {
        console.log(`Filtrando por catalogId=${catalogId}`);
        const query = db.select().from(products).where(
          and(eq(products.userId, parsedUserId), eq(products.catalogId, catalogId))
        );
        console.log(`Query SQL (aproximada): ${query.toSQL ? query.toSQL().sql : 'Não disponível'}`);
        const result = await query;
        console.log(`Encontrados ${result.length} produtos com catalogId=${catalogId}`);
        return result;
      } else {
        console.log(`Retornando todos os produtos do usuário ${parsedUserId}`);
        const query = db.select().from(products).where(eq(products.userId, parsedUserId));
        console.log(`Query SQL (aproximada): ${query.toSQL ? query.toSQL().sql : 'Não disponível'}`);
        const result = await query;
        console.log(`Encontrados ${result.length} produtos`);
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
  
  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
  }
  
  async updateProduct(id: number, productUpdate: Partial<InsertProduct>): Promise<Product | undefined> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
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
      console.log(`DB: Buscando produtos para o catálogo ${catalogId}...`);
      // REVERTIDO: Selecionar todas as colunas, incluindo embedding
      const result = await db.select().from(products)
        .where(eq(products.catalogId, catalogId));
      console.log(`DB: Encontrados ${result.length} produtos para o catálogo ${catalogId}`);
      return result;
    } catch (error) {
      console.error('Error getting products by catalogId:', error);
      return [];
    }
  }
  
  /**
   * Implementação de getProducts para compatibilidade com o que é usado em routes.ts
   * Esta função é um alias para getProductsByUserId mas com nome mais genérico
   */
  async getProducts(userId: number, catalogId?: number): Promise<Product[]> {
    return this.getProductsByUserId(userId, catalogId);
  }
  
  async getProductsByImageUrl(imageUrl: string): Promise<Product[]> {
    try {
      console.log(`DB: Buscando produtos que usam a imagem: ${imageUrl}`);
      // REVERTIDO: Selecionar todas as colunas, incluindo embedding
      const result = await db.select().from(products)
        .where(eq(products.imageUrl, imageUrl));
      console.log(`DB: Encontrados ${result.length} produtos que usam a mesma imagem: ${imageUrl}`);
      return result;
    } catch (error) {
      console.error('Error getting products by imageUrl:', error);
      return [];
    }
  }
  
  /**
   * Atualiza apenas a URL da imagem de um produto
   */
  async updateProductImageUrl(id: number, imageUrl: string): Promise<Product | undefined> {
    try {
      console.log(`DB: Atualizando URL da imagem do produto ${id} para: ${imageUrl}`);
      const [product] = await db.update(products)
        .set({ imageUrl: imageUrl, isEdited: true })
        .where(eq(products.id, id))
        .returning();
      
      console.log(`DB: URL da imagem atualizada com sucesso para o produto ${id}`);
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
  
  // Catalog methods
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
      console.log(`Usando userId: ${parsedUserId} para buscar catálogos`);
      
      const results = await db.select().from(catalogs).where(eq(catalogs.userId, parsedUserId));
      console.log(`Encontrados ${results.length} catálogos`);
      return results;
    } catch (error) {
      console.error('Error getting catalogs by user ID:', error);
      return [];
    }
  }
  
  // Método para obter todos os catálogos de um usuário (alias para compatibilidade)
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
      const updateData = { processedStatus: status };
      const [catalog] = await db.update(catalogs)
        .set(updateData)
        .where(eq(catalogs.id, id))
        .returning();
      return catalog;
    } catch (error) {
      console.error('Error updating catalog status:', error);
      return undefined;
    }
  }
  
  async updateCatalog(id: number, updateDataInput: Partial<InsertCatalog>): Promise<Catalog | undefined> {
    try {
      const { firebaseUserId, firestoreCatalogId, ...updateData } = updateDataInput;
      const [catalog] = await db.update(catalogs)
        .set(updateData)
        .where(eq(catalogs.id, id))
        .returning();
      return catalog;
    } catch (error) {
      console.error('Error updating catalog:', error);
      return undefined;
    }
  }
  
  async deleteCatalog(id: number): Promise<boolean> {
    try {
      // Primeiro, excluir todos os produtos associados
      await this.deleteProductsByCatalogId(id);
      
      // Depois, excluir o catálogo
      const result = await db.delete(catalogs).where(eq(catalogs.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting catalog:', error);
      return false;
    }
  }
  
  // Quote methods
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
  
  /**
   * Alias para getQuotesByUserId mantendo compatibilidade com a nomenclatura em routes.ts
   */
  async getQuotes(userId: number): Promise<Quote[]> {
    return this.getQuotesByUserId(userId);
  }
  
  async createQuote(insertQuote: InsertQuote): Promise<Quote> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
  }
  
  async updateQuote(id: number, quoteUpdate: Partial<InsertQuote>): Promise<Quote | undefined> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
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
  
  // Moodboard methods
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
      return await db.select().from(moodboards).where(eq(moodboards.userId, userId));
    } catch (error) {
      console.error('Error getting moodboards by user ID:', error);
      return [];
    }
  }
  
  /**
   * Alias para getMoodboardsByUserId mantendo compatibilidade com a nomenclatura em routes.ts
   */
  async getMoodboards(userId: number): Promise<Moodboard[]> {
    return this.getMoodboardsByUserId(userId);
  }
  
  async createMoodboard(insertMoodboard: InsertMoodboard): Promise<Moodboard> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
  }
  
  async updateMoodboard(id: number, moodboardUpdate: Partial<InsertMoodboard>): Promise<Moodboard | undefined> {
    throw new Error("Method temporarily disabled due to unresolved Drizzle type issues.");
  }
  
  async deleteMoodboard(id: number): Promise<boolean> {
    try {
      const result = await db.delete(moodboards).where(eq(moodboards.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting moodboard:', error);
      return false;
    }
  }
  
  // Search products
  async searchProducts(userId: number | string, searchText: string): Promise<Product[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      console.log(`DB: Buscando produtos para userId=${parsedUserId} com texto: "${searchText}"`);

      const searchTerms = searchText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, ' ') // Substituir não alfanuméricos por espaço
        .split(' ')
        .filter(term => term.length > 2); // Filtrar palavras curtas
        // TODO: Poderia remover stopwords (de, a, o, com, etc.)

      if (searchTerms.length === 0) {
        console.log("DB: Nenhum termo de busca válido após processamento.");
        return [];
      }

      console.log("DB: Termos de busca processados:", searchTerms);

      // REVERTIDO: Selecionar todas as colunas, incluindo embedding
      const searchConditions = or(
        ...searchTerms.map(term => ilike(products.name, `%${term}%`)),
        ...searchTerms.map(term => ilike(products.description, `%${term}%`))
      );

      const results = await db.select()
        .from(products)
        .where(and(
            eq(products.userId, parsedUserId),
            searchConditions 
        ))
        .limit(20); 

      console.log(`DB: Encontrados ${results.length} produtos na busca textual.`); // Ajustado log message
      return results;

    } catch (error) {
      console.error('Error searching products:', error);
      return [];
    }
  }

  // Nova função para busca mais relevante
  async findRelevantProducts(userId: number, description: string): Promise<Product[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      console.log(`DB: Buscando produtos relevantes para userId=${parsedUserId} com descrição: "${description}"`);

      const searchTerms = description
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(' ')
        .filter(term => term.length > 1); // Manter termos com 2+ chars

      if (searchTerms.length === 0) {
        console.log("DB: Nenhum termo de busca válido após processamento para busca relevante.");
        return [];
      }

      console.log("DB: Termos de busca relevantes processados:", searchTerms);

      // REVERTIDO: Selecionar todas as colunas, incluindo embedding
      const searchConditions = or(
        ...searchTerms.map(term => ilike(products.name, `%${term}%`)),
        ...searchTerms.map(term => ilike(products.description, `%${term}%`)),
        ...searchTerms.map(term => ilike(products.category, `%${term}%`))
      );

      const results = await db.select()
        .from(products)
        .where(and(
            eq(products.userId, parsedUserId),
            searchConditions
        ))
        .limit(10); 

      console.log(`DB: Encontrados ${results.length} produtos relevantes.`);
      // Aqui poderíamos adicionar lógica de ranking no futuro
      return results;

    } catch (error) {
      console.error('Error finding relevant products:', error);
      return [];
    }
  }

  /**
   * Busca detalhes de múltiplos produtos por seus IDs.
   * @param productIds Array de IDs dos produtos.
   * @returns Um objeto onde as chaves são os IDs e os valores são os dados dos produtos.
   */
  async getProductsDetails(productIds: number[]): Promise<Record<number, Product>> {
    if (!productIds || productIds.length === 0) {
      return {};
    }
    try {
      console.log(`DB: Buscando detalhes para ${productIds.length} produtos... IDs: ${productIds.join(', ')}`);
      if (productIds.length === 0) return {}; 
      
      // REVERTIDO: Selecionar todas as colunas, incluindo embedding
      const results = await db.select()
        .from(products)
        .where(inArray(products.id, productIds)); 
      
      const detailsMap: Record<number, Product> = {};
      for (const product of results) {
        detailsMap[product.id] = product;
      }
      
      console.log(`DB: Detalhes encontrados para ${Object.keys(detailsMap).length} produtos.`);
      return detailsMap;
    } catch (error) {
      console.error('Error getting products details:', error);
      return {}; 
    }
  }

  // Design Projects methods (RENOMEADOS E ATUALIZADOS CONFORME A INTERFACE)
  async getDesignProject(id: number): Promise<DesignProject | undefined> {
    try {
      const [project] = await db.select().from(designProjects).where(eq(designProjects.id, id));
      return project;
    } catch (error) {
      console.error('Error getting Design project:', error);
      return undefined;
    }
  }
  
  async getAllDesignProjects(userId: number | string): Promise<DesignProject[]> {
    try {
      const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
      return await db.select().from(designProjects).where(eq(designProjects.userId, parsedUserId));
    } catch (error) {
      console.error('Error getting all Design projects:', error);
      return [];
    }
  }
  
  async createDesignProject(insertProject: NewDesignProject): Promise<DesignProject> {
    try {
      // O schema designProjects já tem default para status, createdAt, updatedAt.
      const [project] = await db.insert(designProjects).values(insertProject).returning();
      return project;
    } catch (error) {
      console.error('Error creating Design project:', error);
      throw error;
    }
  }
  
  async updateDesignProject(id: number, projectUpdate: Partial<NewDesignProject>): Promise<DesignProject | undefined> {
    try {
      const updateData = {
        ...projectUpdate,
        updatedAt: new Date(), // Garante que updatedAt seja atualizado
      };
      // Se 'id' estiver em projectUpdate, ele não deve ser passado para o 'set'
      if ('id' in updateData) delete (updateData as any).id;

      const [project] = await db.update(designProjects)
        .set(updateData)
        .where(eq(designProjects.id, id))
        .returning();
      return project;
    } catch (error) {
      console.error('Error updating Design project:', error);
      return undefined;
    }
  }
  
  async deleteDesignProject(id: number): Promise<void> {
    try {
      // onDelete: "cascade" no schema para designProjectItems deve cuidar de deletar itens associados.
      // Para aiDesignChatMessages, se projectId se refere a designProjects.id, eles precisariam ser deletados manualmente se não houver cascade.
      const messagesToDelete = await db.select({id: aiDesignChatMessages.id}).from(aiDesignChatMessages).where(eq(aiDesignChatMessages.projectId, id));
      if (messagesToDelete.length > 0) {
        await db.delete(aiDesignChatMessages).where(inArray(aiDesignChatMessages.id, messagesToDelete.map(m => m.id!)));
      }
      await db.delete(designProjects).where(eq(designProjects.id, id));
    } catch (error) {
      console.error('Error deleting Design project:', error);
    }
  }

  // Design Project Items methods
  async getDesignProjectItems(projectId: number): Promise<DesignProjectItem[]> {
    try {
      return await db.select().from(designProjectItems).where(eq(designProjectItems.designProjectId, projectId));
    } catch (error) {
      console.error('Error getting design project items:', error);
      return [];
    }
  }
  
  // AI Design Chat Messages methods
  async getAiDesignChatMessages(projectId: number): Promise<AiDesignChatMessage[]> {
    try {
      return await db.select().from(aiDesignChatMessages).where(eq(aiDesignChatMessages.projectId, projectId));
    } catch (error) {
      console.error('Error getting AI design chat messages:', error);
      return [];
    }
  }
  
  async createAiDesignChatMessage(insertMessage: InsertAiDesignChatMessage): Promise<AiDesignChatMessage> {
    try {
      const [message] = await db.insert(aiDesignChatMessages).values(insertMessage).returning();
      return message;
    } catch (error) {
      console.error('Error creating AI design chat message:', error);
      throw error;
    }
  }

  // <<< IMPLEMENTAÇÃO ADICIONADA AQUI >>>
  async createDesignProjectItem(insertItem: NewDesignProjectItem): Promise<DesignProjectItem> {
    try {
      const [item] = await db.insert(designProjectItems).values(insertItem).returning();
      return item;
    } catch (error) {
      console.error('Error creating Design project item:', error);
      throw error;
    }
  }

  // <<< NOVO MÉTODO ADICIONADO AQUI >>>
  async findProductsByEmbedding(userId: number, imageEmbeddingVector: number[], limit: number = 5): Promise<Product[]> {
    if (!imageEmbeddingVector || imageEmbeddingVector.length === 0) {
      console.warn("[Storage.findProductsByEmbedding] Vetor de embedding da imagem está vazio. Retornando array vazio.");
      return [];
    }
    // CORREÇÃO: pgvector espera o vetor como uma string [f1,f2,f3...], sem aspas simples externas.
    const embeddingStringInput = `[${imageEmbeddingVector.join(',')}]`;

    console.log(`[Storage.findProductsByEmbedding] Buscando produtos para userId: ${userId} com similaridade de embedding. Limite: ${limit}.`);
    // console.log(`[Storage.findProductsByEmbedding] Embedding da imagem (parcial): ${embeddingStringInput.substring(0,100)}...`);

    try {
      const similarProducts = await db.select()
        .from(products)
        .where(and(
          eq(products.userId, userId),
          isNotNull(products.embedding) 
        ))
        // Passar a string diretamente. O driver/Drizzle deve lidar com as aspas da query SQL.
        // Se pgvector exigir um CAST explícito, seria .orderBy(sql`${products.embedding} <-> CAST(${embeddingStringInput} AS vector)`)
        // Ou, mais simples, se o driver/Drizzle for inteligente: .orderBy(sql`${products.embedding} <-> ${embeddingStringInput}`)
        .orderBy(sql`${products.embedding} <-> ${embeddingStringInput}`) 
        .limit(limit);

      console.log(`[Storage.findProductsByEmbedding] Encontrados ${similarProducts.length} produtos por similaridade de embedding.`);
      return similarProducts;
    } catch (error) {
      console.error(`[Storage.findProductsByEmbedding] Erro ao buscar produtos por embedding para userId ${userId}:`, error);
      return [];
    }
  }
}

// Usar APENAS DatabaseStorage
export const storage = new DatabaseStorage();
