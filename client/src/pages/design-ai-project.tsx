import React, { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from "@/components/ui/progress";
import { Upload, Image as ImageIcon, CheckCircle, XCircle, Clock, Eye, Sofa, Table, Plus, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/hooks/use-toast";

// --- Mock Data --- 
// (Simula os tipos que viriam do backend - @shared/schema)
type MockDesignProject = {
  id: number;
  name: string;
  status: 'new' | 'processing' | 'awaiting_selection' | 'processed_no_items' | 'completed' | 'failed';
  clientRenderImageUrl: string | null;
  items?: MockDesignProjectItem[]; // Adicionado para conter os itens
};

// NOVO TIPO para detalhes do produto
type MockProductSummary = {
  id: number;
  name: string;
  imageUrl: string | null;
};

type MockDesignProjectItem = {
  id: number;
  designProjectId: number;
  detectedObjectDescription: string;
  detectedObjectBoundingBox: any | null;
  suggestedProductId1: number | null;
  suggestedProduct1Details: MockProductSummary | null;
  matchScore1: number | null;
  suggestedProductId2: number | null;
  suggestedProduct2Details: MockProductSummary | null;
  matchScore2: number | null;
  suggestedProductId3: number | null;
  suggestedProduct3Details: MockProductSummary | null;
  matchScore3: number | null;
  selectedProductId: number | null;
  userFeedback: string | null;
};

// Dados mock dos produtos (para referência)
const mockProductsDb: Record<number, MockProductSummary> = {
  15: { id: 15, name: "Sofá Elegance Cinza", imageUrl: "/placeholder-sofa1.jpg" },
  23: { id: 23, name: "Sofá Moderno Urban", imageUrl: "/placeholder-sofa2.jpg" },
  8: { id: 8, name: "Poltrona Confort", imageUrl: "/placeholder-chair.jpg" }, // Exemplo alternativo
  42: { id: 42, name: "Mesa de Centro Carvalho", imageUrl: "/placeholder-table1.jpg" },
  5: { id: 5, name: "Mesa Lateral Minimalista", imageUrl: "/placeholder-table2.jpg" },
};

// Exemplo de dados mock
const getMockProjectData = (projectId: number): MockDesignProject | null => {
  if (projectId === 1) {
    return {
      id: 1,
      name: "Sala de Estar - Cliente Joana",
      status: 'awaiting_selection', // Simular que a IA já processou
      clientRenderImageUrl: "/placeholder-render.jpg", // Usar uma imagem placeholder
      items: [
        {
          id: 101,
          designProjectId: 1,
          detectedObjectDescription: "Sofá de 3 lugares cinza, estilo moderno",
          detectedObjectBoundingBox: { x: 10, y: 30, w: 50, h: 40 }, // Exemplo
          suggestedProductId1: 15, // ID de um produto real (se existir)
          suggestedProduct1Details: mockProductsDb[15] || null,
          matchScore1: 0.92,
          suggestedProductId2: 23,
          suggestedProduct2Details: mockProductsDb[23] || null,
          matchScore2: 0.85,
          suggestedProductId3: 8,
          suggestedProduct3Details: mockProductsDb[8] || null,
          matchScore3: 0.71,
          selectedProductId: null,
          userFeedback: null,
        },
        {
          id: 102,
          designProjectId: 1,
          detectedObjectDescription: "Mesa de centro retangular de madeira escura",
          detectedObjectBoundingBox: { x: 30, y: 60, w: 30, h: 20 }, // Exemplo
          suggestedProductId1: 42,
          suggestedProduct1Details: mockProductsDb[42] || null,
          matchScore1: 0.88,
          suggestedProductId2: 5,
          suggestedProduct2Details: mockProductsDb[5] || null,
          matchScore2: 0.81,
          suggestedProductId3: null, // Apenas 2 sugestões
          suggestedProduct3Details: null,
          matchScore3: null,
          selectedProductId: null,
          userFeedback: null,
        },
      ]
    };
  }
  if (projectId === 2) {
     return {
      id: 2,
      name: "Quarto Casal - Pedro",
      status: 'processing', // Simular que está processando
      clientRenderImageUrl: null, // Sem imagem ainda
      items: []
    };
  }
  return null; // Projeto não encontrado
};

// Função mock para buscar dados de UM projeto
const fetchDesignProject = async (projectId: number): Promise<MockDesignProject | null> => {
  console.log(`[Mock API] Fetching design project ID: ${projectId}...`);
  await new Promise(resolve => setTimeout(resolve, 500)); 
  // Simular not found
  // if (projectId > 2) throw new Error("Projeto não encontrado (404)");
  return getMockProjectData(projectId); // Usa a lógica mock existente
};

// Função mock para simular o upload da imagem
const uploadRenderImage = async ({ projectId, file }: { projectId: number, file: File }): Promise<{ imageUrl: string }> => {
  console.log(`[Mock API] Uploading image ${file.name} for project ${projectId}...`);
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simular delay de upload
  // Simular erro aleatório
  // if (Math.random() < 0.3) throw new Error("Falha simulada no upload");
  const mockImageUrl = `/uploads/project_${projectId}_${file.name.replace(/\s+/g, '_')}.jpg`; // URL mockada
  console.log(`[Mock API] Upload successful. Mock URL: ${mockImageUrl}`);
  // ATUALIZAR DADOS MOCK AQUI (Gambiarra para demonstração, backend faria isso)
  // Esta parte é problemática pois modifica o estado global mock diretamente.
  // Numa app real, o backend atualizaria e a invalidação da query buscaria os dados novos.
  const projectData = getMockProjectData(projectId);
  if(projectData) {
      projectData.clientRenderImageUrl = mockImageUrl;
      projectData.status = 'processing'; // Mudar status após upload
  }
  return { imageUrl: mockImageUrl }; 
};

// Função mock para simular a seleção de um produto
const selectProductForItem = async ({ projectId, itemId, selectedProductId }: { projectId: number, itemId: number, selectedProductId: number | null }): Promise<MockDesignProjectItem> => {
  console.log(`[Mock API] Selecting product ${selectedProductId} for item ${itemId} in project ${projectId}...`);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simular delay da API
  
  // Simular erro aleatório
  // if (Math.random() < 0.2) throw new Error("Falha simulada ao salvar seleção");

  // ATUALIZAR DADOS MOCK (Gambiarra - backend faria isso)
  const projectData = getMockProjectData(projectId);
  const item = projectData?.items?.find(i => i.id === itemId);
  if (item) {
    item.selectedProductId = selectedProductId;
    console.log(`[Mock API] Item ${itemId} updated with selected product ${selectedProductId}.`);
    return { ...item }; // Retornar o item atualizado (ou poderia retornar uma confirmação)
  } else {
    throw new Error("Item não encontrado nos dados mock");
  }
};

// --- Fim Mock Data & API ---

const DesignAiProjectPage: React.FC = () => {
  const params = useParams();
  const projectId = parseInt(params.id || '0');
  const { toast } = useToast();
  const queryClient = useQueryClient(); // Para invalidar queries

  // SUBSTITUIR useEffect por useQuery
  const { data: project, isLoading, isError, error } = useQuery<MockDesignProject | null, Error>({
    queryKey: ['designProject', projectId], // Chave inclui ID
    queryFn: () => fetchDesignProject(projectId),
    enabled: !!projectId, // Só rodar query se projectId for válido
  });

  // Definir a Mutação para upload
  const uploadMutation = useMutation<{
      imageUrl: string 
    }, 
    Error, 
    { projectId: number, file: File }
  >({
    mutationFn: uploadRenderImage, // Função que faz o "upload"
    onSuccess: (data) => {
      toast({ title: "Upload Concluído", description: "Imagem enviada com sucesso. Iniciando processamento." });
      // Invalidar a query do projeto para buscar dados atualizados (imagem/status)
      queryClient.invalidateQueries({ queryKey: ['designProject', projectId] });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro no Upload", description: error.message || "Não foi possível enviar a imagem." });
    },
  });

  // Atualizar handleImageUpload para usar a mutação
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && projectId) {
      console.log("Arquivo selecionado:", file.name);
      uploadMutation.mutate({ projectId, file }); // Chamar a mutação
    }
    // Limpar o input para permitir upload do mesmo arquivo novamente
    event.target.value = ''; 
  };

  const getStatusInfo = (status: MockDesignProject['status']) => {
    switch (status) {
      case 'new': return { text: 'Novo', icon: Plus, color: 'text-blue-500', progress: 10 };
      case 'processing': return { text: 'Processando Imagem com IA...', icon: Clock, color: 'text-orange-500', progress: 50 };
      case 'awaiting_selection': return { text: 'Aguardando Seleção de Produtos', icon: Eye, color: 'text-yellow-500', progress: 75 };
      case 'processed_no_items': return { text: 'Processado (Nenhum item detectado)', icon: CheckCircle, color: 'text-green-500', progress: 100 };
      case 'completed': return { text: 'Concluído', icon: CheckCircle, color: 'text-green-500', progress: 100 };
      case 'failed': return { text: 'Falha no Processamento', icon: XCircle, color: 'text-red-500', progress: 0 };
      default: return { text: 'Desconhecido', icon: Clock, color: 'text-gray-500', progress: 0 };
    }
  };

  // <<< NOVO ESTADO para rastrear seleções locais >>>
  // Formato: { itemId: selectedProductId | null, ... }
  const [localSelections, setLocalSelections] = useState<Record<number, number | null>>({});

  // <<< ATUALIZAR useEffect para inicializar seleções locais quando o projeto carregar >>>
  useEffect(() => {
    if (project?.items) {
      const initialSelections: Record<number, number | null> = {};
      project.items.forEach(item => {
        initialSelections[item.id] = item.selectedProductId;
      });
      setLocalSelections(initialSelections);
    }
  }, [project]); // Depende do projeto carregado

  // <<< NOVA MUTAÇÃO para selecionar produto >>>
  const selectProductMutation = useMutation< 
    MockDesignProjectItem, // Tipo do retorno da API (item atualizado)
    Error,
    { itemId: number, selectedProductId: number | null } // Input da mutação
  >({
    mutationFn: (variables) => selectProductForItem({ projectId, ...variables }), // Chama a função mock
    onSuccess: (updatedItem) => {
      toast({ title: "Seleção Salva", description: `Produto ID ${updatedItem.selectedProductId} selecionado para o item.` });
      // Atualizar estado local imediatamente para feedback rápido
      setLocalSelections(prev => ({ ...prev, [updatedItem.id]: updatedItem.selectedProductId }));
      // Invalidar query do projeto pode ser feito também, mas pode ser mais lento
      // queryClient.invalidateQueries({ queryKey: ['designProject', projectId] });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro ao Salvar", description: error.message || "Não foi possível salvar a seleção." });
    },
  });

  if (isLoading) {
    return <div className="text-center py-10">Carregando detalhes do projeto...</div>; 
  }

  if (isError) {
     return <div className="text-center py-10 text-red-500">Erro ao carregar projeto: {error?.message}</div>;
  }

  if (!project) {
    return <div className="text-center py-10 text-red-500">Projeto não encontrado.</div>;
  }

  const statusInfo = getStatusInfo(project.status);
  const isUploading = uploadMutation.isPending; // Usar estado da mutação

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-2">{project.name}</h1>
      <div className={`flex items-center gap-2 mb-6 ${statusInfo.color}`}>
        <statusInfo.icon className="h-5 w-5" />
        <span>Status: {statusInfo.text}</span>
      </div>
      {project.status === 'processing' && (
         <Progress value={statusInfo.progress} className="w-full h-2 mb-6" />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Coluna da Imagem e Upload (ATUALIZADA) */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Imagem do Cliente (Render)</CardTitle>
            </CardHeader>
            <CardContent>
              {project.clientRenderImageUrl ? (
                <img src={project.clientRenderImageUrl} alt="Render do Cliente" className="rounded-md object-cover w-full h-auto" />
              ) : (
                <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-16 w-16" />
                </div>
              )}
            </CardContent>
            <CardFooter>
              <label htmlFor="render-upload" className="w-full">
                <Button 
                  variant="outline" 
                  className="w-full" 
                  disabled={project.status === 'processing' || isUploading} // Desabilitar se processando ou fazendo upload
                >
                  {isUploading ? (
                     <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                     <Upload className="mr-2 h-4 w-4" /> 
                  )}
                  {isUploading ? 'Enviando...' : (project.clientRenderImageUrl ? 'Trocar Imagem' : 'Carregar Imagem')}
                </Button>
                <input 
                  id="render-upload" 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleImageUpload} 
                  disabled={project.status === 'processing' || isUploading}
                />
              </label>
            </CardFooter>
          </Card>
        </div>

        {/* Coluna dos Itens e Sugestões (ATUALIZADA COM LÓGICA DE SELEÇÃO) */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-2xl font-semibold">Móveis Identificados e Sugestões</h2>
          {(project.status === 'new' || !project.clientRenderImageUrl) && (
             <p className="text-muted-foreground">Carregue uma imagem para a IA analisar.</p>
          )}
          {project.status === 'processing' && (
             <p className="text-muted-foreground">Aguarde enquanto a IA processa a imagem...</p>
          )}
           {project.status === 'failed' && (
             <p className="text-red-500">Ocorreu um erro ao processar a imagem.</p>
          )}
          {(project.status === 'awaiting_selection' || project.status === 'completed') && (!project.items || project.items.length === 0) && (
             <p className="text-muted-foreground">A IA processou a imagem, mas não identificou móveis para sugerir substituições.</p>
          )}
          
          {(project?.items && project.items.length > 0 && (project.status === 'awaiting_selection' || project.status === 'completed')) && (
            project.items.map((item) => {
              // <<< Pegar seleção local para este item >>>
              const currentSelection = localSelections[item.id];
              const isSelecting = selectProductMutation.isPending && selectProductMutation.variables?.itemId === item.id;

              return (
                <Card key={item.id} className={currentSelection ? 'border-primary' : ''}> {/* Destaca card se item selecionado */}
                  <CardHeader>
                    <CardTitle>Item Detectado:</CardTitle>
                    <CardDescription>{item.detectedObjectDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <h4 className="font-semibold">Sugestões do Catálogo:</h4>
                    
                    {[ 
                      { details: item.suggestedProduct1Details, score: item.matchScore1 },
                      { details: item.suggestedProduct2Details, score: item.matchScore2 },
                      { details: item.suggestedProduct3Details, score: item.matchScore3 },
                    ].map((suggestion, index) => {
                      if (!suggestion.details) return null; // Pular se não houver detalhes
                      
                      const productId = suggestion.details.id;
                      const isSelected = currentSelection === productId;
                      const isThisOneLoading = isSelecting && selectProductMutation.variables?.selectedProductId === productId;

                      return (
                        <div key={index} className={`flex items-center gap-4 p-3 border rounded-md ${isSelected ? 'bg-primary/10 border-primary/50' : 'bg-secondary/30'}`}>
                          {/* Imagem do Produto Sugerido */} 
                          <div className="w-16 h-16 bg-muted rounded flex items-center justify-center overflow-hidden shrink-0">
                            {suggestion.details.imageUrl ? (
                              <img src={suggestion.details.imageUrl} alt={suggestion.details.name} className="w-full h-full object-cover" />
                            ) : (
                              // Usar ícone baseado na descrição ou categoria?
                              item.detectedObjectDescription.toLowerCase().includes('sofá') || item.detectedObjectDescription.toLowerCase().includes('poltrona') ? 
                              <Sofa className="w-8 h-8 text-muted-foreground" /> : 
                              <Table className="w-8 h-8 text-muted-foreground" />
                            )}
                          </div>
                          {/* Nome e Score */}
                          <div className="flex-grow">
                            <p className="font-medium">{suggestion.details.name}</p>
                            <p className="text-sm text-muted-foreground">Similaridade: {suggestion.score ? `${(suggestion.score * 100).toFixed(0)}%` : 'N/A'}</p>
                          </div>
                          {/* Botões */}
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                              <Button 
                                size="sm" 
                                variant={isSelected ? "default" : "secondary"} // Mudar variante se selecionado
                                disabled={isSelecting} // Desabilitar todos botões do item durante a mutação
                                onClick={() => {
                                  // Se já selecionado, clicar de novo desmarca (ou outra lógica)
                                  const newSelectedId = isSelected ? null : productId;
                                  selectProductMutation.mutate({ itemId: item.id, selectedProductId: newSelectedId });
                                }}
                              >
                                {isThisOneLoading ? (
                                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                ) : (
                                  isSelected ? <CheckCircle className="mr-1 h-4 w-4 text-primary-foreground" /> : <CheckCircle className="mr-1 h-4 w-4" />
                                )}
                                {isThisOneLoading ? 'Salvando...' : (isSelected ? 'Selecionado' : 'Selecionar')}
                              </Button>
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Mensagem se nenhuma sugestão foi encontrada */}
                    {!item.suggestedProductId1 && !item.suggestedProductId2 && !item.suggestedProductId3 && (
                       <p className="text-sm text-muted-foreground italic">Nenhuma sugestão encontrada para este item.</p>
                    )}
                  </CardContent>
                   <CardFooter className="flex justify-end">
                     {/* TODO: Adicionar feedback 👍👎 ou outras ações */}
                   </CardFooter>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignAiProjectPage; 