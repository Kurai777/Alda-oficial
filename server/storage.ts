import { 
  users, type User, type InsertUser,
  products, type Product, type InsertProduct,
  catalogs, type Catalog, type InsertCatalog,
  quotes, type Quote, type InsertQuote,
  moodboards, type Moodboard, type InsertMoodboard
} from "@shared/schema";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Product methods
  getProduct(id: number): Promise<Product | undefined>;
  getProductsByUserId(userId: number, catalogId?: number): Promise<Product[]>;
  getProductsByCategory(userId: number, category: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;

  // Catalog methods
  getCatalog(id: number): Promise<Catalog | undefined>;
  getCatalogsByUserId(userId: number): Promise<Catalog[]>;
  createCatalog(catalog: InsertCatalog): Promise<Catalog>;
  updateCatalogStatus(id: number, status: string): Promise<Catalog | undefined>;

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
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private products: Map<number, Product>;
  private catalogs: Map<number, Catalog>;
  private quotes: Map<number, Quote>;
  private moodboards: Map<number, Moodboard>;
  
  private userId: number;
  private productId: number;
  private catalogId: number;
  private quoteId: number;
  private moodboardId: number;

  constructor() {
    this.users = new Map();
    this.products = new Map();
    this.catalogs = new Map();
    this.quotes = new Map();
    this.moodboards = new Map();
    
    this.userId = 1;
    this.productId = 1;
    this.catalogId = 1;
    this.quoteId = 1;
    this.moodboardId = 1;

    // Add demo user
    this.createUser({
      email: "demo@example.com",
      password: "password123",
      companyName: "Móveis Elegance"
    });
    
    // Add sample catalog
    const demoFratiniCatalog = {
      userId: 1,
      fileName: "Tabela Fratini - Fevereiro 2025.pdf",
      fileUrl: "/uploads/sample-fratini-catalog.pdf",
      processedStatus: "completed",
      createdAt: new Date()
    };
    const catalog = this.createCatalog(demoFratiniCatalog);
    
    // Add products from Tabela Fratini
    const fratiniProducts = [
      {
        userId: 1,
        catalogId: 1, // Associando ao catálogo Fratini
        name: "Banqueta Aviv",
        code: "1.00248.05",
        description: "Banqueta em Polipropileno. AA: 77cm",
        price: 29900, // R$ 299,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1581539250439-c96689b516dd?ixlib=rb-4.0.3",
        colors: ["Branco", "Preto", "Amarelo", "Vermelho", "Fendi"],
        materials: ["Polipropileno"],
        sizes: [{ height: 77, label: "4pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Banqueta Berlim Alta",
        code: "1.00250.05",
        description: "Banqueta em Aço com pintura automotiva. AA: 76cm",
        price: 17500, // R$ 175,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1595428774223-ef52624120d2?ixlib=rb-4.0.3",
        colors: ["Preto", "Branco", "Amarelo", "Vermelho", "Bronze"],
        materials: ["Aço"],
        sizes: [{ height: 76, label: "4pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Banqueta Berlim Alta com Encosto",
        code: "1.00242.05",
        description: "Banqueta em Aço com pintura automotiva. AA: 76cm",
        price: 18500, // R$ 185,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?ixlib=rb-4.0.3",
        colors: ["Preto", "Branco", "Amarelo", "Vermelho", "Bronze"],
        materials: ["Aço"],
        sizes: [{ height: 76, label: "4pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Banqueta Bristol",
        code: "1.00297.05",
        description: "Couro Ecológico (PU). Base em aço com pintura preta. Pistão com regulagem de altura",
        price: 30900, // R$ 309,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1625584681159-44e8a9431d0b?ixlib=rb-4.0.3",
        colors: ["Preto", "Caramelo"],
        materials: ["Couro Ecológico", "Aço"],
        sizes: [{ label: "2pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Banqueta Floripa",
        code: "1.00304.05",
        description: "Banqueta em Polipropileno. AA: 75cm",
        price: 32000, // R$ 320,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?ixlib=rb-4.0.3",
        colors: ["Preto", "Fendi", "Verde Aloe"],
        materials: ["Polipropileno"],
        sizes: [{ height: 75, label: "4pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Banqueta Ipanema Alta",
        code: "1.00305.05",
        description: "Assento em polipropileno com base em aço pintado na mesma tonalidade do assento. AA: 75cm",
        price: 28500, // R$ 285,00
        category: "Banquetas",
        imageUrl: "https://images.unsplash.com/photo-1585412727339-54e4bae3bbf9?ixlib=rb-4.0.3",
        colors: ["Preto", "Nude", "Verde Aloe", "Terracota"],
        materials: ["Polipropileno", "Aço"],
        sizes: [{ height: 75, label: "4pc/cx" }]
      },
      {
        userId: 1,
        catalogId: 1,
        name: "Cadeira Aviv",
        code: "1.00110.01",
        description: "Cadeira em Polipropileno",
        price: 15500, // R$ 155,00
        category: "Cadeiras",
        imageUrl: "https://images.unsplash.com/photo-1561677978-583a8c7a4b43?ixlib=rb-4.0.3",
        colors: ["Branco", "Preto", "Amarelo", "Vermelho", "Cinza", "Azul Marinho", "Fendi", "Laranja", "Verde Java", "Marrom Capuccino"],
        materials: ["Polipropileno"],
        sizes: [{ label: "4pc/cx" }]
      }
    ];
    
    // Adicionar os produtos da Fratini
    fratiniProducts.forEach(product => this.createProduct(product));

    // Add sample products
    const demoProducts = [
      {
        userId: 1,
        name: "Sofá Verde Moderno",
        code: "SOF-124",
        description: "Estofado em veludo • 3 lugares",
        price: 259990, // R$ 2.599,90
        category: "Sofás",
        imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80",
        colors: ["green", "blue", "yellow", "black"],
        materials: ["veludo"],
        sizes: [{ width: 220, height: 90, depth: 95, label: "3 lugares" }]
      },
      {
        userId: 1,
        name: "Mesa de Jantar Retangular",
        code: "MES-052",
        description: "Madeira maciça • 6 lugares",
        price: 179990, // R$ 1.799,90
        category: "Mesas",
        imageUrl: "https://images.unsplash.com/photo-1592078615290-033ee584e267?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1064&q=80",
        colors: ["brown", "dark-brown"],
        materials: ["madeira"],
        sizes: [{ width: 180, height: 78, depth: 90, label: "6 lugares" }]
      },
      {
        userId: 1,
        name: "Poltrona Aconchego",
        code: "POL-078",
        description: "Tecido • Reclinável",
        price: 89990, // R$ 899,90
        category: "Poltronas",
        imageUrl: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1772&q=80",
        colors: ["gray", "blue", "red"],
        materials: ["tecido"],
        sizes: [{ width: 80, height: 100, depth: 85, label: "Standard" }]
      },
      {
        userId: 1,
        name: "Estante Moderna",
        code: "EST-145",
        description: "MDF • 6 prateleiras",
        price: 129990, // R$ 1.299,90
        category: "Estantes",
        imageUrl: "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80",
        colors: ["white", "brown", "black"],
        materials: ["MDF"],
        sizes: [{ width: 120, height: 180, depth: 40, label: "Grande" }]
      },
      {
        userId: 1,
        name: "Cadeira Eames",
        code: "CAD-223",
        description: "Plástico e Metal • Design",
        price: 29990, // R$ 299,90
        category: "Cadeiras",
        imageUrl: "https://images.unsplash.com/photo-1540638349517-3abd5afc5847?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1287&q=80",
        colors: ["white", "black", "red", "blue", "green"],
        materials: ["plástico", "metal"],
        sizes: [{ width: 46, height: 82, depth: 50, label: "Standard" }]
      },
      {
        userId: 1,
        name: "Luminária de Mesa",
        code: "LUM-067",
        description: "Metal e Tecido • Regulável",
        price: 19990, // R$ 199,90
        category: "Iluminação",
        imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80",
        colors: ["gray", "white"],
        materials: ["metal", "tecido"],
        sizes: [{ height: 45, label: "Standard" }]
      }
    ];

    demoProducts.forEach(product => this.createProduct(product));
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

  async getProductsByUserId(userId: number, catalogId?: number): Promise<Product[]> {
    return Array.from(this.products.values()).filter(
      (product) => {
        // Filtrar sempre por userId
        let match = product.userId === userId;
        
        // Se catalogId foi especificado, filtre também por ele
        if (catalogId !== undefined && match) {
          match = product.catalogId === catalogId;
        }
        
        return match;
      }
    );
  }

  async getProductsByCategory(userId: number, category: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter(
      (product) => product.userId === userId && product.category === category
    );
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = this.productId++;
    const product: Product = { ...insertProduct, id, createdAt: new Date() };
    this.products.set(id, product);
    return product;
  }

  async updateProduct(id: number, productUpdate: Partial<InsertProduct>): Promise<Product | undefined> {
    const existingProduct = this.products.get(id);
    if (!existingProduct) return undefined;

    const updatedProduct = { ...existingProduct, ...productUpdate };
    this.products.set(id, updatedProduct);
    return updatedProduct;
  }

  async deleteProduct(id: number): Promise<boolean> {
    return this.products.delete(id);
  }

  // Catalog methods
  async getCatalog(id: number): Promise<Catalog | undefined> {
    return this.catalogs.get(id);
  }

  async getCatalogsByUserId(userId: number): Promise<Catalog[]> {
    return Array.from(this.catalogs.values()).filter(
      (catalog) => catalog.userId === userId
    );
  }

  async createCatalog(insertCatalog: InsertCatalog): Promise<Catalog> {
    const id = this.catalogId++;
    const catalog: Catalog = { ...insertCatalog, id, createdAt: new Date() };
    this.catalogs.set(id, catalog);
    return catalog;
  }

  async updateCatalogStatus(id: number, status: string): Promise<Catalog | undefined> {
    const existingCatalog = this.catalogs.get(id);
    if (!existingCatalog) return undefined;

    const updatedCatalog = { ...existingCatalog, processedStatus: status };
    this.catalogs.set(id, updatedCatalog);
    return updatedCatalog;
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
