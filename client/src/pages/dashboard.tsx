import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Product } from "@shared/schema";

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

  // Fetch products
  const { data: products, isLoading, error } = useQuery({
    queryKey: ["/api/products"],
    queryFn: async () => {
      console.log("Buscando todos os produtos para o dashboard");
      try {
        const response = await fetch(`/api/products`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`Erro HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`Encontrados ${data.length} produtos para o dashboard`);
        return data;
      } catch (error) {
        console.error("Erro ao buscar produtos:", error);
        return [];
      }
    },
    enabled: !!user?.id,
  });

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
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            default:
              return 0;
          }
        })
    : [];

  return (
    <div className="flex-1 flex flex-col md:flex-row">
      {/* Sidebar for filters */}
      <FilterSidebar onFiltersChange={handleFiltersChange} />

      {/* Main content container */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4 h-full overflow-y-auto">
          {/* Upload Catalog Section */}
          <UploadCard />

          {/* Visual Search Section */}
          <VisualSearch />

          {/* Search and Sort Bar */}
          <SearchSort
            onSearch={handleSearch}
            onSort={handleSort}
            onViewChange={handleViewChange}
          />

          {/* Product Grid */}
          {isLoading ? (
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
          ) : error ? (
            <div className="text-center py-10">
              <p className="text-red-500">
                Erro ao carregar produtos. Por favor, tente novamente.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-500">
                Nenhum produto encontrado com os filtros atuais.
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

          {/* Pagination */}
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
        </div>
      </div>
    </div>
  );
}
