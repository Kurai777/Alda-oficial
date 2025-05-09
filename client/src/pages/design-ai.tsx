import React from 'react';
import { useQuery } from '@tanstack/react-query'; // Importar useQuery
import { Link } from 'wouter'; // Importar Link
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Plus, Loader2, AlertTriangle } from 'lucide-react'; // Adicionar ícones para loading e erro

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

  // Buscar dados usando useQuery
  const { data: projects, isLoading, isError, error } = useQuery<MockDesignProjectSummary[], Error>({
     queryKey: ['designProjects'], // Chave única para esta query
     queryFn: fetchDesignProjects, // Função que busca os dados
     // Opções como refetchOnWindowFocus: false podem ser úteis
  });

  const handleNewProjectClick = () => {
    // TODO: Implementar chamada POST /backend/design-projects
    alert("Funcionalidade 'Novo Projeto' ainda não conectada ao backend.");
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Design de Ambientes com IA</h1>
        <Button onClick={handleNewProjectClick}>
          <Plus className="mr-2 h-4 w-4" /> Novo Projeto
        </Button>
      </div>

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
            <Button size="lg" onClick={handleNewProjectClick}>
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