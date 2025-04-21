import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth.js";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Moodboard, Product } from "@shared/schema";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Download, Eye, Trash2, Loader2, FileImage, Plus } from "lucide-react";
import MoodboardPreview from "@/components/moodboards/moodboard-preview";

export default function Moodboards() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMoodboard, setSelectedMoodboard] = useState<Moodboard | null>(null);
  const [moodboardToDelete, setMoodboardToDelete] = useState<number | null>(null);

  // Fetch moodboards
  const { data: moodboards, isLoading: isMoodboardsLoading } = useQuery({
    queryKey: ["/api/moodboards", { userId: user?.id }],
    enabled: !!user?.id,
  });

  // Fetch products for moodboards
  const { data: products } = useQuery({
    queryKey: ["/api/products", { userId: user?.id }],
    enabled: !!user?.id,
  });

  // Mutation to delete moodboard
  const deleteMutation = useMutation({
    mutationFn: async (moodboardId: number) => {
      await apiRequest("DELETE", `/api/moodboards/${moodboardId}`, undefined);
      return moodboardId;
    },
    onSuccess: (moodboardId) => {
      queryClient.setQueryData(
        ["/api/moodboards", { userId: user?.id }],
        (oldData: Moodboard[] | undefined) => {
          if (!oldData) return [];
          return oldData.filter((moodboard) => moodboard.id !== moodboardId);
        }
      );
      toast({
        title: "Moodboard excluído",
        description: "O moodboard foi excluído com sucesso.",
      });
      setMoodboardToDelete(null);
    },
    onError: (error) => {
      console.error("Delete failed:", error);
      toast({
        title: "Falha na exclusão",
        description: "Ocorreu um erro ao excluir o moodboard.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteMoodboard = (moodboardId: number) => {
    setMoodboardToDelete(null);
    deleteMutation.mutate(moodboardId);
  };

  const handleExportMoodboard = (moodboard: Moodboard) => {
    // In a real application, this would generate a PDF
    toast({
      title: "Exportação iniciada",
      description: "O moodboard está sendo exportado para PDF.",
    });
  };

  // Format date utility
  const formatDate = (dateString: string) => {
    return new Date(dateString);
  };

  // Get products for a moodboard
  const getMoodboardProducts = (moodboard: Moodboard) => {
    if (!products) return [];
    return moodboard.productIds
      .map((id) => products.find((p: Product) => p.id === id))
      .filter(Boolean)
      .map((product: Product) => ({
        id: product.id,
        name: product.name,
        code: product.code,
        price: product.price,
        imageUrl: product.imageUrl,
      }));
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Moodboards</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Moodboard
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Novo Moodboard</DialogTitle>
              <DialogDescription>
                Preencha as informações para criar um novo moodboard.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const newMoodboard = {
                userId: user?.id || 1,
                projectName: formData.get('projectName') as string,
                clientName: formData.get('clientName') as string,
                architectName: formData.get('architectName') as string,
                description: formData.get('description') as string,
                productIds: [],
                imageUrl: "",
              };
              
              // Create new moodboard
              apiRequest("POST", "/api/moodboards", newMoodboard)
                .then(res => res.json())
                .then(data => {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/moodboards"]
                  });
                  toast({
                    title: "Moodboard criado",
                    description: "O moodboard foi criado com sucesso.",
                  });
                  // Close dialog by clicking outside
                  document.body.click();
                })
                .catch(err => {
                  console.error("Error creating moodboard:", err);
                  toast({
                    title: "Erro ao criar moodboard",
                    description: "Ocorreu um erro ao criar o moodboard.",
                    variant: "destructive",
                  });
                });
            }} className="space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label htmlFor="projectName" className="text-sm font-medium">Nome do Projeto</label>
                  <input
                    id="projectName"
                    name="projectName"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Digite o nome do projeto"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="clientName" className="text-sm font-medium">Nome do Cliente</label>
                  <input
                    id="clientName"
                    name="clientName"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Digite o nome do cliente"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="architectName" className="text-sm font-medium">Nome do Arquiteto</label>
                  <input
                    id="architectName"
                    name="architectName"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Digite o nome do arquiteto"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="description" className="text-sm font-medium">Descrição</label>
                  <textarea
                    id="description"
                    name="description"
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Digite uma descrição para o moodboard"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Criar Moodboard</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Moodboards Grid */}
      <div className="mb-8">
        {isMoodboardsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[...Array(3)].map((_, index) => (
              <Card key={index} className="h-80">
                <div className="h-40 bg-gray-200 rounded-t-lg"></div>
                <CardContent className="pt-6">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-100 rounded w-1/2 mb-4"></div>
                  <div className="h-20 bg-gray-100 rounded"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !moodboards || moodboards.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <FileImage className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2 text-gray-500">
                Nenhum moodboard criado. Crie moodboards a partir dos seus orçamentos.
              </p>
              <Button className="mt-4">
                <Plus className="mr-2 h-4 w-4" />
                Criar Moodboard
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {moodboards.map((moodboard: Moodboard) => {
              const moodboardProducts = getMoodboardProducts(moodboard);
              return (
                <Card key={moodboard.id} className="overflow-hidden">
                  {/* Preview Image */}
                  <div className="h-40 bg-gray-100 relative overflow-hidden">
                    {moodboardProducts.length > 0 && (
                      <img
                        src={moodboardProducts[0]?.imageUrl}
                        alt={moodboard.projectName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://via.placeholder.com/400x200?text=Moodboard";
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                    <div className="absolute bottom-0 left-0 p-3">
                      <p className="text-white font-medium">{moodboard.projectName}</p>
                      {moodboard.clientName && (
                        <p className="text-white/80 text-sm">Cliente: {moodboard.clientName}</p>
                      )}
                    </div>
                  </div>

                  <CardContent className="pt-4">
                    {/* Mini Products Grid */}
                    <div className="grid grid-cols-4 gap-1 mb-4">
                      {moodboardProducts.slice(0, 4).map((product) => (
                        <div key={product.id} className="aspect-square bg-gray-100 rounded-sm overflow-hidden">
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://via.placeholder.com/80?text=Produto";
                            }}
                          />
                        </div>
                      ))}
                      {Array(4 - Math.min(moodboardProducts.length, 4))
                        .fill(0)
                        .map((_, i) => (
                          <div key={i} className="aspect-square bg-gray-100 rounded-sm"></div>
                        ))}
                    </div>

                    <div className="flex justify-between items-center">
                      <div className="text-xs text-gray-500">
                        {new Date(moodboard.createdAt).toLocaleDateString()}
                      </div>
                      <div className="flex space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedMoodboard(moodboard)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-5xl">
                            <DialogHeader>
                              <DialogTitle>Visualização do Moodboard</DialogTitle>
                              <DialogDescription>
                                Visualize o moodboard completo.
                              </DialogDescription>
                            </DialogHeader>
                            {selectedMoodboard && (
                              <MoodboardPreview
                                title={selectedMoodboard.projectName}
                                clientName={selectedMoodboard.clientName || undefined}
                                architectName={selectedMoodboard.architectName || undefined}
                                date={formatDate(selectedMoodboard.createdAt.toString())}
                                products={getMoodboardProducts(selectedMoodboard)}
                                onExport={() => handleExportMoodboard(selectedMoodboard)}
                              />
                            )}
                          </DialogContent>
                        </Dialog>

                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir o moodboard "{moodboard.projectName}"? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteMoodboard(moodboard.id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                {deleteMutation.isPending && moodboardToDelete === moodboard.id ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  "Excluir"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Moodboard Preview */}
      {moodboards && moodboards.length > 0 && (
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Último Moodboard</CardTitle>
              <CardDescription>
                Visualize o último moodboard gerado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MoodboardPreview
                title={moodboards[0].projectName}
                clientName={moodboards[0].clientName || undefined}
                architectName={moodboards[0].architectName || undefined}
                date={formatDate(moodboards[0].createdAt.toString())}
                products={getMoodboardProducts(moodboards[0])}
                onExport={() => handleExportMoodboard(moodboards[0])}
              />
            </CardContent>
            <CardFooter>
              <Button className="ml-auto" onClick={() => handleExportMoodboard(moodboards[0])}>
                <Download className="mr-2 h-4 w-4" />
                Exportar PDF
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
