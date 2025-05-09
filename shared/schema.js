"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.designProjectItemsRelations = exports.designProjectsRelations = exports.designProjectItems = exports.designProjects = exports.session = exports.insertAiDesignChatMessageSchema = exports.insertAiDesignProjectSchema = exports.aiDesignChatMessages = exports.aiDesignProjects = exports.insertMoodboardSchema = exports.moodboards = exports.insertQuoteSchema = exports.quotes = exports.insertCatalogSchema = exports.catalogs = exports.insertProductSchema = exports.products = exports.insertUserSchema = exports.users = void 0;
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    email: (0, pg_core_1.text)("email").notNull().unique(),
    password: (0, pg_core_1.text)("password").notNull(),
    name: (0, pg_core_1.text)("name"),
    companyName: (0, pg_core_1.text)("company_name").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow(),
    companyLogoUrl: (0, pg_core_1.text)("company_logo_url"),
    companyAddress: (0, pg_core_1.text)("company_address"),
    companyPhone: (0, pg_core_1.text)("company_phone"),
    companyCnpj: (0, pg_core_1.text)("company_cnpj"),
    quotePaymentTerms: (0, pg_core_1.text)("quote_payment_terms"),
    quoteValidityDays: (0, pg_core_1.integer)("quote_validity_days"),
    cashDiscountPercentage: (0, pg_core_1.integer)("cash_discount_percentage"),
});
exports.insertUserSchema = (0, drizzle_zod_1.createInsertSchema)(exports.users).pick({
    email: true,
    password: true,
    name: true,
    companyName: true,
});
exports.products = (0, pg_core_1.pgTable)("products", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id").notNull(),
    catalogId: (0, pg_core_1.integer)("catalog_id"),
    name: (0, pg_core_1.text)("name").notNull(),
    code: (0, pg_core_1.text)("code").notNull(),
    description: (0, pg_core_1.text)("description"),
    price: (0, pg_core_1.integer)("price").notNull(), // price in cents
    category: (0, pg_core_1.text)("category"), // Segmento (sofá, home, poltrona, etc.)
    manufacturer: (0, pg_core_1.text)("manufacturer"), // Fabricante (Sierra, Estúdio Bola, etc.)
    imageUrl: (0, pg_core_1.text)("image_url"),
    colors: (0, pg_core_1.json)("colors").$type().default([]),
    materials: (0, pg_core_1.json)("materials").$type().default([]),
    sizes: (0, pg_core_1.json)("sizes").$type().default([]),
    location: (0, pg_core_1.text)("location"), // Localização do produto (ex: 2º Piso, Depósito, etc)
    stock: (0, pg_core_1.integer)("stock"), // Quantidade em estoque
    excelRowNumber: (0, pg_core_1.integer)("excel_row_number"), // Número da linha original no Excel
    embedding: (0, pg_core_1.vector)('embedding', { dimensions: 1536 }),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
    firestoreId: (0, pg_core_1.text)("firestore_id"), // ID do produto no Firestore
    firebaseUserId: (0, pg_core_1.text)("firebase_user_id"), // ID do usuário no Firebase
    isEdited: (0, pg_core_1.boolean)("is_edited").default(false), // Indica se o produto foi editado manualmente
});
exports.insertProductSchema = (0, drizzle_zod_1.createInsertSchema)(exports.products).pick({
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
    location: true, // Localização física do produto
    stock: true, // Quantidade em estoque
    excelRowNumber: true, // Número da linha original no Excel
    firestoreId: true,
    firebaseUserId: true,
    isEdited: true,
});
exports.catalogs = (0, pg_core_1.pgTable)("catalogs", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id").notNull(),
    fileName: (0, pg_core_1.text)("file_name").notNull(),
    fileUrl: (0, pg_core_1.text)("file_url").notNull(),
    processedStatus: (0, pg_core_1.text)("processed_status").default("pending"),
    firestoreCatalogId: (0, pg_core_1.text)("firestore_catalog_id"),
    firebaseUserId: (0, pg_core_1.text)("firebase_user_id"), // ID do usuário no Firebase
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
});
exports.insertCatalogSchema = (0, drizzle_zod_1.createInsertSchema)(exports.catalogs).pick({
    userId: true,
    fileName: true,
    fileUrl: true,
    processedStatus: true,
    firestoreCatalogId: true,
    firebaseUserId: true,
});
exports.quotes = (0, pg_core_1.pgTable)("quotes", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id").notNull(),
    clientName: (0, pg_core_1.text)("client_name").notNull(),
    clientEmail: (0, pg_core_1.text)("client_email"),
    clientPhone: (0, pg_core_1.text)("client_phone"),
    architectName: (0, pg_core_1.text)("architect_name"),
    notes: (0, pg_core_1.text)("notes"),
    items: (0, pg_core_1.json)("items").$type().notNull(),
    totalPrice: (0, pg_core_1.integer)("total_price").notNull(), // price in cents
    fileUrl: (0, pg_core_1.text)("file_url"),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
});
exports.insertQuoteSchema = (0, drizzle_zod_1.createInsertSchema)(exports.quotes).pick({
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
exports.moodboards = (0, pg_core_1.pgTable)("moodboards", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id").notNull(),
    quoteId: (0, pg_core_1.integer)("quote_id"),
    projectName: (0, pg_core_1.text)("project_name").notNull(),
    clientName: (0, pg_core_1.text)("client_name"),
    architectName: (0, pg_core_1.text)("architect_name"),
    fileUrl: (0, pg_core_1.text)("file_url"),
    productIds: (0, pg_core_1.json)("product_ids").$type().notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
});
exports.insertMoodboardSchema = (0, drizzle_zod_1.createInsertSchema)(exports.moodboards).pick({
    userId: true,
    quoteId: true,
    projectName: true,
    clientName: true,
    architectName: true,
    fileUrl: true,
    productIds: true,
});
// AI Design Projects
exports.aiDesignProjects = (0, pg_core_1.pgTable)("ai_design_projects", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id").notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
    title: (0, pg_core_1.text)("title").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("pending"), // pending, processing, completed, failed
    floorPlanImageUrl: (0, pg_core_1.text)("floor_plan_image_url"),
    renderImageUrl: (0, pg_core_1.text)("render_image_url"),
    generatedFloorPlanUrl: (0, pg_core_1.text)("generated_floor_plan_url"),
    generatedRenderUrl: (0, pg_core_1.text)("generated_render_url"),
    quoteId: (0, pg_core_1.integer)("quote_id").references(function () { return exports.quotes.id; }),
    moodboardId: (0, pg_core_1.integer)("moodboard_id").references(function () { return exports.moodboards.id; }),
});
// AI Design Chat Messages
exports.aiDesignChatMessages = (0, pg_core_1.pgTable)("ai_design_chat_messages", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    projectId: (0, pg_core_1.integer)("project_id").references(function () { return exports.aiDesignProjects.id; }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
    role: (0, pg_core_1.text)("role").notNull(), // user, assistant, system
    content: (0, pg_core_1.text)("content").notNull(),
    attachmentUrl: (0, pg_core_1.text)("attachment_url"),
});
// Create insert schemas
exports.insertAiDesignProjectSchema = (0, drizzle_zod_1.createInsertSchema)(exports.aiDesignProjects).pick({
    userId: true,
    title: true,
    floorPlanImageUrl: true,
    renderImageUrl: true,
    quoteId: true,
    moodboardId: true,
});
exports.insertAiDesignChatMessageSchema = (0, drizzle_zod_1.createInsertSchema)(exports.aiDesignChatMessages).pick({
    projectId: true,
    role: true,
    content: true,
    attachmentUrl: true,
});
exports.session = (0, pg_core_1.pgTable)("session", {
    sid: (0, pg_core_1.varchar)("sid", { length: 255 }).primaryKey(),
    sess: (0, pg_core_1.json)("sess").notNull(),
    expire: (0, pg_core_1.timestamp)("expire", { mode: 'date', withTimezone: true }).notNull(),
});
// Novas tabelas para a funcionalidade de Design com IA
exports.designProjects = (0, pg_core_1.pgTable)("design_projects", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    userId: (0, pg_core_1.integer)("user_id")
        .notNull()
        .references(function () { return exports.users.id; }, { onDelete: "cascade" }),
    name: (0, pg_core_1.text)("name").notNull(),
    status: (0, pg_core_1.text)("status").notNull().default("new"), // Ex: new, processing, awaiting_selection, completed
    clientRenderImageUrl: (0, pg_core_1.text)("client_render_image_url"),
    clientFloorPlanImageUrl: (0, pg_core_1.text)("client_floor_plan_image_url"), // Opcional
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});
exports.designProjectItems = (0, pg_core_1.pgTable)("design_project_items", {
    id: (0, pg_core_1.serial)("id").primaryKey(),
    designProjectId: (0, pg_core_1.integer)("design_project_id")
        .notNull()
        .references(function () { return exports.designProjects.id; }, { onDelete: "cascade" }),
    detectedObjectDescription: (0, pg_core_1.text)("detected_object_description"), // Descrição da IA sobre o objeto
    detectedObjectBoundingBox: (0, pg_core_1.json)("detected_object_bounding_box"), // MODIFICADO de jsonb para json para resolver linter error
    // Podemos ter uma lista de sugestões ou campos separados. Começando com 3.
    suggestedProductId1: (0, pg_core_1.integer)("suggested_product_id_1").references(function () { return exports.products.id; }, { onDelete: "set null" }), // Assume que a tabela 'products' já existe
    matchScore1: (0, pg_core_1.real)("match_score_1"), // Similaridade da sugestão 1
    suggestedProductId2: (0, pg_core_1.integer)("suggested_product_id_2").references(function () { return exports.products.id; }, { onDelete: "set null" }),
    matchScore2: (0, pg_core_1.real)("match_score_2"),
    suggestedProductId3: (0, pg_core_1.integer)("suggested_product_id_3").references(function () { return exports.products.id; }, { onDelete: "set null" }),
    matchScore3: (0, pg_core_1.real)("match_score_3"),
    selectedProductId: (0, pg_core_1.integer)("selected_product_id").references(function () { return exports.products.id; }, { onDelete: "set null" }), // Produto escolhido pelo usuário
    userFeedback: (0, pg_core_1.text)("user_feedback"), // Ex: "good_match", "bad_match", "notes: ..."
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});
// Adicionar relações
exports.designProjectsRelations = (0, drizzle_orm_1.relations)(exports.designProjects, function (_a) {
    var many = _a.many, one = _a.one;
    return ({
        items: many(exports.designProjectItems),
        user: one(exports.users, {
            fields: [exports.designProjects.userId],
            references: [exports.users.id],
        }),
    });
});
exports.designProjectItemsRelations = (0, drizzle_orm_1.relations)(exports.designProjectItems, function (_a) {
    var one = _a.one;
    return ({
        project: one(exports.designProjects, {
            fields: [exports.designProjectItems.designProjectId],
            references: [exports.designProjects.id],
        }),
        suggestedProduct1: one(exports.products, {
            fields: [exports.designProjectItems.suggestedProductId1],
            references: [exports.products.id],
            relationName: "suggestedProduct1",
        }),
        suggestedProduct2: one(exports.products, {
            fields: [exports.designProjectItems.suggestedProductId2],
            references: [exports.products.id],
            relationName: "suggestedProduct2",
        }),
        suggestedProduct3: one(exports.products, {
            fields: [exports.designProjectItems.suggestedProductId3],
            references: [exports.products.id],
            relationName: "suggestedProduct3",
        }),
        selectedProduct: one(exports.products, {
            fields: [exports.designProjectItems.selectedProductId],
            references: [exports.products.id],
            relationName: "selectedProduct",
        }),
    });
});
