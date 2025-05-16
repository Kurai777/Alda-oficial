/**
 * Tipos utilizados na aplicação
 */

// Reexportar todos os tipos de dados principais do schema compartilhado.
// Isso evita duplicação e garante que o frontend use os tipos corretos.
export type { 
    User, 
    Product, 
    Catalog, 
    Quote, 
    Moodboard, 
    AiDesignProject, 
    AiDesignChatMessage, 
    DesignProject, 
    DesignProjectItem,
    FloorPlan,
    // Adicionar outros tipos do @shared/schema que o frontend possa precisar
    InsertUser, 
    InsertProduct,
    InsertCatalog,
    InsertQuote,
    InsertMoodboard,
    InsertAiDesignProject,
    InsertAiDesignChatMessage,
    InsertFloorPlan
} from '@shared/schema';

// Você pode adicionar tipos específicos do frontend aqui também, se necessário
// export interface CustomFrontendType {
//   id: string;
//   details: string;
// }

// Manter QuoteItem se for um tipo específico do frontend para estruturar os itens de um orçamento na UI,
// e não existir diretamente em @shared/schema ou se o de lá for diferente.
// Se @shared/schema > quotes.items já tem a estrutura correta, esta definição manual pode não ser necessária.
export interface QuoteItem {
  id: string; // uuid para o item no frontend antes de salvar
  productId: number;
  productName: string;
  productCode: string;
  quantity: number;
  price: number; // Preço unitário em centavos
  color?: string;
  size?: string;
}

// As definições manuais de User, Product, Catalog, Quote, Moodboard, AiDesignProject, AiDesignChatMessage
// foram removidas para usar as reexportadas de @shared/schema.

// Quaisquer outros tipos específicos APENAS para o frontend podem ser definidos abaixo.
// Exemplo:
// export interface FrontendSpecificUIState {
//   isSidebarOpen: boolean;
// }