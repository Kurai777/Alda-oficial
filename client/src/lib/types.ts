/**
 * Tipos utilizados na aplicação
 */

export interface User {
  id: number;
  email: string;
  companyName: string;
  createdAt: Date | string;
  firebaseId?: string;
}

export interface Product {
  id: number;
  userId: number;
  catalogId: number | null;
  name: string;
  code: string;
  description: string | null;
  price: number;
  category: string | null;
  imageUrl: string | null;
  colors: string[];
  materials: string[];
  sizes: Size[];
  createdAt: Date | string;
}

interface Size {
  width?: number;
  height?: number;
  depth?: number;
  label?: string;
}

export interface Catalog {
  id: number;
  userId: number;
  fileName: string;
  fileUrl: string;
  processedStatus: string;
  firestoreCatalogId?: string;
  productCount?: number;
  createdAt: Date | string;
}

export interface QuoteItem {
  productId: number;
  productName: string;
  productCode: string;
  color: string;
  size: string;
  price: number;
}

export interface Quote {
  id: number;
  userId: number;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  architectName: string | null;
  notes: string | null;
  items: QuoteItem[];
  totalPrice: number;
  fileUrl: string | null;
  createdAt: Date | string;
}

export interface Moodboard {
  id: number;
  userId: number;
  projectName: string;
  clientName: string | null;
  architectName: string | null;
  quoteId: number | null;
  fileUrl: string | null;
  productIds: number[];
  createdAt: Date | string;
}

export interface AiDesignProject {
  id: number;
  userId: number;
  title: string;
  status: "pending" | "processing" | "completed" | "error";
  floorPlanImageUrl: string | null;
  renderImageUrl: string | null;
  generatedFloorPlanUrl: string | null;
  generatedRenderUrl: string | null;
  quoteId: number | null;
  moodboardId: number | null;
  createdAt: Date | string;
}

export interface AiDesignChatMessage {
  id: number;
  projectId: number;
  role: "user" | "assistant" | "system";
  content: string;
  attachmentUrl: string | null;
  createdAt: Date | string;
}