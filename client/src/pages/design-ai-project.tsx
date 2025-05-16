import React, { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from "@/components/ui/progress";
import { Upload, Image as ImageIcon, CheckCircle, XCircle, Clock, Eye, Sofa, Table, Plus, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/hooks/use-toast";
import { callGenerateFinalRenderApi, getDesignProjectDetailsApi, updateDesignProjectItemApi, uploadProjectImageApi } from "../lib/apiClient";

// --- Mock Data --- 
// (Simula os tipos que viriam do backend - @shared/schema)
type MockDesignProject = {
  id: number;
  name: string;
  status: 'new' | 'processing' | 'awaiting_selection' | 'processed_no_items' | 'completed' | 'failed' | 'rendering_final';
  clientRenderImageUrl: string | null;
  generatedRenderUrl?: string | null;
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
  detectedObjectName?: string | null;
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
  generatedInpaintedImageUrl?: string | null;
  notes?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
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
      status: 'awaiting_selection',
      clientRenderImageUrl: "/placeholder-render.jpg",
      items: [
        {
          id: 101,
          designProjectId: 1,
          detectedObjectName: "Sofá de 3 lugares",
          detectedObjectDescription: "Sofá de 3 lugares cinza, estilo moderno",
          detectedObjectBoundingBox: { x: 10, y: 30, w: 50, h: 40 },
          suggestedProductId1: 15,
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
          generatedInpaintedImageUrl: null,
          notes: null
        },
        {
          id: 102,
          designProjectId: 1,
          detectedObjectName: "Mesa de centro",
          detectedObjectDescription: "Mesa de centro retangular de madeira escura",
          detectedObjectBoundingBox: { x: 30, y: 60, w: 30, h: 20 },
          suggestedProductId1: 42,
          suggestedProduct1Details: mockProductsDb[42] || null,
          matchScore1: 0.88,
          suggestedProductId2: 5,
          suggestedProduct2Details: mockProductsDb[5] || null,
          matchScore2: 0.81,
          suggestedProductId3: null,
          suggestedProduct3Details: null,
          matchScore3: null,
          selectedProductId: null,
          userFeedback: null,
          generatedInpaintedImageUrl: null,
          notes: null
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

// Função mock para simular o upload da imagem (PODE SER REMOVIDA/COMENTADA)
/*
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
*/

// Função mock para simular a seleção de um produto (PODE SER REMOVIDA/COMENTADA)
/*
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
*/

// Função mock para simular a geração do render final
const triggerFinalRender = async (projectId: number): Promise<{ message: string }> => {
  console.log(`[Mock API] Triggering final render for project ${projectId}...`);
  await new Promise(resolve => setTimeout(resolve, 2500)); // Aumentar delay para simular processamento
  
  const projectData = getMockProjectData(projectId);
  if (projectData) {
    projectData.status = 'completed'; // Simular que o render foi concluído
    projectData.generatedRenderUrl = "/placeholder-render-final.jpg"; // <<< Adicionar URL mockada para o render final
    console.log(`[Mock API] Project ${projectId} status updated to completed. Final render URL: ${projectData.generatedRenderUrl}`);
  }
  return { message: "Render final gerado com sucesso!" }; // Mensagem de sucesso para o toast
};

// --- Fim Mock Data & API ---

const DesignAiProjectPage: React.FC = () => {
  const params = useParams();
  const projectId = parseInt(params.id || '0');
  const { toast } = useToast();
  const queryClient = useQueryClient(); // Para invalidar queries

  const { data: project, isLoading, isError, error } = useQuery<MockDesignProject | null, Error>({
    queryKey: ['designProject', projectId],
    queryFn: () => getDesignProjectDetailsApi(projectId), // <<< USAR A FUNÇÃO DE API REAL
    enabled: !!projectId, 
  });

  // Definir a Mutação para upload
  const uploadMutation = useMutation<
    MockDesignProject, // <<< TIPO DE RETORNO ATUALIZADO para MockDesignProject
    Error, 
    { projectId: number, file: File, userMessageText?: string } // Adicionado userMessageText opcional
  >({
    mutationFn: (variables) => uploadProjectImageApi(variables.projectId, variables.file, variables.userMessageText), // <<< USAR A FUNÇÃO DE API REAL
    onSuccess: (updatedProject) => { // Recebe o projeto atualizado
      toast({ title: "Upload Concluído", description: `Imagem ${updatedProject.clientRenderImageUrl ? 'enviada' : 'não processada'}. Análise iniciada.` });
      queryClient.invalidateQueries({ queryKey: ['designProject', projectId] });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro no Upload", description: error.message || "Não foi possível enviar a imagem." });
    },
  });

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && projectId) {
      console.log("Arquivo selecionado:", file.name);
      // Poderíamos adicionar um input para userMessageText se necessário, por agora não passaremos
      uploadMutation.mutate({ projectId, file }); 
    }
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
      case 'rendering_final': return { text: 'Gerando Render Final', icon: Loader2, color: 'text-purple-500', progress: 90 };
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
    MockDesignProjectItem, 
    Error,
    { itemId: number, selectedProductId: number | null } 
  >({
    mutationFn: (variables) => updateDesignProjectItemApi(projectId, variables.itemId, { selectedProductId: variables.selectedProductId }), // <<< USAR A FUNÇÃO DE API REAL
    onSuccess: (updatedItem, variables) => { 
      toast({ title: "Seleção Salva", description: `Produto ID ${variables.selectedProductId} selecionado para o item ${variables.itemId}.` });
      setLocalSelections(prev => ({ ...prev, [variables.itemId]: variables.selectedProductId }));
      queryClient.invalidateQueries({ queryKey: ['designProject', projectId] }); 
      if (variables.selectedProductId) { 
          toast({ title: "Gerando Prévia...", description: "A imagem de prévia para este item está sendo gerada e aparecerá em breve.", duration: 7000 });
      }
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Erro ao Salvar Seleção", description: error.message || "Não foi possível salvar a seleção." });
    },
  });

  // <<< NOVA MUTAÇÃO para gerar render final >>>
  const generateRenderMutation = useMutation<
    { message: string }, 
    Error, 
    { projectId: number } 
  >({
    mutationFn: (variables) => callGenerateFinalRenderApi(variables.projectId), // <<< USAR A FUNÇÃO DE API REAL
    onMutate: () => {
      toast({ 
        title: "Iniciando Geração do Render", 
        description: "Seu ambiente personalizado está sendo preparado...",
      });
    },
    onSuccess: (data) => {
      toast({ 
        title: "Render em Processamento!", 
        description: data.message || "O render final foi solicitado. Você será notificado quando estiver pronto."
      });
      queryClient.invalidateQueries({ queryKey: ['designProject', projectId] });
    },
    onError: (error) => {
      toast({ 
        variant: "destructive", 
        title: "Erro ao Gerar Render", 
        description: error.message || "Não foi possível iniciar a geração do render."
      });
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
  const isGeneratingRender = generateRenderMutation.isPending;

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
      {project.status === 'rendering_final' && (
         <Progress value={90} className="w-full h-2 mb-6" /> // Progresso para rendering_final
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Coluna da Imagem e Upload (ATUALIZADA) */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {project.status === 'completed' && project.generatedRenderUrl 
                  ? "Render Final do Ambiente"
                  : "Imagem do Cliente (Render)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* <<< LÓGICA DE EXIBIÇÃO ATUALIZADA >>> */}
              {project.status === 'completed' && project.generatedRenderUrl ? (
                <div>
                  <img src={project.generatedRenderUrl} alt="Render Final do Ambiente" className="rounded-md object-cover w-full h-auto" />
                  <p className="text-xs text-muted-foreground mt-2 text-center">Este é o render final gerado com suas seleções.</p>
                </div>
              ) : project.clientRenderImageUrl ? (
                <img src={project.clientRenderImageUrl} alt="Render do Cliente" className="rounded-md object-cover w-full h-auto" />
              ) : (
                <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-16 w-16" />
                </div>
              )}
            </CardContent>
            <CardFooter>
              {/* Manter o botão de upload se o render final não foi gerado ou se o usuário quiser trocar a imagem base */}
              {!(project.status === 'completed' && project.generatedRenderUrl) && (
                <label htmlFor="render-upload" className="w-full">
                  <Button 
                    variant="outline" 
                    className="w-full" 
                    disabled={project.status === 'processing' || isUploading || isGeneratingRender}
                  >
                    {isUploading ? (
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                       <Upload className="mr-2 h-4 w-4" /> 
                    )}
                    {isUploading ? 'Enviando...' : (project.clientRenderImageUrl ? 'Trocar Imagem Base' : 'Carregar Imagem Base')}
                  </Button>
                  <input 
                    id="render-upload" 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload} 
                    disabled={project.status === 'processing' || isUploading || isGeneratingRender}
                  />
                </label>
              )}
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
                <Card key={item.id} className={currentSelection ? 'border-primary' : ''}>
                  <CardHeader>
                    <CardTitle>Item Detectado: {item.detectedObjectName || 'Móvel'}</CardTitle>
                    <CardDescription>{item.detectedObjectDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {item.generatedInpaintedImageUrl ? (
                      <div>
                        <h4 className="font-semibold mb-2">Prévia com Produto Selecionado:</h4>
                        <div className="aspect-video bg-muted rounded-md flex items-center justify-center overflow-hidden border">
                          <img 
                            src={item.generatedInpaintedImageUrl} 
                            alt={`Prévia do ambiente com ${item.detectedObjectName || 'produto selecionado'}`} 
                            className="w-full h-full object-contain" 
                          />
                        </div>
                        <Button 
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            selectProductMutation.mutate({ itemId: item.id, selectedProductId: null });
                          }}
                          disabled={selectProductMutation.isPending && selectProductMutation.variables?.itemId === item.id}
                        >
                          { (selectProductMutation.isPending && selectProductMutation.variables?.itemId === item.id && selectProductMutation.variables?.selectedProductId === null) ? 
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null }
                          Alterar Seleção / Ver Sugestões
                        </Button>
                      </div>
                    ) : (
                      <> 
                        <h4 className="font-semibold">Sugestões do Catálogo:</h4>
                        {[ 
                          { details: item.suggestedProduct1Details, score: item.matchScore1 },
                          { details: item.suggestedProduct2Details, score: item.matchScore2 },
                          { details: item.suggestedProduct3Details, score: item.matchScore3 },
                        ].map((suggestion, index) => {
                          if (!suggestion.details) return null;
                          const productId = suggestion.details.id;
                          const isSelected = currentSelection === productId;
                          const isThisOneLoading = selectProductMutation.isPending && selectProductMutation.variables?.itemId === item.id && selectProductMutation.variables?.selectedProductId === productId;

                          return (
                            <div key={index} className={`flex items-center gap-4 p-3 border rounded-md ${isSelected ? 'bg-primary/10 border-primary/50' : 'bg-secondary/30'}`}>
                              <div className="w-16 h-16 bg-muted rounded flex items-center justify-center overflow-hidden shrink-0">
                                {suggestion.details.imageUrl ? (
                                  <img src={suggestion.details.imageUrl} alt={suggestion.details.name} className="w-full h-full object-cover" />
                                ) : (
                                  item.detectedObjectDescription.toLowerCase().includes('sofá') || item.detectedObjectDescription.toLowerCase().includes('poltrona') ? 
                                  <Sofa className="w-8 h-8 text-muted-foreground" /> : 
                                  <Table className="w-8 h-8 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-grow">
                                <p className="font-medium">{suggestion.details.name}</p>
                                <p className="text-sm text-muted-foreground">Similaridade: {suggestion.score ? `${(suggestion.score * 100).toFixed(0)}%` : 'N/A'}</p>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                  <Button 
                                    size="sm" 
                                    variant={isSelected ? "default" : "secondary"}
                                    disabled={selectProductMutation.isPending && selectProductMutation.variables?.itemId === item.id}
                                    onClick={() => {
                                      const newSelectedId = isSelected ? null : productId;
                                      selectProductMutation.mutate({ itemId: item.id, selectedProductId: newSelectedId });
                                    }}
                                  >
                                    {isThisOneLoading ? (
                                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                    ) : (
                                      isSelected ? <CheckCircle className="mr-1 h-4 w-4 text-primary-foreground" /> : <CheckCircle className="mr-1 h-4 w-4" />
                                    )}
                                    {isThisOneLoading ? 'Salvando...' : (isSelected ? 'Selecionado' : 'Limpar')}
                                  </Button>
                              </div>
                            </div>
                          );
                        })}
                        
                        {!item.suggestedProductId1 && !item.suggestedProductId2 && !item.suggestedProductId3 && (
                           <p className="text-sm text-muted-foreground italic">Nenhuma sugestão encontrada para este item.</p>
                        )}
                      </>
                    )}
                  </CardContent>
                   <CardFooter className="flex justify-end">
                     {/* TODO: Adicionar feedback 👍👎 ou outras ações */}
                   </CardFooter>
                </Card>
              );
            })
          )}

          {/* <<< NOVO BOTÃO E CARD PARA GERAR RENDER FINAL >>> */}
          {(project.status === 'awaiting_selection' || project.status === 'completed') && (project.items && project.items.some(item => item.selectedProductId !== null)) && (
            <Card>
              <CardHeader>
                <CardTitle>Render Final do Ambiente</CardTitle>
                <CardDescription>
                  Gere uma nova imagem do seu ambiente com todos os produtos selecionados aplicados.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Este processo pode levar alguns minutos. Você será notificado aqui quando estiver pronto.
                </p>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  onClick={() => generateRenderMutation.mutate({ projectId })}
                  disabled={isGeneratingRender}
                >
                  {isGeneratingRender ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" /> // Usar um ícone apropriado
                  )}
                  {isGeneratingRender ? 'Gerando Render...' : 'Gerar Render Final com Selecionados'}
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignAiProjectPage; 