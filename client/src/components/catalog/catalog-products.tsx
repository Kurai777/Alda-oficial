import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  PenIcon, 
  Trash2Icon, 
  ChevronLeftIcon, 
  ChevronRightIcon,
  CheckCircleIcon,
  XCircleIcon,
  SearchIcon,
  FileTextIcon,
  PlusIcon,
  ImageIcon,
  FilterIcon,
  XIcon,
  EuroIcon,
  RefreshCw
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import ImageWithVerification from "@/components/catalog/ImageWithVerification";
import { Product } from "@shared/schema";
import FixProductImagesButton from "./FixProductImagesButton";
import ProcessFullCatalogButton from "./ProcessFullCatalogButton";

interface CatalogProductsProps {
  catalogId: number;
  fileName?: string;
  onBack?: () => void;
}

export default function CatalogProducts({ catalogId, fileName, onBack }: CatalogProductsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  
  // Estado para os filtros
  const [filters, setFilters] = useState({
    category: "", // Segmento (sofá, home, poltrona, etc.)
    manufacturer: "", // Fabricante (Sierra, Estúdio Bola, etc.)
    minPrice: "", // Preço mínimo
    maxPrice: "", // Preço máximo
    location: "", // Localização (2°Piso, Depósito, etc.)
    material: "", // Material (Tecido, Couro, etc.)
  });
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    name: '',
    description: '',
    code: '',
    price: 0,
    category: '',
    manufacturer: '',
    colors: [],
    materials: [],
    imageUrl: ''
  });
  // Reduzindo a quantidade de produtos por página para melhor organização
  const pageSize = 6;
  // Grid é o modo padrão para melhor visualização
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');

  // Buscar produtos do catálogo (somente da API local para evitar problemas de permissão)
  const { data: products = [], isLoading, refetch, isError } = useQuery({
    queryKey: ["/api/products", { catalogId }],
    queryFn: async () => {
      console.log(`Buscando produtos para catalogId=${catalogId}`);
      
      try {
        // Buscar produtos através da API do backend
        const response = await fetch(`/api/products?catalogId=${catalogId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        // Se a resposta não for ok, lançar erro
        if (!response.ok) {
          throw new Error(`Erro HTTP: ${response.status}`);
        }
        
        // Converter a resposta para JSON
        const data = await response.json();
        console.log("API response:", data);
        
        // Se encontrou produtos, retorná-los
        if (data && Array.isArray(data)) {
          console.log(`Encontrados ${data.length} produtos na API local`);
          return data;
        }
        
        console.log("Nenhum produto encontrado para este catálogo");
        return [];
      } catch (error) {
        console.error("Erro ao buscar produtos:", error);
        return [];
      }
    },
    enabled: !!catalogId
  });

  // Garantir que products é sempre um array antes de filtrar
  const productsArray = Array.isArray(products) ? products : [];
  
  // Filtrar produtos por termo de busca e filtros
  const filteredProducts = productsArray.filter((product: Product) => {
    // Filtro por texto de busca
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = (
        product.name?.toLowerCase().includes(searchLower) ||
        product.code?.toLowerCase().includes(searchLower) ||
        product.category?.toLowerCase().includes(searchLower) ||
        String(product.price).includes(searchTerm) ||
        product.description?.toLowerCase().includes(searchLower) ||
        (Array.isArray(product.materials) && product.materials?.some(m => m?.toLowerCase().includes(searchLower)))
      );
      
      if (!matchesSearch) return false;
    }
    
    // Filtro por categoria (segmento)
    if (filters.category && product.category !== filters.category) {
      return false;
    }
    
    // Filtro por fabricante
    if (filters.manufacturer && product.manufacturer !== filters.manufacturer) {
      return false;
    }
    
    // Filtro por preço mínimo
    if (filters.minPrice) {
      const minPrice = parseInt(filters.minPrice) * 100; // Converter para centavos
      if (product.price < minPrice) return false;
    }
    
    // Filtro por preço máximo
    if (filters.maxPrice) {
      const maxPrice = parseInt(filters.maxPrice) * 100; // Converter para centavos
      if (product.price > maxPrice) return false;
    }
    
    // Filtro por localização
    if (filters.location && product.location) {
      if (!product.location.toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }
    }
    
    // Filtro por material
    if (filters.material && product.material) {
      if (!product.material.toLowerCase().includes(filters.material.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  });

  // Produtos paginados
  const paginatedProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filteredProducts.length / pageSize);

  // Editar produto
  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setIsEditDialogOpen(true);
  };

  // Salvar alterações no produto
  const handleSave = async () => {
    if (!selectedProduct) return;

    try {
      await apiRequest("PUT", `/api/products/${selectedProduct.id}`, selectedProduct);
      
      toast({
        title: "Produto atualizado",
        description: "As alterações foram salvas com sucesso.",
      });
      
      setIsEditDialogOpen(false);
      refetch();
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
      toast({
        title: "Erro ao atualizar",
        description: "Não foi possível salvar as alterações.",
        variant: "destructive",
      });
    }
  };
  
  // Adicionar novo produto
  const handleAddProduct = async () => {
    try {
      // Adicionar catalogId ao novo produto
      const productToAdd = {
        ...newProduct,
        catalogId,
        price: typeof newProduct.price === 'string' && typeof (newProduct.price as string).replace === 'function' 
          ? parseInt((newProduct.price as string).replace(/\D/g, '')) 
          : Math.round(Number(newProduct.price || 0) * 100)
      };
      
      await apiRequest("POST", "/api/products", productToAdd);
      
      toast({
        title: "Produto adicionado",
        description: "O produto foi adicionado com sucesso ao catálogo.",
      });
      
      // Limpar formulário e fechar diálogo
      setNewProduct({
        name: '',
        description: '',
        code: '',
        price: 0,
        category: '',
        colors: [],
        materials: [],
        imageUrl: ''
      });
      setIsAddDialogOpen(false);
      
      // Atualizar lista de produtos
      refetch();
    } catch (error) {
      console.error("Erro ao adicionar produto:", error);
      toast({
        title: "Erro ao adicionar",
        description: "Não foi possível adicionar o produto.",
        variant: "destructive",
      });
    }
  };

  // Excluir produto
  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;

    try {
      await apiRequest("DELETE", `/api/products/${id}`);
      
      toast({
        title: "Produto excluído",
        description: "O produto foi removido com sucesso.",
      });
      
      refetch();
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      toast({
        title: "Erro ao excluir",
        description: "Não foi possível remover o produto.",
        variant: "destructive",
      });
    }
  };

  // Formatar preço para exibição
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(price / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeftIcon className="h-4 w-4 mr-1" />
              Voltar
            </Button>
          )}
          <h2 className="text-2xl font-bold">{fileName ? `Produtos de: ${fileName}` : "Produtos do Catálogo"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={() => setIsAddDialogOpen(true)}
            className="mr-2"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Adicionar Produto
          </Button>
          
          <Button 
            variant="outline"
            onClick={() => setIsFilterDialogOpen(true)}
            className={filters.category || filters.manufacturer || filters.minPrice || filters.maxPrice ? "mr-2 bg-primary/10" : "mr-2"}
          >
            <FilterIcon className="h-4 w-4 mr-1" />
            Filtrar
          </Button>
          
          <FixProductImagesButton 
            catalogId={catalogId} 
            onComplete={() => {
              refetch();
              toast({
                title: "Imagens corrigidas",
                description: "As imagens dos produtos foram corrigidas com sucesso."
              });
            }}
          />
          
          <ProcessFullCatalogButton
            catalogId={catalogId}
            onComplete={() => {
              refetch();
              toast({
                title: "Catálogo processado",
                description: "O catálogo completo foi processado com sucesso."
              });
            }}
          />
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Refresh para forçar o recarregamento de todas as imagens
              refetch();
              toast({
                title: "Atualizando imagens",
                description: "Recarregando imagens dos produtos...",
                duration: 3000,
              });
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar imagens
          </Button>
          
          {(filters.category || filters.manufacturer || filters.minPrice || filters.maxPrice || filters.location || filters.material) && (
            <Button 
              variant="ghost"
              onClick={() => {
                setFilters({
                  category: "",
                  manufacturer: "",
                  minPrice: "",
                  maxPrice: "",
                  location: "",
                  material: ""
                });
                toast({
                  title: "Filtros limpos",
                  description: "Todos os filtros foram removidos."
                });
              }}
              className="mr-2"
              size="sm"
            >
              <XIcon className="h-4 w-4 mr-1" />
              Limpar Filtros
            </Button>
          )}
          
          <div className="relative">
            <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produtos..."
              className="pl-8 w-[250px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Indicadores de filtros ativos */}
      {(filters.category || filters.manufacturer || filters.minPrice || filters.maxPrice || filters.location || filters.material) && (
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="text-sm text-muted-foreground mr-2 flex items-center">
            Filtros ativos:
          </div>
          
          {filters.category && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Segmento: {filters.category}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, category: ""})}
              />
            </Badge>
          )}
          
          {filters.manufacturer && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Fabricante: {filters.manufacturer}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, manufacturer: ""})}
              />
            </Badge>
          )}
          
          {filters.minPrice && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Preço mínimo: R$ {filters.minPrice}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, minPrice: ""})}
              />
            </Badge>
          )}
          
          {filters.maxPrice && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Preço máximo: R$ {filters.maxPrice}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, maxPrice: ""})}
              />
            </Badge>
          )}
          
          {filters.location && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Localização: {filters.location}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, location: ""})}
              />
            </Badge>
          )}
          
          {filters.material && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <span>Material: {filters.material}</span>
              <XIcon 
                className="h-3 w-3 cursor-pointer" 
                onClick={() => setFilters({...filters, material: ""})}
              />
            </Badge>
          )}
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2 text-xs"
            onClick={() => {
              setFilters({
                category: "",
                manufacturer: "",
                minPrice: "",
                maxPrice: "",
                location: "",
                material: ""
              });
              toast({
                title: "Filtros limpos",
                description: "Todos os filtros foram removidos."
              });
            }}
          >
            Limpar todos
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileTextIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhum produto encontrado</h3>
            <p className="text-muted-foreground">
              {searchTerm ? "Nenhum produto corresponde à sua busca" : "Este catálogo não contém produtos"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <Tabs defaultValue="list">
              <TabsList className="mb-4">
                <TabsTrigger value="list">Lista</TabsTrigger>
                <TabsTrigger value="grid">Grade</TabsTrigger>
              </TabsList>
              
              <TabsContent value="list">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Código</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Preço</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedProducts.map((product: Product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>{product.code}</TableCell>
                          <TableCell>{product.category}</TableCell>
                          <TableCell>{formatPrice(product.price)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                                <PenIcon className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                                <Trash2Icon className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              
              <TabsContent value="grid">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paginatedProducts.map((product: Product) => (
                    <Card key={product.id} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="aspect-square bg-muted rounded-md flex items-center justify-center mb-3 overflow-hidden">
                          {product.id ? (
                            <ImageWithVerification 
                              productId={product.id}
                              altText={product.name}
                              className="w-full h-full object-cover"
                              imageUrl={product.imageUrl || undefined}
                              forceCacheBusting={true}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full w-full">
                              <ImageIcon className="h-10 w-10 text-muted-foreground mb-2" />
                              <div className="text-muted-foreground text-sm">Sem imagem</div>
                            </div>
                          )}
                        </div>
                        <h3 className="font-semibold">{product.name}</h3>
                        <p className="text-sm text-muted-foreground mb-1">Código: {product.code}</p>
                        <p className="text-sm text-muted-foreground mb-1">Categoria: {product.category}</p>
                        <p className="font-medium mt-2">{formatPrice(product.price)}</p>
                        <div className="flex gap-2 mt-3">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEdit(product)}>
                            <PenIcon className="h-4 w-4 mr-1" />
                            Editar
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDelete(product.id)}>
                            <Trash2Icon className="h-4 w-4 mr-1" />
                            Excluir
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
            
            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filteredProducts.length)} de {filteredProducts.length}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog de edição */}
      {selectedProduct && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Editar Produto</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">Nome</Label>
                <Input
                  id="name"
                  value={selectedProduct.name || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, name: e.target.value})}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="code" className="text-right">Código</Label>
                <Input
                  id="code"
                  value={selectedProduct.code || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, code: e.target.value})}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="category" className="text-right">Categoria</Label>
                <Input
                  id="category"
                  value={selectedProduct.category || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, category: e.target.value})}
                  className="col-span-3"
                  placeholder="Ex: Sofá, Poltrona, Mesa, etc."
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="manufacturer" className="text-right">Fabricante</Label>
                <Input
                  id="manufacturer"
                  value={selectedProduct.manufacturer || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, manufacturer: e.target.value})}
                  className="col-span-3"
                  placeholder="Ex: Sierra, Estúdio Bola, etc."
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="colors" className="text-right">Cores</Label>
                <Input
                  id="colors"
                  value={Array.isArray(selectedProduct.colors) ? selectedProduct.colors.join(", ") : ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, colors: e.target.value.split(", ").filter(Boolean)})}
                  className="col-span-3"
                  placeholder="Separadas por vírgula"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="price" className="text-right">Preço (R$)</Label>
                <Input
                  id="price"
                  type="number"
                  value={(selectedProduct.price / 100).toFixed(2)}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setSelectedProduct({
                      ...selectedProduct, 
                      price: isNaN(value) ? 0 : Math.round(value * 100)
                    });
                  }}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="materials" className="text-right">Materiais</Label>
                <Input
                  id="materials"
                  value={Array.isArray(selectedProduct.materials) ? selectedProduct.materials.join(", ") : ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, materials: e.target.value.split(", ").filter(Boolean)})}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="dimensions" className="text-right">Dimensões</Label>
                <Input
                  id="dimensions"
                  value={selectedProduct.sizes && selectedProduct.sizes.length > 0 
                    ? `${selectedProduct.sizes[0].width || ''}x${selectedProduct.sizes[0].height || ''}x${selectedProduct.sizes[0].depth || ''}`
                    : ""}
                  onChange={(e) => {
                    const parts = e.target.value.split('x').map(p => parseInt(p) || 0);
                    setSelectedProduct({
                      ...selectedProduct, 
                      sizes: [{
                        width: parts[0] || undefined,
                        height: parts[1] || undefined,
                        depth: parts[2] || undefined,
                        label: selectedProduct.sizes?.[0]?.label || ""
                      }]
                    });
                  }}
                  className="col-span-3"
                  placeholder="LxAxP em cm"
                />
              </div>
              <div className="grid grid-cols-4 items-start gap-4">
                <Label htmlFor="description" className="text-right pt-2">Descrição</Label>
                <Textarea
                  id="description"
                  value={selectedProduct.description || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, description: e.target.value})}
                  className="col-span-3"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="imageUrl" className="text-right">URL da Imagem</Label>
                <Input
                  id="imageUrl"
                  value={selectedProduct.imageUrl || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, imageUrl: e.target.value})}
                  className="col-span-3"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave}>Salvar alterações</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      
      {/* Dialog de filtro */}
      <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Filtrar Produtos</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filter-category" className="text-right">Segmento</Label>
              <Input
                id="filter-category"
                value={filters.category}
                onChange={(e) => setFilters({...filters, category: e.target.value})}
                className="col-span-3"
                placeholder="Ex: Sofá, Poltrona, Mesa, etc."
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filter-manufacturer" className="text-right">Fabricante</Label>
              <Input
                id="filter-manufacturer"
                value={filters.manufacturer}
                onChange={(e) => setFilters({...filters, manufacturer: e.target.value})}
                className="col-span-3"
                placeholder="Ex: Sierra, Estúdio Bola, etc."
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filter-min-price" className="text-right">Preço Mínimo</Label>
              <Input
                id="filter-min-price"
                type="number"
                value={filters.minPrice}
                onChange={(e) => setFilters({...filters, minPrice: e.target.value})}
                className="col-span-3"
                placeholder="Ex: 1000"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filter-max-price" className="text-right">Preço Máximo</Label>
              <Input
                id="filter-max-price"
                type="number"
                value={filters.maxPrice}
                onChange={(e) => setFilters({...filters, maxPrice: e.target.value})}
                className="col-span-3"
                placeholder="Ex: 5000"
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="destructive" 
              onClick={() => {
                setFilters({
                  category: "",
                  manufacturer: "",
                  minPrice: "",
                  maxPrice: "",
                });
              }}
            >
              Limpar Filtros
            </Button>
            <Button onClick={() => setIsFilterDialogOpen(false)}>
              Aplicar Filtros
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para adicionar produto */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Adicionar Novo Produto</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-name" className="text-right">Nome</Label>
              <Input
                id="new-name"
                value={newProduct.name || ""}
                onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                className="col-span-3"
                placeholder="Nome do produto"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-code" className="text-right">Código</Label>
              <Input
                id="new-code"
                value={newProduct.code || ""}
                onChange={(e) => setNewProduct({...newProduct, code: e.target.value})}
                className="col-span-3"
                placeholder="Código comercial"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-category" className="text-right">Categoria</Label>
              <Input
                id="new-category"
                value={newProduct.category || ""}
                onChange={(e) => setNewProduct({...newProduct, category: e.target.value})}
                className="col-span-3"
                placeholder="Sofá, Mesa, Cadeira, etc."
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-manufacturer" className="text-right">Fabricante</Label>
              <Input
                id="new-manufacturer"
                value={newProduct.manufacturer || ""}
                onChange={(e) => setNewProduct({...newProduct, manufacturer: e.target.value})}
                className="col-span-3"
                placeholder="Sierra, Estúdio Bola, etc."
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-colors" className="text-right">Cores</Label>
              <Input
                id="new-colors"
                value={Array.isArray(newProduct.colors) ? newProduct.colors.join(", ") : ""}
                onChange={(e) => setNewProduct({...newProduct, colors: e.target.value.split(", ").filter(Boolean)})}
                className="col-span-3"
                placeholder="Azul, Preto, Branco (separar por vírgula)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-price" className="text-right">Preço (R$)</Label>
              <Input
                id="new-price"
                type="number"
                value={typeof newProduct.price === 'number' ? (newProduct.price / 100).toFixed(2) : ''}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  setNewProduct({
                    ...newProduct, 
                    price: isNaN(value) ? 0 : Math.round(value * 100)
                  });
                }}
                className="col-span-3"
                placeholder="1000.00"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-materials" className="text-right">Materiais</Label>
              <Input
                id="new-materials"
                value={Array.isArray(newProduct.materials) ? newProduct.materials.join(", ") : ""}
                onChange={(e) => setNewProduct({...newProduct, materials: e.target.value.split(", ").filter(Boolean)})}
                className="col-span-3"
                placeholder="Madeira, Metal, Tecido (separar por vírgula)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-dimensions" className="text-right">Dimensões</Label>
              <Input
                id="new-dimensions"
                placeholder="LarguraxAlturaxProfundidade (Ex: 80x120x60)"
                className="col-span-3"
                onChange={(e) => {
                  const parts = e.target.value.split('x').map(p => parseInt(p) || 0);
                  setNewProduct({
                    ...newProduct, 
                    sizes: [{
                      width: parts[0] || undefined,
                      height: parts[1] || undefined,
                      depth: parts[2] || undefined,
                      label: "Dimensões do produto"
                    }]
                  });
                }}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="new-description" className="text-right pt-2">Descrição</Label>
              <Textarea
                id="new-description"
                value={newProduct.description || ""}
                onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
                className="col-span-3"
                rows={3}
                placeholder="Descrição detalhada do produto..."
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-imageUrl" className="text-right">URL da imagem</Label>
              <Input
                id="new-imageUrl"
                value={newProduct.imageUrl || ""}
                onChange={(e) => setNewProduct({...newProduct, imageUrl: e.target.value})}
                className="col-span-3"
                placeholder="https://... (opcional)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" onClick={handleAddProduct}>
              Adicionar Produto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}