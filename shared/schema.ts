import { pgTable, text, serial, integer, boolean, json, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
});

export const insertMoodboardSchema = createInsertSchema(moodboards).pick({
  userId: true,
  quoteId: true,
  projectName: true,
  clientName: true,
  architectName: true,
  fileUrl: true,
  productIds: true,
});

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
  projectId: integer("project_id").references(() => aiDesignProjects.id).notNull(),
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
