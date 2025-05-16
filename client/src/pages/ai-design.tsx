import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'; // Adicionado useMutation, useQueryClient
import { Link, useLocation } from 'wouter'; // Adicionado useLocation
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Loader2, AlertTriangle, X } from 'lucide-react'; // Adicionado X
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog"; // Componentes de Dialog
import { Input } from "@/components/ui/input"; // Input para nome do projeto
import { Label } from "@/components/ui/label"; // Label para o input
import { createDesignProjectApi } from '../lib/apiClient'; // Importar a nova função da API
import { useToast } from "@/hooks/use-toast"; // Importar useToast

// --- Mock Data & API --- 
type MockDesignProjectSummary = {
  id: number;
  name: string;
  status: string; // Simplificado para a lista
  // Adicionar talvez uma data ou thumbnail se útil
};

// Simula a chamada API para buscar projetos
const fetchDesignProjects = async (): Promise<MockDesignProjectSummary[]> => {
  console.log("[Mock API] Fetching design projects...");
  // Simular delay da rede
  await new Promise(resolve => setTimeout(resolve, 700)); 
  // Retornar dados mock
  return [
    { id: 1, name: "Sala de Estar - Cliente Joana", status: 'Aguardando Seleção' },
    { id: 2, name: "Quarto Casal - Pedro", status: 'Processando' },
    { id: 3, name: "Cozinha Gourmet", status: 'Novo' },
  ];
  // Para simular erro: throw new Error("Falha ao buscar projetos");
  // Para simular lista vazia: return [];
};
// --- Fim Mock Data & API ---


const DesignAiPage: React.FC = () => {
  const { toast } = useToast(); // Hook para toasts
  const queryClient = useQueryClient();
  const [, navigate] = useLocation(); // Para navegação

  // Estado para controlar a visibilidade do modal e o nome do novo projeto
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const { data: projects, isLoading, isError, error } = useQuery<MockDesignProjectSummary[], Error>({
     queryKey: ['designProjects'],
     queryFn: fetchDesignProjects, 
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
      setIsModalOpen(false); // Fechar o modal
      setNewProjectName(""); // Limpar o nome
      navigate(`/design-ai/${newProject.id}`); // Navegar para a página do novo projeto
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
    setNewProjectName(""); // Limpar nome ao abrir
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
    // Construir e logar o payload explicitamente aqui
    const projectPayload = { name: newProjectName.trim() };
    console.log("[DesignAiPage] Payload enviado para mutação:", projectPayload); // LOG ADICIONADO
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
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>Status: {project.status}</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Placeholder para imagem thumb do projeto? */}
                  <div className="h-32 bg-muted rounded-md flex items-center justify-center text-muted-foreground/50">
                     (Thumb)
                  </div>
                </CardContent>
                {/* O Card inteiro é um link agora, não precisa de botão "Abrir" */}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default DesignAiPage; 