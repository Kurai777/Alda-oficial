import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Product, Catalog } from "@shared/schema";

import FilterSidebar from "@/components/filters/filter-sidebar";
import SearchSort from "@/components/catalog/search-sort";
import UploadCard from "@/components/catalog/upload-card";
import VisualSearch from "@/components/catalog/visual-search";
import ProductCard from "@/components/catalog/product-card";
import QuoteGenerator from "@/components/quotes/quote-generator";

interface QuoteItem {
  product: Product;
  color: string;
  size?: string;
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
    priceRange: [0, 5000],
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("relevance");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedCatalogId, setSelectedCatalogId] = useState<number | null>(null);

  // Log para verificar o estado inicial e após atualizações
  console.log("[Dashboard] Estado atual - selectedCatalogId:", selectedCatalogId);

  // 1. Buscar catálogos do usuário
  const { data: catalogs, isLoading: isLoadingCatalogs, error: errorCatalogs } = useQuery<Catalog[]>({ 
    queryKey: ['/api/catalogs', user?.uid],
    queryFn: async () => {
      if (!user?.uid) return [];
      console.log("[Dashboard] Buscando catálogos...");
      const response = await fetch(`/api/catalogs?userId=${user.uid}`);
      if (!response.ok) {
        console.error("[Dashboard] Erro ao buscar catálogos:", response.status);
        throw new Error('Erro ao buscar catálogos');
      }
      const data = await response.json();
      // Log adicionado para inspecionar os dados brutos da API
      console.log("[Dashboard] Dados brutos recebidos de /api/catalogs:", JSON.stringify(data)); 
      console.log("[Dashboard] Catálogos recebidos da API:", data);
      return data;
    },
    enabled: !!user?.uid,
    refetchOnWindowFocus: true,
  });

  // Log dos resultados da busca de catálogos
  console.log("[Dashboard] Status busca catálogos - isLoading:", isLoadingCatalogs, "error:", errorCatalogs, "data:", catalogs);

  // 2. Determinar o catálogo mais recente e setar o ID
  useEffect(() => {
    console.log("[Dashboard] useEffect executando para setar selectedCatalogId. Catálogos atuais:", catalogs);
    if (catalogs && catalogs.length > 0) {
      const sortedCatalogs = [...catalogs].sort((a, b) => b.id - a.id);
      const latestCatalogId = sortedCatalogs[0].id;
      console.log(`[Dashboard] Catálogo mais recente encontrado: ID ${latestCatalogId}`);
      if (selectedCatalogId !== latestCatalogId) {
        console.log(`[Dashboard] Atualizando selectedCatalogId para: ${latestCatalogId}`);
        setSelectedCatalogId(latestCatalogId);
      }
    } else if (catalogs && catalogs.length === 0) {
        console.log("[Dashboard] Nenhum catálogo encontrado, setando selectedCatalogId para null.");
        if (selectedCatalogId !== null) {
          setSelectedCatalogId(null);
        }
    } else {
      console.log("[Dashboard] useEffect: Catálogos ainda não carregados ou indefinidos.");
    }
  }, [catalogs, selectedCatalogId]); // Dependência adicionada para evitar loop desnecessário se o ID já for o correto

  // 3. Buscar produtos usando o selectedCatalogId
  const { 
    data: products, 
    isLoading: isLoadingProducts, 
    error: errorProducts 
  } = useQuery<Product[]>({ 
    queryKey: ["/api/products", selectedCatalogId], 
    queryFn: async () => {
      if (!selectedCatalogId) {
        console.log("[Dashboard] selectedCatalogId é null, não buscando produtos.");
        return [];
      } 
      console.log(`[Dashboard] Buscando produtos para catálogo ID: ${selectedCatalogId}`);
      const response = await fetch(`/api/products?catalogId=${selectedCatalogId}`);
      
      if (!response.ok) {
        console.error(`[Dashboard] Erro HTTP buscando produtos: ${response.status}`);
        throw new Error(`Erro HTTP buscando produtos: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[Dashboard] Produtos recebidos para o catálogo ${selectedCatalogId}:`, data);
      return data;
    },
    enabled: !!selectedCatalogId, 
    refetchOnWindowFocus: true,
  });

  // Log dos resultados da busca de produtos
  console.log("[Dashboard] Status busca produtos - isLoading:", isLoadingProducts, "error:", errorProducts, "data:", products);

  // Combinar estados de loading e error para UI
  const isLoadingUI = isLoadingCatalogs || (!!selectedCatalogId && isLoadingProducts);
  const errorUI = errorCatalogs || (!!selectedCatalogId && errorProducts);

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
    setQuoteItems([...quoteItems, { product, color }]);

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
              product.code.toLowerCase().includes(query) ||
              (product.description && product.description.toLowerCase().includes(query))
            );
          }
          return true;
        })
        .filter((product: Product) => {
          // Filter by category
          if (filters.categories.length > 0) {
            return filters.categories.includes(product.category);
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
          return (
            product.price >= filters.priceRange[0] * 100 &&
            product.price <= filters.priceRange[1] * 100
          );
        })
        .sort((a: Product, b: Product) => {
          // Sort products
          switch (sortOption) {
            case "price_asc":
              return a.price - b.price;
            case "price_desc":
              return b.price - a.price;
            case "name_asc":
              return a.name.localeCompare(b.name);
            case "name_desc":
              return b.name.localeCompare(a.name);
            case "newest":
              const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
              const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
              return dateB.getTime() - dateA.getTime();
            default:
              return 0;
          }
        })
    : [];

  // Log antes de renderizar a UI condicionalmente
  console.log("[Dashboard] Renderizando UI - Checando condições. selectedCatalogId:", selectedCatalogId, "isLoadingCatalogs:", isLoadingCatalogs);

  return (
    <div className="flex-1 flex flex-col md:flex-row">
      {/* Sidebar for filters */}
      <FilterSidebar onFiltersChange={handleFiltersChange} />

      {/* Main content container */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4 h-full overflow-y-auto">
          {/* Upload Catalog Section - pode ser movido para outra página se o Dashboard for só visualização */}
          {/* <UploadCard /> */}
          {/* Visual Search Section */}
          {/* <VisualSearch /> */}

          {/* Mostrar estado inicial ou se não houver catálogos */}
          {console.log("[Dashboard] Renderizando UI - selectedCatalogId:", selectedCatalogId, "isLoadingCatalogs:", isLoadingCatalogs)}
          {!selectedCatalogId && !isLoadingCatalogs && (
            <div className="text-center py-10">
              <p className="text-gray-500">
                Nenhum catálogo importado encontrado. Importe um catálogo na página 'Catálogos'.
              </p>
            </div>
          )}
          
          {/* Renderizar produtos apenas se tiver um catálogo selecionado */}
          {!!selectedCatalogId && (
            <>
              {console.log("[Dashboard] Renderizando UI - Produtos (deve aparecer se selectedCatalogId existir)")}
              {/* Search and Sort Bar */}
              <SearchSort
                onSearch={handleSearch}
                onSort={handleSort}
                onViewChange={handleViewChange}
              />
              {/* Product Grid */}
              {isLoadingUI ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8 animate-pulse">
                  {[...Array(8)].map((_, index) => (
                    <div
                      key={index}
                      className="bg-white rounded-lg shadow-sm overflow-hidden h-80"
                    >
                      <div className="h-48 bg-gray-200"></div>
                      <div className="p-4 space-y-3">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-100 rounded w-1/2"></div>
                        <div className="h-5 bg-gray-200 rounded w-1/4"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : errorUI ? (
                <div className="text-center py-10">
                  <p className="text-red-500">
                    Erro ao carregar produtos {errorUI instanceof Error ? `(${errorUI.message})` : ''}. Por favor, tente novamente.
                  </p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-gray-500">
                    Nenhum produto encontrado com os filtros atuais neste catálogo.
                  </p>
                </div>
              ) : (
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
                  <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">1</a>
                  <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-primary-50 text-sm font-medium text-primary-600 hover:bg-primary-100">2</a>
                  <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">3</a>
                  <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span>
                  <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">8</a>
                  <a href="#" className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">9</a>
                  <a href="#" className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                    <span className="sr-only">Próxima</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </a>
                </nav>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
