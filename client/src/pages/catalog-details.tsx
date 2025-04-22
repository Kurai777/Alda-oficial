import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Catalog } from "@shared/schema";

import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  FileUp,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import CatalogProductList from "@/components/catalog/catalog-product-list";

export default function CatalogDetails() {
  const { id } = useParams<{ id: string }>();
  const catalogId = parseInt(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("produtos");

  // Fetch catalog details
  const { data: catalogs, isLoading: catalogsLoading } = useQuery({
    queryKey: ["/api/catalogs", { userId: user?.id }],
    enabled: !!user?.id,
  });

  // Find the current catalog
  const catalog: Catalog | undefined = catalogs?.find(
    (c: Catalog) => c.id === catalogId
  );

  // If catalog not found and not loading, redirect to catalogs page
  useEffect(() => {
    if (!catalogsLoading && !catalog && user) {
      toast({
        title: "Catálogo não encontrado",
        description: "O catálogo que você está procurando não existe ou foi removido.",
        variant: "destructive",
      });
      navigate("/catalogs");
    }
  }, [catalog, catalogsLoading, user, navigate, toast]);

  // Format date
  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (catalogsLoading) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!catalog) {
    return null; // Will be handled by the useEffect
  }

  return (
    <div className="container mx-auto p-4">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() => navigate("/catalogs")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para Catálogos
        </Button>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">{catalog.fileName}</h1>
            <div className="flex items-center text-gray-500 mt-1 space-x-4">
              <div className="flex items-center">
                <Calendar className="h-4 w-4 mr-1" />
                <span className="text-sm">
                  Importado em {formatDate(catalog.createdAt)}
                </span>
              </div>
              <div className="flex items-center">
                <FileText className="h-4 w-4 mr-1" />
                <span className="text-sm">Status: {catalog.processedStatus || "Processado"}</span>
              </div>
            </div>
          </div>

          <div className="flex space-x-2">
            <Button variant="outline">
              <FileUp className="mr-2 h-4 w-4" />
              Atualizar Catálogo
            </Button>
            <Button variant="outline">
              <Settings className="mr-2 h-4 w-4" />
              Configurações
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="produtos" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="estatisticas">Estatísticas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="pt-4">
          <CatalogProductList 
            catalogId={catalogId} 
            userId={user?.id || 0} 
          />
        </TabsContent>

        <TabsContent value="estatisticas">
          <Card>
            <CardHeader>
              <CardTitle>Estatísticas do Catálogo</CardTitle>
              <CardDescription>
                Visão geral dos dados deste catálogo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-medium">Total de Produtos</h3>
                  <p className="text-3xl font-bold mt-2">--</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-medium">Preço Médio</h3>
                  <p className="text-3xl font-bold mt-2">--</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-medium">Últimos Adicionados</h3>
                  <p className="text-3xl font-bold mt-2">--</p>
                </div>
              </div>
              <div className="mt-6">
                <p className="text-sm text-gray-500 italic">
                  As estatísticas detalhadas estarão disponíveis em breve.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Alterações</CardTitle>
              <CardDescription>
                Registros de todas as alterações feitas neste catálogo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="border-l-2 border-gray-200 pl-4 py-2">
                  <div className="flex items-start">
                    <Clock className="h-5 w-5 mr-2 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium">Catálogo importado</p>
                      <p className="text-sm text-gray-500">
                        {formatDate(catalog.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Mais itens de histórico serão adicionados aqui */}
                <p className="text-sm text-gray-500 italic">
                  O histórico detalhado estará disponível em breve.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}