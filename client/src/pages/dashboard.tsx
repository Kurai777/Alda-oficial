import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Product } from "@shared/schema";

import FilterSidebar from "@/components/filters/filter-sidebar";
import SearchSort from "@/components/catalog/search-sort";
import ProductCard from "@/components/catalog/product-card";
import QuoteGenerator from "@/components/quotes/quote-generator";
import VisualSearch from "@/components/catalog/visual-search";

interface QuoteItem {
  product: Product;
  color: string;
  size?: string;
  quantity: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [filters, setFilters] = useState<any>({
    categories: [],
    colors: [],
    materials: [],
    priceRange: [0, 100000],
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("relevance");
  const [view, setView] = useState<"grid" | "list">("grid");

  // BUSCAR APENAS OS PRODUTOS
  const { 
    data: products, 
    isLoading: isLoadingProducts,
    error: errorProducts
  } = useQuery<Product[]>({ 
    queryKey: ["/backend/products", user?.id],
    queryFn: async () => {
      console.log(`[Dashboard] Buscando TODOS os produtos do usuário ${user?.id}`);
      const response = await fetch(`/backend/products`);       
      if (!response.ok) {
        const errorText = await response.text(); 
        console.error(`[Dashboard] Erro HTTP buscando produtos: ${response.status}`, errorText);
        throw new Error(`Erro HTTP buscando produtos: ${response.status}`);
      }
      const data = await response.json();
      console.log(`[Dashboard] Produtos recebidos para o usuário ${user?.id}:`, data);
      return data;
    },
    enabled: !!user, 
    refetchOnWindowFocus: true,
  });

  // Adicionar log para verificar os produtos brutos recebidos
  // console.log("[Dashboard] Raw products received from query:", products);

  const handleAddToQuote = (product: Product, color: string) => {
    // Check if product is already in the quote
    const existingIndex = quoteItems.findIndex(
      (item) => item.product.id === product.id && item.color === color
    );

    if (existingIndex !== -1) {
      toast({
        title: "Produto já adicionado",
        description: "Este produto já está no orçamento",
      });
      return;
    }

    // Add product to quote
    setQuoteItems([...quoteItems, { product, color, quantity: 1 }]);

    toast({
      title: "Produto adicionado",
      description: `${product.name} foi adicionado ao orçamento`,
    });
  };

  const handleClearQuoteItems = () => {
    setQuoteItems([]);
  };

  const handleFiltersChange = (newFilters: any) => {
    setFilters(newFilters);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleSort = (option: string) => {
    setSortOption(option);
  };

  const handleViewChange = (newView: "grid" | "list") => {
    setView(newView);
  };

  // Filter and sort products
  const filteredProducts = products
    ? products
        .filter((product: Product) => {
          // Filter by search query
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
              product.name.toLowerCase().includes(query) ||
              (product.code && product.code.toLowerCase().includes(query)) ||
              (product.description && product.description.toLowerCase().includes(query))
            );
          }
          return true;
        })
        .filter((product: Product) => {
          // Filter by category
          if (filters.categories.length > 0) {
            return product.category && filters.categories.includes(product.category);
          }
          return true;
        })
        .filter((product: Product) => {
          // Filter by color
          if (filters.colors.length > 0) {
            return filters.colors.some((color: string) => 
              product.colors?.includes(color)
            );
          }
          return true;
        })
        .filter((product: Product) => {
          // Filter by material
          if (filters.materials.length > 0) {
            return filters.materials.some((material: string) => 
              product.materials?.includes(material)
            );
          }
          return true;
        })
        .filter((product: Product) => {
          // Filter by price range
          const price = typeof product.price === 'number' ? product.price : 0;
          return (
            price >= filters.priceRange[0] * 100 &&
            price <= filters.priceRange[1] * 100
          );
        })
        .sort((a: Product, b: Product) => {
          // Sort products
          switch (sortOption) {
            case "price_asc":
              return (a.price || 0) - (b.price || 0);
            case "price_desc":
              return (b.price || 0) - (a.price || 0);
            case "name_asc":
              return a.name.localeCompare(b.name);
            case "name_desc":
              return b.name.localeCompare(a.name);
            case "newest":
              const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
              const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
              return dateB.getTime() - dateA.getTime();
            default:
              return 0;
          }
        })
    : [];

  // console.log("[Dashboard] filteredProducts após filtros/sort:", filteredProducts);

 return (
    <div className="flex-1 flex flex-col md:flex-row">
      {/* Sidebar for filters */}
      <FilterSidebar onFiltersChange={handleFiltersChange} />

      {/* Main content container */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4 h-full overflow-y-auto">
          {/* Visual Search */}
          <div className="mb-8">
             <VisualSearch />
          </div>
          
          {/* Se não houver produtos iniciais (antes de filtrar) */}
          {isLoadingProducts && !products && ( /* Melhor checar isLoading aqui */
             <div className="text-center py-10">
               <p className="text-gray-500">Carregando produtos...</p> {/* Mensagem de loading inicial */}
             </div>
          )}

          {errorProducts && ( /* Mostrar erro se a query inicial falhar */
            <div className="text-center py-10">
              <p className="text-red-500">
                Erro ao carregar produtos iniciais {errorProducts instanceof Error ? `(${errorProducts.message})` : ''}.
              </p>
            </div>
          )}

          {/* Renderizar barra de busca e produtos APENAS se a query inicial foi OK (mesmo que vazia) */}
          {!isLoadingProducts && !errorProducts && (
            <>
              {/* Search and Sort Bar */}
              <SearchSort
                onSearch={handleSearch}
                onSort={handleSort}
                onViewChange={handleViewChange}
              />

              {/* Product Grid/List - Renderização condicional baseada nos filteredProducts */}
              {filteredProducts.length === 0 && !isLoadingProducts && !searchQuery && !filters.categories.length && !filters.colors.length && !filters.materials.length && filters.priceRange[0] === 0 && filters.priceRange[1] === 100000 ? ( // Mensagem inicial se não houver produtos e nenhum filtro ativo
                <div className="text-center py-10">
                  <p className="text-gray-500">
                    Nenhum produto encontrado. Importe um catálogo na página 'Catálogos'.
                  </p>
                </div>
              ) : filteredProducts.length === 0 && !isLoadingProducts ? ( // Mensagem se filtros não retornaram nada
                 <div className="text-center py-10">
                   <p className="text-gray-500">
                     Nenhum produto encontrado com os filtros atuais.
                   </p>
                 </div>
              ) : ( // Renderiza a grade/lista se houver produtos filtrados
                <div
                  className={
                    view === "grid"
                      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8"
                      : "flex flex-col gap-4 mb-8"
                  }
                >
                  {filteredProducts.map((product: Product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onAddToQuote={handleAddToQuote}
                    />
                  ))}
                </div>
              )}
              {/* FIM DO BLOCO ÚNICO DE PRODUTOS */}
            </>
          )}

          {/* Budget Generator Section */}
          <QuoteGenerator items={quoteItems} onClearItems={handleClearQuoteItems} />

          {/* Pagination (pode precisar ser ajustada com base nos produtos filtrados) */}
          <div className="flex justify-center my-8">
            <nav className="inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              <a href="#" className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                <span className="sr-only">Anterior</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </a>
              {/* Paginação precisa ser implementada dinamicamente */}
              <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">1</a>
              {/* <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-primary-50 text-sm font-medium text-primary-600 hover:bg-primary-100">2</a> */}
              {/* <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span> */}
              <a href="#" className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                <span className="sr-only">Próxima</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </a>
            </nav>
          </div>

        </div>
      </div>
    </div>
  );
}
