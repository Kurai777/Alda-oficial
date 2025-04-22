import { pgTable, text, serial, integer, boolean, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  companyName: text("company_name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
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
  category: text("category"),
  imageUrl: text("image_url"),
  colors: json("colors").$type<string[]>().default([]),
  materials: json("materials").$type<string[]>().default([]),
  sizes: json("sizes").$type<{width?: number, height?: number, depth?: number, label?: string}[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProductSchema = createInsertSchema(products).pick({
  userId: true,
  catalogId: true,
  name: true,
  code: true,
  description: true,
  price: true,
  category: true,
  imageUrl: true,
  colors: true,
  materials: true,
  sizes: true,
});

export const catalogs = pgTable("catalogs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  processedStatus: text("processed_status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCatalogSchema = createInsertSchema(catalogs).pick({
  userId: true,
  fileName: true,
  fileUrl: true,
  processedStatus: true,
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
