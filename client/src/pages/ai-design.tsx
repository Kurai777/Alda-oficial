import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { AiDesignProject, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Loader2, Plus, Edit, Trash2, MessageSquare, Image } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function AiDesignPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();

  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<AiDesignProject | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Buscar projetos
  const { data: projects, isLoading, error } = useQuery<AiDesignProject[]>({
    queryKey: ["/api/ai-design-projects", user?.uid],
    queryFn: async () => {
      const res = await fetch(`/api/ai-design-projects?userId=${user?.uid}`);
      if (!res.ok) throw new Error('Falha ao carregar projetos');
      return res.json();
    },
    enabled: !!user?.uid,
  });

  // Criar novo projeto
  const createProjectMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/ai-design-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, userId: user?.id }),
      });
      if (!res.ok) throw new Error('Falha ao criar projeto');
      return res.json();
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-design-projects"] });
      setNewProjectTitle("");
      setIsNewProjectDialogOpen(false);
      toast({
        title: "Projeto criado",
        description: "Seu novo projeto de design com IA foi criado com sucesso!",
      });
      // Redirecionar para a página do projeto
      setLocation(`/ai-design/${newProject.id}`);
    },
    onError: (error) => {
      toast({
        title: "Erro ao criar projeto",
        description: error instanceof Error ? error.message : "Ocorreu um erro inesperado",
        variant: "destructive",
      });
    },
  });

  // Excluir projeto
  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await fetch(`/api/ai-design-projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error('Falha ao excluir projeto');
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-design-projects"] });
      setProjectToDelete(null);
      setIsDeleteDialogOpen(false);
      toast({
        title: "Projeto excluído",
        description: "O projeto foi excluído com sucesso!",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao excluir projeto",
        description: error instanceof Error ? error.message : "Ocorreu um erro inesperado",
        variant: "destructive",
      });
    },
  });

  // Manipulador para criar novo projeto
  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) {
      toast({
        title: "Erro",
        description: "Por favor, insira um título para o projeto",
        variant: "destructive",
      });
      return;
    }
    createProjectMutation.mutate(newProjectTitle);
  };

  // Manipulador para excluir projeto
  const handleDeleteProject = () => {
    if (projectToDelete) {
      deleteProjectMutation.mutate(projectToDelete.id);
    }
  };

  // Função para obter a classe de cor do status
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-500";
      case "processing":
        return "bg-blue-500";
      case "completed":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  // Função para obter o texto do status
  const getStatusText = (status: string) => {
    switch (status) {
      case "pending":
        return "Pendente";
      case "processing":
        return "Processando";
      case "completed":
        return "Concluído";
      case "error":
        return "Erro";
      default:
        return status;
    }
  };

  // Renderizar página de carregamento
  if (isLoading) {
    return (
      <div className="container mx-auto py-10 flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Renderizar página de erro
  if (error) {
    return (
      <div className="container mx-auto py-10">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Erro!</strong>
          <span className="block sm:inline"> {error instanceof Error ? error.message : "Erro desconhecido"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Design de Ambientes com IA</h1>
          <p className="text-muted-foreground mt-2">
            Substitua móveis fictícios por produtos reais do seu catálogo em plantas baixas e renders
          </p>
        </div>
        <Button onClick={() => setIsNewProjectDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Novo Projeto
        </Button>
      </div>

      {/* Grid de projetos */}
      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">{project.title}</CardTitle>
                  <Badge className={getStatusColor(project.status) + " text-white"}>
                    {getStatusText(project.status)}
                  </Badge>
                </div>
                <CardDescription>
                  Criado {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true, locale: ptBR })}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-0">
                <div className="flex flex-wrap gap-2 mb-4">
                  {project.floorPlanImageUrl && (
                    <div className="relative h-24 w-32 rounded overflow-hidden">
                      <img
                        src={project.floorPlanImageUrl}
                        alt="Planta baixa"
                        className="object-cover h-full w-full"
                      />
                      <div className="absolute bottom-0 left-0 bg-black bg-opacity-70 text-white text-xs p-1 w-full">
                        Planta Baixa
                      </div>
                    </div>
                  )}
                  {project.renderImageUrl && (
                    <div className="relative h-24 w-32 rounded overflow-hidden">
                      <img
                        src={project.renderImageUrl}
                        alt="Render"
                        className="object-cover h-full w-full"
                      />
                      <div className="absolute bottom-0 left-0 bg-black bg-opacity-70 text-white text-xs p-1 w-full">
                        Render
                      </div>
                    </div>
                  )}
                  {!project.floorPlanImageUrl && !project.renderImageUrl && (
                    <div className="flex items-center justify-center h-24 w-full bg-muted rounded">
                      <Image className="h-8 w-8 text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Sem imagens</span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-between pt-3">
                <div className="flex space-x-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setProjectToDelete(project);
                      setIsDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  asChild
                >
                  <Link to={`/ai-design/${project.id}`}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Abrir Chat
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="bg-muted rounded-lg p-12 text-center">
          <Image className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Nenhum projeto encontrado</h3>
          <p className="text-muted-foreground mb-6">
            Crie um novo projeto para começar a substituir móveis fictícios por produtos reais.
          </p>
          <Button onClick={() => setIsNewProjectDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Criar Projeto
          </Button>
        </div>
      )}

      {/* Diálogo para criar novo projeto */}
      <Dialog open={isNewProjectDialogOpen} onOpenChange={setIsNewProjectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Projeto de Design</DialogTitle>
            <DialogDescription>
              Crie um novo projeto para substituir móveis fictícios por produtos reais do seu catálogo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título do Projeto</Label>
                <Input
                  id="title"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  placeholder="Ex: Reforma Sala de Estar Cliente João"
                  disabled={createProjectMutation.isPending}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewProjectDialogOpen(false)}
                disabled={createProjectMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createProjectMutation.isPending}
              >
                {createProjectMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar Projeto"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo para confirmar exclusão */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o projeto "{projectToDelete?.title}"? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={deleteProjectMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}