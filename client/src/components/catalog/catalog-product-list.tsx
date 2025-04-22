import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Product } from "@shared/schema";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Edit, Trash2, Plus, FileText, ArrowLeftRight, Grid, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ProductForm from "./product-form";

interface CatalogProductListProps {
  catalogId: number;
  userId: number;
}

export default function CatalogProductList({
  catalogId,
  userId,
}: CatalogProductListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("name_asc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<number | null>(null);

  // Fetch products for this catalog
  const { data: products, isLoading } = useQuery({
    queryKey: ["/api/products", { userId, catalogId }],
    enabled: !!catalogId && !!userId,
  });

  // Mutation for deleting a product
  const deleteMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("DELETE", `/api/products/${productId}`);
      return productId;
    },
    onSuccess: (productId) => {
      queryClient.setQueryData(
        ["/api/products", { userId, catalogId }],
        (oldData: Product[] | undefined) => {
          if (!oldData) return [];
          return oldData.filter((product) => product.id !== productId);
        }
      );
      
      toast({
        title: "Produto excluído",
        description: "O produto foi excluído com sucesso.",
      });
    },
    onError: (error) => {
      console.error("Failed to delete product:", error);
      toast({
        title: "Erro ao excluir",
        description: "Ocorreu um erro ao excluir o produto.",
        variant: "destructive",
      });
    },
  });

  // Handler for deleting a product
  const handleDeleteProduct = (productId: number) => {
    setProductToDelete(null);
    deleteMutation.mutate(productId);
  };

  // Handler for opening the product form (add/edit)
  const handleOpenProductForm = (product?: Product) => {
    setSelectedProduct(product || null);
    setIsProductFormOpen(true);
  };

  // Format price from cents to BRL
  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);
  };

  // Filter and sort products
  const filteredProducts = products
    ? products
        .filter(
          (product: Product) =>
            product.catalogId === catalogId &&
            (searchQuery
              ? product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                product.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (product.description &&
                  product.description
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()))
              : true)
        )
        .sort((a: Product, b: Product) => {
          switch (sortOption) {
            case "name_asc":
              return a.name.localeCompare(b.name);
            case "name_desc":
              return b.name.localeCompare(a.name);
            case "price_asc":
              return a.price - b.price;
            case "price_desc":
              return b.price - a.price;
            case "newest":
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            case "oldest":
              return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            default:
              return 0;
          }
        })
    : [];

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-10">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Render empty state
  if (!products || products.length === 0 || filteredProducts.length === 0) {
    return (
      <div className="py-8">
        <div className="text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-lg font-medium text-gray-900">
            Nenhum produto encontrado
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Não há produtos cadastrados neste catálogo.
          </p>
          <div className="mt-6">
            <Button onClick={() => handleOpenProductForm()}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Produto
            </Button>
          </div>
        </div>

        {/* Product Form Dialog */}
        <ProductForm
          isOpen={isProductFormOpen}
          onClose={() => setIsProductFormOpen(false)}
          product={selectedProduct || undefined}
          userId={userId}
          catalogId={catalogId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Buscar produtos"
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Select
            value={sortOption}
            onValueChange={(value) => setSortOption(value)}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Nome (A-Z)</SelectItem>
              <SelectItem value="name_desc">Nome (Z-A)</SelectItem>
              <SelectItem value="price_asc">Preço (menor-maior)</SelectItem>
              <SelectItem value="price_desc">Preço (maior-menor)</SelectItem>
              <SelectItem value="newest">Mais recentes</SelectItem>
              <SelectItem value="oldest">Mais antigos</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="flex items-center space-x-1 border rounded-md">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="h-9 px-2"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-9 px-2"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          
          <Button onClick={() => handleOpenProductForm()}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredProducts.map((product: Product) => (
            <Card key={product.id} className="overflow-hidden">
              <div className="aspect-square relative overflow-hidden bg-gray-100">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://via.placeholder.com/300?text=Sem+Imagem";
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full bg-gray-100 text-gray-400">
                    <FileText className="h-12 w-12" />
                  </div>
                )}
                <div className="absolute top-2 right-2 bg-white rounded-md px-2 py-1 text-xs font-medium">
                  {product.code}
                </div>
              </div>

              <CardHeader className="p-4 pb-0">
                <CardTitle className="text-lg">{product.name}</CardTitle>
                <CardDescription>{product.category}</CardDescription>
              </CardHeader>

              <CardContent className="p-4 pt-2">
                <p className="text-lg font-bold">{formatPrice(product.price)}</p>
                {product.colors && product.colors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {product.colors.slice(0, 3).map((color) => (
                      <span
                        key={color}
                        className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded"
                      >
                        {color}
                      </span>
                    ))}
                    {product.colors.length > 3 && (
                      <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
                        +{product.colors.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </CardContent>

              <CardFooter className="p-4 pt-0 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenProductForm(product)}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-red-500">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tem certeza que deseja excluir o produto "{product.name}"? Esta ação não pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDeleteProduct(product.id)}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProducts.map((product: Product) => (
            <div
              key={product.id}
              className="flex flex-col sm:flex-row border rounded-lg overflow-hidden"
            >
              <div className="w-full sm:w-24 h-24 bg-gray-100 flex-shrink-0">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://via.placeholder.com/100?text=Sem+Imagem";
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full bg-gray-100 text-gray-400">
                    <FileText className="h-8 w-8" />
                  </div>
                )}
              </div>

              <div className="p-4 flex-grow flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-grow">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <h3 className="font-medium">{product.name}</h3>
                    <span className="text-sm text-gray-500">Cód: {product.code}</span>
                  </div>
                  <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-sm bg-gray-100 rounded px-2 py-0.5">
                      {product.category}
                    </span>
                    <span className="font-semibold">{formatPrice(product.price)}</span>
                  </div>
                  
                  {product.colors && product.colors.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {product.colors.slice(0, 3).map((color) => (
                        <span
                          key={color}
                          className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded"
                        >
                          {color}
                        </span>
                      ))}
                      {product.colors.length > 3 && (
                        <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
                          +{product.colors.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-1 sm:flex-col">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenProductForm(product)}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-red-500">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                        <AlertDialogDescription>
                          Tem certeza que deseja excluir o produto "{product.name}"? Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeleteProduct(product.id)}
                          className="bg-red-500 hover:bg-red-600"
                        >
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Product Form Dialog */}
      <ProductForm
        isOpen={isProductFormOpen}
        onClose={() => setIsProductFormOpen(false)}
        product={selectedProduct || undefined}
        userId={userId}
        catalogId={catalogId}
      />
    </div>
  );
}