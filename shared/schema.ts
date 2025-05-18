import { pgTable, text, serial, integer, boolean, json, jsonb, timestamp, varchar, uuid, real, vector, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Definição do tipo customizado para tsvector
const tsvectorType = customType<{ data: string, driverData: string }>({
    dataType() {
        return 'tsvector';
    },
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name"),
  companyName: text("company_name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  companyLogoUrl: text("company_logo_url"),
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyCnpj: text("company_cnpj"),
  quotePaymentTerms: text("quote_payment_terms"),
  quoteValidityDays: integer("quote_validity_days"),
  cashDiscountPercentage: integer("cash_discount_percentage"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  companyName: true,
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  catalogId: integer("catalog_id"),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // price in cents
  category: text("category"), // Segmento (sofá, home, poltrona, etc.)
  manufacturer: text("manufacturer"), // Fabricante (Sierra, Estúdio Bola, etc.)
  imageUrl: text("image_url"),
  colors: json("colors").$type<string[]>().default([]),
  materials: json("materials").$type<string[]>().default([]),
  sizes: json("sizes").$type<{width?: number, height?: number, depth?: number, label?: string}[]>().default([]),
  location: text("location"), // Localização do produto (ex: 2º Piso, Depósito, etc)
  stock: integer("stock"), // Quantidade em estoque
  excelRowNumber: integer("excel_row_number"), // Número da linha original no Excel
  embedding: vector('embedding', { dimensions: 1536 }),
  search_tsv: tsvectorType('search_tsv'),
  createdAt: timestamp("created_at").defaultNow(),
  firestoreId: text("firestore_id"), // ID do produto no Firestore
  firebaseUserId: text("firebase_user_id"), // ID do usuário no Firebase
  isEdited: boolean("is_edited").default(false), // Indica se o produto foi editado manualmente
});

export const insertProductSchema = createInsertSchema(products).pick({
  userId: true,
  catalogId: true,
  name: true,
  code: true,
  description: true,
  price: true,
  category: true,
  manufacturer: true,
  imageUrl: true,
  colors: true,
  materials: true,
  sizes: true,
  location: true,  // Localização física do produto
  stock: true,     // Quantidade em estoque
  excelRowNumber: true, // Número da linha original no Excel
  firestoreId: true,
  firebaseUserId: true,
  isEdited: true,
});

export const catalogs = pgTable("catalogs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  processedStatus: text("processed_status").default("pending"),
  firestoreCatalogId: text("firestore_catalog_id"),
  firebaseUserId: text("firebase_user_id"), // ID do usuário no Firebase
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCatalogSchema = createInsertSchema(catalogs).pick({
  userId: true,
  fileName: true,
  fileUrl: true,
  processedStatus: true,
  firestoreCatalogId: true,
  firebaseUserId: true,
});

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  architectName: text("architect_name"),
  notes: text("notes"),
  items: json("items").$type<{
    productId: number,
    productName: string,
    productCode: string,
    color: string,
    size: string,
    price: number
  }[]>().notNull(),
  totalPrice: integer("total_price").notNull(), // price in cents
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQuoteSchema = createInsertSchema(quotes).pick({
  userId: true,
  clientName: true,
  clientEmail: true,
  clientPhone: true,
  architectName: true,
  notes: true,
  items: true,
  totalPrice: true,
  fileUrl: true,
});

export const moodboards = pgTable("moodboards", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  quoteId: integer("quote_id"),
  projectName: text("project_name").notNull(),
  clientName: text("client_name"),
  architectName: text("architect_name"),
  fileUrl: text("file_url"),
  productIds: json("product_ids").$type<number[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  description: text("description"),
  style: text("style"),
  colorPalette: json("color_palette").$type<string[]>(),
  generatedImageUrl: text("generated_image_url"),
  iaPrompt: text("ia_prompt"),
  status: text("status"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMoodboardSchema = createInsertSchema(moodboards, {
}).omit({ id: true, createdAt: true, updatedAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Catalog = typeof catalogs.$inferSelect;
export type InsertCatalog = z.infer<typeof insertCatalogSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Moodboard = typeof moodboards.$inferSelect;
export type InsertMoodboard = z.infer<typeof insertMoodboardSchema>;

// AI Design Projects
export const aiDesignProjects = pgTable("ai_design_projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  floorPlanImageUrl: text("floor_plan_image_url"),
  renderImageUrl: text("render_image_url"),
  generatedFloorPlanUrl: text("generated_floor_plan_url"),
  generatedRenderUrl: text("generated_render_url"),
  quoteId: integer("quote_id").references(() => quotes.id),
  moodboardId: integer("moodboard_id").references(() => moodboards.id),
});

// AI Design Chat Messages
export const aiDesignChatMessages = pgTable("ai_design_chat_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => designProjects.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  role: text("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  attachmentUrl: text("attachment_url"),
});

// Create insert schemas
export const insertAiDesignProjectSchema = createInsertSchema(aiDesignProjects).pick({
  userId: true,
  title: true,
  floorPlanImageUrl: true,
  renderImageUrl: true,
  quoteId: true,
  moodboardId: true,
});

export const insertAiDesignChatMessageSchema = createInsertSchema(aiDesignChatMessages).pick({
  projectId: true,
  role: true,
  content: true,
  attachmentUrl: true,
});

// Type exports
export type AiDesignProject = typeof aiDesignProjects.$inferSelect;
export type InsertAiDesignProject = z.infer<typeof insertAiDesignProjectSchema>;
export type AiDesignChatMessage = typeof aiDesignChatMessages.$inferSelect;
export type InsertAiDesignChatMessage = z.infer<typeof insertAiDesignChatMessageSchema>;

export const session = pgTable("session", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { mode: 'date', withTimezone: true }).notNull(),
});

// Novas tabelas para a funcionalidade de Design com IA

export const designProjects = pgTable("design_projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("new"), // Ex: new, processing, awaiting_selection, completed
  clientRenderImageUrl: text("client_render_image_url"),
  clientFloorPlanImageUrl: text("client_floor_plan_image_url"), // Opcional
  generatedRenderUrl: text("generated_render_url"), // URL do render final gerado pela IA
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DesignProject = typeof designProjects.$inferSelect;
export type NewDesignProject = typeof designProjects.$inferInsert;

export const designProjectItems = pgTable("design_project_items", {
  id: serial("id").primaryKey(),
  designProjectId: integer("design_project_id")
    .notNull()
    .references(() => designProjects.id, { onDelete: "cascade" }),
  
  detectedObjectName: text("detected_object_name"), // Nome do objeto detectado pela IA
  detectedObjectDescription: text("detected_object_description"), // Descrição da IA sobre o objeto
  detectedObjectBoundingBox: jsonb("detected_object_bounding_box"), // Alterado para jsonb conforme recomendação

  // Podemos ter uma lista de sugestões ou campos separados. Começando com 3.
  suggestedProductId1: integer("suggested_product_id_1").references(() => products.id, { onDelete: "set null" }), // Assume que a tabela 'products' já existe
  matchScore1: real("match_score_1"), // Similaridade da sugestão 1

  suggestedProductId2: integer("suggested_product_id_2").references(() => products.id, { onDelete: "set null" }),
  matchScore2: real("match_score_2"),

  suggestedProductId3: integer("suggested_product_id_3").references(() => products.id, { onDelete: "set null" }),
  matchScore3: real("match_score_3"),

  selectedProductId: integer("selected_product_id").references(() => products.id, { onDelete: "set null" }), // Produto escolhido pelo usuário
  
  userFeedback: text("user_feedback"), // Ex: "good_match", "bad_match", "notes: ..."
  generatedInpaintedImageUrl: text("generated_inpainted_image_url"), // URL da imagem gerada com inpainting
  notes: text("notes"), // Adicionado para anotações do usuário sobre o item

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DesignProjectItem = typeof designProjectItems.$inferSelect;
export type NewDesignProjectItem = typeof designProjectItems.$inferInsert;

// Adicionar relações
export const designProjectsRelations = relations(designProjects, ({ many, one }) => ({
  items: many(designProjectItems),
  user: one(users, { // Assume que a tabela 'users' e seu objeto de relações já existem
    fields: [designProjects.userId],
    references: [users.id],
  }),
}));

export const designProjectItemsRelations = relations(designProjectItems, ({ one }) => ({
  project: one(designProjects, {
    fields: [designProjectItems.designProjectId],
    references: [designProjects.id],
  }),
  suggestedProduct1: one(products, { // Assume que a tabela 'products' e seu objeto de relações já existem
    fields: [designProjectItems.suggestedProductId1],
    references: [products.id],
    relationName: "suggestedProduct1",
  }),
  suggestedProduct2: one(products, {
    fields: [designProjectItems.suggestedProductId2],
    references: [products.id],
    relationName: "suggestedProduct2",
  }),
  suggestedProduct3: one(products, {
    fields: [designProjectItems.suggestedProductId3],
    references: [products.id],
    relationName: "suggestedProduct3",
  }),
  selectedProduct: one(products, {
    fields: [designProjectItems.selectedProductId],
    references: [products.id],
    relationName: "selectedProduct",
  }),
}));

// Definições para Floor Plans e Floor Plan Areas (Adicionadas para sincronizar com BD)
export const floorPlans = pgTable("floor_plans", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), 
  aiDesignProjectId: integer("ai_design_project_id").references(() => aiDesignProjects.id, { onDelete: "set null" }), 
  name: text("name").notNull(),
  originalImageUrl: text("original_image_url").notNull(),
  processedImageUrl: text("processed_image_url"), 
  iaPrompt: text("ia_prompt"), 
  iaStatus: text("ia_status").notNull().default("pending_upload"), 
  processingErrors: text("processing_errors"), 
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FloorPlan = typeof floorPlans.$inferSelect;
export type InsertFloorPlan = typeof floorPlans.$inferInsert;
export const insertFloorPlanSchema = createInsertSchema(floorPlans).omit({ id: true, createdAt: true, updatedAt: true });

export const floorPlanAreas = pgTable("floor_plan_areas", {
  id: serial("id").primaryKey(),
  floorPlanId: integer("floor_plan_id").notNull().references(() => floorPlans.id, { onDelete: "cascade" }), 
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), 
  areaName: text("area_name").notNull(),
  coordinates: json("coordinates"), // Definir $type se a estrutura for conhecida, ex: .$type<{x:number, y:number, w:number, h:number}>()
  desiredProductType: text("desired_product_type"), 
  suggestedProductId: integer("suggested_product_id").references(() => products.id, { onDelete: "set null" }), 
  notes: text("notes"), 
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FloorPlanArea = typeof floorPlanAreas.$inferSelect;
export type InsertFloorPlanArea = typeof floorPlanAreas.$inferInsert;
export const insertFloorPlanAreaSchema = createInsertSchema(floorPlanAreas).omit({ id: true, createdAt: true, updatedAt: true });

// Adicionar relações para floorPlans e floorPlanAreas se necessário
// Exemplo:
// export const floorPlansRelations = relations(floorPlans, ({one, many}) => ({
//   user: one(users, { fields: [floorPlans.userId], references: [users.id] }),
//   aiDesignProject: one(aiDesignProjects, { fields: [floorPlans.aiDesignProjectId], references: [aiDesignProjects.id]}),
//   areas: many(floorPlanAreas),
// }));

// export const floorPlanAreasRelations = relations(floorPlanAreas, ({one}) => ({
//   floorPlan: one(floorPlans, { fields: [floorPlanAreas.floorPlanId], references: [floorPlans.id]}),
//   user: one(users, { fields: [floorPlanAreas.userId], references: [users.id] }),
//   suggestedProduct: one(products, { fields: [floorPlanAreas.suggestedProductId], references: [products.id]}),
// }));
