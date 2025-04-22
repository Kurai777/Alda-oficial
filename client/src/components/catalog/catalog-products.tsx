import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  FileTextIcon
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Product } from "@shared/schema";

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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const pageSize = 10;

  // Buscar produtos do catálogo
  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/products", { catalogId }],
    queryFn: async () => {
      const userId = user?.id || 1;
      const response = await apiRequest("GET", `/api/products?userId=${userId}&catalogId=${catalogId}`);
      return response || [];
    }
  });

  // Filtrar produtos por termo de busca
  const filteredProducts = products.filter((product: Product) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      product.name?.toLowerCase().includes(searchLower) ||
      product.code?.toLowerCase().includes(searchLower) ||
      product.category?.toLowerCase().includes(searchLower) ||
      String(product.price).includes(searchTerm)
    );
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
                        <div className="aspect-square bg-muted rounded-md flex items-center justify-center mb-3">
                          {product.imageUrl ? (
                            <img 
                              src={product.imageUrl} 
                              alt={product.name} 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="text-muted-foreground">Sem imagem</div>
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
                  value={selectedProduct.materials || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, materials: e.target.value})}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="dimensions" className="text-right">Dimensões</Label>
                <Input
                  id="dimensions"
                  value={selectedProduct.dimensions || ""}
                  onChange={(e) => setSelectedProduct({...selectedProduct, dimensions: e.target.value})}
                  className="col-span-3"
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
    </div>
  );
}