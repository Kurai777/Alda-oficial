import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Loader2, AlertTriangle, X, Image as ImageIconLucide } from 'lucide-react'; // Renomeado Image para ImageIconLucide para evitar conflito
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDesignProjectApi, getDesignProjectsListApi } from '../lib/apiClient'; // Importar getDesignProjectsListApi
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from 'date-fns'; // Para formatar datas
import { ptBR } from 'date-fns/locale';    // Para datas em pt-BR

// Tipo para o sumário do projeto, como esperado pela UI desta página
type DesignProjectSummary = { // Renomeado de MockDesignProjectSummary para consistência, já que não é mais mock
  id: number;
  name: string;
  status: string;
  clientRenderImageUrl?: string | null; // Para thumbnail
  createdAt?: string | Date; // Para "Criado há..."
};

const DesignAiPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // Buscar projetos reais usando getDesignProjectsListApi
  const { data: projects, isLoading, isError, error } = useQuery<DesignProjectSummary[], Error>({
     queryKey: ['designProjects'], // Chave da query para a lista de projetos
     queryFn: getDesignProjectsListApi, // Usar a função da API real
  });

  // Mutação para criar um novo projeto
  const createProjectMutation = useMutation({
    mutationFn: createDesignProjectApi,
    onSuccess: (newProject) => {
      toast({
        title: "Projeto Criado!",
        description: `O projeto "${newProject.name}" foi criado com sucesso.`,
      });
      queryClient.invalidateQueries({ queryKey: ['designProjects'] });
      setIsModalOpen(false);
      setNewProjectName("");
      navigate(`/design-ai/${newProject.id}`);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Erro ao criar projeto",
        description: error.message || "Não foi possível criar o projeto.",
      });
    },
  });

  const handleOpenModal = () => {
    setNewProjectName("");
    setIsModalOpen(true);
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) {
      toast({
        variant: "destructive",
        title: "Nome Inválido",
        description: "Por favor, insira um nome para o projeto.",
      });
      return;
    }
    const projectPayload = { name: newProjectName.trim() };
    console.log("[DesignAiPage] Payload enviado para mutação:", projectPayload);
    createProjectMutation.mutate(projectPayload);
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Design de Ambientes com IA</h1>
        <Button onClick={handleOpenModal}>
          <Plus className="mr-2 h-4 w-4" /> Novo Projeto
        </Button>
      </div>

      {/* Modal para Novo Projeto */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Novo Projeto de Design</DialogTitle>
            <DialogDescription>
              Crie um novo projeto para substituir móveis fictícios por produtos reais do seu catálogo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="projectName" className="text-right">
                Título do Projeto
              </Label>
              <Input
                id="projectName"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="col-span-3"
                placeholder="Ex: Sala de Estar Cliente X"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button 
              onClick={handleCreateProject} 
              disabled={createProjectMutation.isPending}
            >
              {createProjectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Projeto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Carregando projetos...</span>
        </div>
      )}

      {isError && (
        <Card className="text-center py-12 border-destructive bg-destructive/10">
          <CardHeader>
            <div className="mx-auto bg-destructive rounded-full p-2 w-fit">
               <AlertTriangle className="h-6 w-6 text-destructive-foreground" />
            </div>
            <CardTitle className="text-destructive">Erro ao Carregar Projetos</CardTitle>
            <CardDescription className="text-destructive/80">{error?.message || 'Não foi possível buscar os projetos de design.'}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !isError && projects && projects.length === 0 && (
        <Card className="text-center py-12">
          <CardHeader>
            <CardTitle className="text-xl text-muted-foreground">Nenhum projeto encontrado</CardTitle>
            <CardDescription>Crie um novo projeto para começar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" onClick={handleOpenModal}>
              <Plus className="mr-2 h-5 w-5" /> Criar Projeto
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && projects && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link key={project.id} href={`/design-ai/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer flex flex-col">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    Status: {project.status} 
                    {project.createdAt && (
                      <span className="text-xs text-muted-foreground ml-2">
                        (Criado {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true, locale: ptBR })})
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-center justify-center">
                  {project.clientRenderImageUrl ? (
                    <img src={project.clientRenderImageUrl} alt={project.name} className="max-h-40 w-auto object-contain rounded-md"/>
                  ) : (
                    <div className="h-40 w-full bg-muted rounded-md flex items-center justify-center text-muted-foreground/50">
                       <ImageIconLucide size={48} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default DesignAiPage; 