import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Catalog } from "@shared/schema";
import { useLocation } from "wouter";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Loader2,
  Trash2,
  RefreshCw,
  Upload,
  Check,
  AlertCircle,
  Clock,
  Database,
  ListIcon,
  EyeIcon
} from "lucide-react";
import UploadCard from "@/components/catalog/upload-card";
import CatalogProducts from "@/components/catalog/catalog-products";

export default function Catalogs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [catalogToProcess, setCatalogToProcess] = useState<number | null>(null);
  const [catalogToDelete, setCatalogToDelete] = useState<number | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState<Catalog | null>(null);

  // Fetch catalogs
  const { data: catalogs = [], isLoading } = useQuery({
    queryKey: ["/backend/catalogs"],
    enabled: !!user,
  });

  // Mutation to process catalog
  const processMutation = useMutation({
    mutationFn: async (catalogId: number) => {
      await apiRequest("PUT", `/backend/catalogs/${catalogId}/status`, {
        status: "processed",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/backend/catalogs"] });
      toast({
        title: "Catálogo processado",
        description: "O catálogo foi processado com sucesso.",
      });
      setCatalogToProcess(null);
    },
    onError: (error) => {
      console.error("Process failed:", error);
      toast({
        title: "Falha no processamento",
        description: "Ocorreu um erro ao processar o catálogo.",
        variant: "destructive",
      });
    },
  });

  // Mutation to delete catalog
  const deleteMutation = useMutation({
    mutationFn: async (catalogId: number) => {
      console.log(`Solicitando exclusão do catálogo ID ${catalogId}`);
      try {
        const response = await apiRequest("DELETE", `/backend/catalogs/${catalogId}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Erro ao excluir catálogo: ${errorText}`);
          throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
        }
        
        return catalogId;
      } catch (error) {
        console.error("Erro durante a exclusão:", error);
        throw error;
      }
    },
    onSuccess: (catalogId) => {
      queryClient.invalidateQueries({ queryKey: ["/backend/catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["/backend/products"] });
      
      toast({
        title: "Catálogo removido",
        description: "O catálogo e seus produtos foram removidos com sucesso.",
      });
      setCatalogToDelete(null);
    },
    onError: (error) => {
      console.error("Delete failed:", error);
      toast({
        title: "Falha na remoção",
        description: "Ocorreu um erro ao remover o catálogo.",
        variant: "destructive",
      });
    },
  });

  const handleProcessCatalog = (catalogId: number) => {
    setCatalogToProcess(catalogId);
    processMutation.mutate(catalogId);
  };

  const handleDeleteCatalog = (catalogId: number) => {
    setCatalogToDelete(catalogId);
    deleteMutation.mutate(catalogId);
  };

  // Format date utility
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Status badge utility
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <Clock className="h-3 w-3 mr-1" />
            Pendente
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processando
          </Badge>
        );
      case "processed":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <Check className="h-3 w-3 mr-1" />
            Processado
          </Badge>
        );
      case "error":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <AlertCircle className="h-3 w-3 mr-1" />
            Erro
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">{status}</Badge>
        );
    }
  };

  // Verificar se estamos visualizando produtos de um catálogo específico
  if (selectedCatalog) {
    return (
      <div className="container mx-auto p-4 max-w-7xl">
        <CatalogProducts 
          catalogId={selectedCatalog.id} 
          fileName={selectedCatalog.fileName}
          onBack={() => setSelectedCatalog(null)}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Catálogos</h1>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Novo Catálogo
        </Button>
      </div>

      {/* Upload Section */}
      <div className="mb-8">
        <UploadCard />
      </div>

      {/* Catalogs List */}
      <Card>
        <CardHeader>
          <CardTitle>Catálogos Importados</CardTitle>
          <CardDescription>
            Visualize e gerencie os catálogos que você importou para sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="h-16 bg-gray-100 rounded-md"></div>
              ))}
            </div>
          ) : !catalogs || catalogs.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2 text-gray-500">
                Nenhum catálogo importado. Faça o upload do seu primeiro catálogo.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome do Arquivo</TableHead>
                  <TableHead>Data de Upload</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogs.map((catalog: Catalog) => (
                  <TableRow key={catalog.id}>
                    <TableCell className="font-medium">{catalog.fileName}</TableCell>
                    <TableCell>{formatDate(catalog.createdAt?.toString() || '')}</TableCell>
                    <TableCell>{getStatusBadge(catalog.processedStatus || '')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedCatalog(catalog)}
                        >
                          <ListIcon className="h-4 w-4 mr-1" />
                          Ver Produtos
                        </Button>
                        
                        {catalog.processedStatus === "pending" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleProcessCatalog(catalog.id)}
                            disabled={processMutation.isPending && catalogToProcess === catalog.id}
                          >
                            {processMutation.isPending && catalogToProcess === catalog.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-1" />
                            )}
                            Processar
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-red-500 hover:text-red-700">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir o catálogo "{catalog.fileName}"? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteCatalog(catalog.id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                {deleteMutation.isPending && catalogToDelete === catalog.id ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  "Excluir"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardFooter className="flex justify-between text-sm text-gray-500">
          <div>
            {catalogs?.length || 0} catálogo(s) importado(s)
          </div>
          <div>
            Última atualização: {new Date().toLocaleTimeString()}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
