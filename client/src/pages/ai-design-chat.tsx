import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { AiDesignProject, AiDesignChatMessage, User, FloorPlan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, ArrowLeft, Image, FileUp, Trash2, UploadCloud, ImageIcon, ListTree, PlusCircle } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';

export default function AiDesignChatPage({ params }: { params: { id: string } }) {
  const projectId = parseInt(params.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Estado para a instância do WebSocket
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);

  // Buscar projeto
  const { data: project, isLoading: isProjectLoading } = useQuery<AiDesignProject>({
    queryKey: [`/api/ai-design-projects/${projectId}`],
    queryFn: async () => {
      const res = await fetch(`/api/ai-design-projects/${projectId}`);
      if (!res.ok) throw new Error('Falha ao carregar projeto');
      return res.json();
    },
    enabled: !!projectId && !isNaN(projectId),
  });

  // Buscar mensagens
  const { data: messages, isLoading: isMessagesLoading, refetch: refetchMessages } = useQuery<AiDesignChatMessage[]>({
    queryKey: [`/api/ai-design-projects/${projectId}/messages`],
    queryFn: async () => {
      if (isNaN(projectId)) return [];
      const res = await fetch(`/api/ai-design-projects/${projectId}/messages`);
      if (!res.ok) throw new Error('Falha ao carregar mensagens');
      return res.json();
    },
    enabled: !!projectId && !isNaN(projectId),
  });

  // NOVA Query para buscar plantas baixas
  const fetchFloorPlans = async (projectId: number | undefined): Promise<FloorPlan[]> => {
    if (!projectId || isNaN(projectId)) {
      console.warn("[fetchFloorPlans] projectId inválido ou não fornecido, retornando array vazio.");
      return [];
    }
    console.log(`[fetchFloorPlans] Buscando plantas para projeto ID: ${projectId}`);
    const { data } = await axios.get<FloorPlan[]>(`/api/floorplans?aiDesignProjectId=${projectId}`);
    return data;
  };

  // CORRIGIDO: Query para buscar plantas baixas usando sintaxe de objeto
  const { data: floorPlans, isLoading: isLoadingFloorPlans, error: floorPlansError, refetch: refetchFloorPlans } = useQuery<FloorPlan[], Error>({
    queryKey: ['floorPlans', projectId], 
    queryFn: () => fetchFloorPlans(projectId),
    enabled: !!projectId && !isNaN(projectId), // Só executa se projectId estiver definido e for um número
  });

  // Estados para o formulário de upload de planta baixa
  const [selectedFloorPlanFile, setSelectedFloorPlanFile] = useState<File | null>(null);
  const [floorPlanName, setFloorPlanName] = useState('');
  const [isUploadingFloorPlan, setIsUploadingFloorPlan] = useState(false);

  // useEffect para WebSockets
  useEffect(() => {
    if (!projectId || isNaN(projectId)) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?projectId=${projectId}`;
    
    console.log(`[WebSocket Frontend] Tentando conectar a: ${wsUrl}`);
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log(`[WebSocket Frontend] Conexão estabelecida para projeto ${projectId}. URL: ${wsUrl}`);
      setWebsocket(newWs);
    };

    newWs.onmessage = (event) => {
      console.log("[WebSocket] Mensagem recebida do servidor:", event.data);
      try {
        const serverMessage = JSON.parse(event.data as string);
        console.log("[WebSocket] Mensagem parseada:", serverMessage);

        if (serverMessage.type === 'NEW_AI_MESSAGE' && serverMessage.payload) {
          queryClient.setQueryData<AiDesignChatMessage[]>(
            [`/api/ai-design-projects/${projectId}/messages`],
            (oldMessages = []) => [...oldMessages, serverMessage.payload]
          );
        } else if (serverMessage.type === 'PROCESSING_ERROR' && serverMessage.payload) {
          toast({
            title: "Erro no Processamento da IA",
            description: serverMessage.payload.message || "Ocorreu um erro no servidor.",
            variant: "destructive",
          });
        }

      } catch (error) {
        console.error("[WebSocket] Erro ao parsear mensagem do servidor:", error);
      }
    };

    newWs.onerror = (errorEvent) => {
      console.error(`[WebSocket Frontend] Erro na conexão do projeto ${projectId}:`, errorEvent);
      toast({ 
        title: "Erro de WebSocket", 
        description: "A conexão com o chat em tempo real falhou.", 
        variant: "destructive" 
      });
    };

    newWs.onclose = (event) => {
      console.log(`[WebSocket Frontend] Desconectado do projeto ${projectId}. Código: ${event.code}, Razão: "${event.reason}"`);
      toast({ 
        title: "Chat Desconectado", 
        description: `Conexão em tempo real perdida: ${event.reason || event.code}`,
        variant: "default"
      });
      setWebsocket(null);
    };

    return () => {
      console.log("[WebSocket Frontend] Fechando conexão WebSocket ao desmontar componente...");
      newWs.close();
    };
  }, [projectId, toast]);

  // Enviar mensagem
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, attachmentUrl }: { content: string; attachmentUrl?: string }) => {
      const res = await fetch(`/api/ai-design-projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "user",
          content,
          attachmentUrl,
        }),
      });
      if (!res.ok) throw new Error('Falha ao enviar mensagem');
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      setFile(null);
    },
    onError: (error) => {
      toast({
        title: "Erro ao enviar mensagem",
        description: error instanceof Error ? error.message : "Ocorreu um erro inesperado",
        variant: "destructive",
      });
    },
  });

  // Função para fazer upload de arquivo
  const uploadFile = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`/api/ai-design-projects/${projectId}/attachments`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      let errorMsg = 'Falha ao fazer upload do arquivo';
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorMsg;
      } catch (e) {
        errorMsg = response.statusText || errorMsg;
      }
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    if (!data.url) {
      throw new Error('URL do anexo não retornada pelo servidor.');
    }
    return data.url;
  };

  // Manipulador para enviar mensagem
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if ((!message.trim() && !file) || sendMessageMutation.isPending) {
      return;
    }
    
    try {
      let attachmentUrl;
      
      if (file) {
        try {
          attachmentUrl = await uploadFile(file);
        } catch (error) {
          toast({
            title: "Erro ao fazer upload do arquivo",
            description: error instanceof Error ? error.message : "Ocorreu um erro ao fazer upload do arquivo",
            variant: "destructive",
          });
          return;
        }
      }
      
      await sendMessageMutation.mutateAsync({
        content: message,
        attachmentUrl,
      });
    } catch (error) {
      // Erro já tratado no onError do mutation
    }
  };

  // Manipulador para selecionar arquivo
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files && e.target.files[0];
    if (selectedFile) {
      // Verificar se é uma imagem
      if (!selectedFile.type.startsWith('image/')) {
        toast({
          title: "Tipo de arquivo inválido",
          description: "Por favor, selecione apenas arquivos de imagem",
          variant: "destructive",
        });
        return;
      }
      
      // Verificar tamanho (máximo de 5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        toast({
          title: "Arquivo muito grande",
          description: "O tamanho máximo permitido é 5MB",
          variant: "destructive",
        });
        return;
      }
      
      setFile(selectedFile);
    }
  };

  // Limpar arquivo selecionado
  const handleClearFile = () => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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

  // Rolar para o final da conversa quando mensagens são carregadas ou uma nova mensagem é enviada
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Função para lidar com a seleção do arquivo de planta baixa
  const handleFloorPlanFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedFloorPlanFile(event.target.files[0]);
      // Opcional: usar o nome do arquivo como nome padrão da planta
      if (!floorPlanName) {
        setFloorPlanName(event.target.files[0].name.replace(/\.[^/.]+$/, "")); // Remove extensão
      }
    }
  };

  // NOVA MUTATION/FUNÇÃO para fazer upload da planta baixa
  const handleFloorPlanUpload = async () => {
    if (!selectedFloorPlanFile || !projectId) {
      toast({
        title: "Erro no Upload",
        description: "Por favor, selecione um arquivo de planta baixa e certifique-se de que o projeto é válido.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingFloorPlan(true);
    const formData = new FormData();
    formData.append('file', selectedFloorPlanFile);
    if (floorPlanName) {
      formData.append('name', floorPlanName);
    }

    try {
      await axios.post(`/api/floorplans/upload/${projectId}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      toast({
        title: "Sucesso!",
        description: "Planta baixa enviada e está sendo processada.",
      });
      setSelectedFloorPlanFile(null);
      setFloorPlanName('');
      refetchFloorPlans(); // Rebuscar a lista de plantas baixas
    } catch (uploadError: any) {
      console.error("Erro ao fazer upload da planta baixa:", uploadError);
      toast({
        title: "Falha no Upload",
        description: uploadError.response?.data?.message || "Não foi possível enviar a planta baixa.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingFloorPlan(false);
    }
  };

  // Renderizar página de carregamento
  if (isProjectLoading || isMessagesLoading) {
    return (
      <div className="container mx-auto py-10 flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Verificar se o projeto existe
  if (!project) {
    return (
      <div className="container mx-auto py-10">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Erro!</strong>
          <span className="block sm:inline"> Projeto não encontrado</span>
        </div>
        <div className="mt-4">
          <Button asChild>
            <Link to="/ai-design">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center mb-6">
        <Button variant="ghost" asChild className="mr-4">
          <Link to="/ai-design">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <Badge className={getStatusColor(project.status) + " text-white"}>
              {getStatusText(project.status)}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Criado {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true, locale: ptBR })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Painel lateral com informações e imagens */}
        <div className="md:col-span-1 space-y-6">
          <Card className="p-4">
            <h2 className="text-lg font-medium mb-4">Imagens do Projeto</h2>
            <div className="space-y-4">
              {!project.floorPlanImageUrl && !project.renderImageUrl ? (
                <div className="bg-muted rounded-lg p-4 text-center">
                  <Image className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Envie imagens da planta baixa e do render para começar.
                  </p>
                </div>
              ) : (
                <>
                  {project.floorPlanImageUrl && (
                    <div>
                      <Label className="mb-2 block">Planta Baixa Cliente (do Projeto)</Label>
                      <div className="rounded-md overflow-hidden">
                        <img
                          src={project.floorPlanImageUrl}
                          alt="Planta Baixa Cliente"
                          className="w-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                  {project.renderImageUrl && (
                    <div className="mt-4">
                      <Label className="mb-2 block">Render Original</Label>
                      <div className="rounded-md overflow-hidden">
                        <img
                          src={project.renderImageUrl}
                          alt="Render"
                          className="w-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                  {project.generatedFloorPlanUrl && (
                    <div className="mt-4">
                      <Label className="mb-2 block">Planta Baixa Gerada</Label>
                      <div className="rounded-md overflow-hidden">
                        <img
                          src={project.generatedFloorPlanUrl}
                          alt="Planta Baixa Gerada"
                          className="w-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                  {project.generatedRenderUrl && (
                    <div className="mt-4">
                      <Label className="mb-2 block">Render Gerado</Label>
                      <div className="rounded-md overflow-hidden">
                        <img
                          src={project.generatedRenderUrl}
                          alt="Render Gerado"
                          className="w-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* NOVA SEÇÃO DE PLANTAS BAIXAS DO PROJETO (UPLOAD E LISTAGEM) */}
          <Card className="p-4 sm:p-6 shadow rounded-lg">
            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center">
              <ListTree size={24} className="mr-2 text-blue-500" />
              Plantas Baixas Detalhadas
            </h2>

            {/* Formulário de Upload */}
            <div className="space-y-3 mb-6 pb-6 border-b border-gray-200">
              <Label htmlFor="floorPlanFile" className="text-sm font-medium text-gray-600">Adicionar Nova Planta Baixa Detalhada</Label>
              <Input 
                id="floorPlanFile" 
                type="file" 
                onChange={handleFloorPlanFileChange} 
                className="text-sm" 
                accept="image/png, image/jpeg, image/webp"
              />
              <Input 
                type="text" 
                placeholder="Nome da planta (opcional)" 
                value={floorPlanName} 
                onChange={(e) => setFloorPlanName(e.target.value)} 
                className="text-sm mt-2"
              />
              <Button onClick={handleFloorPlanUpload} disabled={isUploadingFloorPlan || !selectedFloorPlanFile} className="w-full text-sm">
                {isUploadingFloorPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud size={16} className="mr-2" />}
                Enviar Planta
              </Button>
            </div>

            {/* Lista de Plantas Baixas */}
            {isLoadingFloorPlans && <p className="text-sm text-gray-500">Carregando plantas baixas...</p>}
            {floorPlansError && <p className="text-sm text-red-500">Erro ao carregar plantas: {floorPlansError.message}</p>}
            {!isLoadingFloorPlans && !floorPlansError && (
              <ul className="space-y-3">
                {floorPlans && floorPlans.length > 0 ? (
                  floorPlans.map((plan) => (
                    <li key={plan.id} className="p-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors text-sm">
                      <Link href={`/floorplans/${plan.id}/editor`} className="flex items-center justify-between group">
                        <div className="flex items-center">
                          <ImageIcon size={18} className="mr-3 text-gray-400 group-hover:text-blue-500" />
                          <span className="text-gray-700 group-hover:text-blue-600 font-medium truncate" title={plan.name}>{plan.name}</span>
                        </div>
                        <span className="text-xs text-gray-400 group-hover:text-blue-500 ml-2 whitespace-nowrap">Ver/Editar</span>
                      </Link>
                      {plan.originalImageUrl && (
                        <a href={plan.originalImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline mt-1 block truncate" title={plan.originalImageUrl}>Ver original</a>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Status IA: <span className="font-medium">{plan.iaStatus || 'N/A'}</span></p>
                    </li>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Nenhuma planta baixa detalhada adicionada a este projeto ainda.</p>
                )}
              </ul>
            )}
          </Card>
        </div>

        {/* Chat */}
        <div className="md:col-span-2">
          <Card className="flex flex-col h-[75vh]">
            <div 
              className="flex-grow p-4 overflow-y-auto" 
              ref={chatContainerRef}
            >
              {messages && messages.length > 0 ? (
                <div className="space-y-6">
                  {messages.map((msg: AiDesignChatMessage) => {
                    // Tratamento seguro da data
                    let formattedDate = 'Horário indisponível';
                    if (msg.createdAt) {
                      try {
                        const dateObj = new Date(msg.createdAt);
                        // Verificar se a data é válida após a conversão
                        if (!isNaN(dateObj.getTime())) {
                          formattedDate = formatDistanceToNow(dateObj, {
                            addSuffix: true,
                            locale: ptBR,
                          });
                        } else {
                          console.warn("ChatMessage: createdAt inválido após new Date():", msg.createdAt);
                        }
                      } catch (dateError) {
                        console.error("ChatMessage: Erro ao processar createdAt:", msg.createdAt, dateError);
                      }
                    } else if ((msg as any).timestamp) { // Fallback para mensagens com campo 'timestamp' (ex: conexão ws)
                       try {
                        const dateObj = new Date((msg as any).timestamp);
                        if (!isNaN(dateObj.getTime())) {
                          formattedDate = formatDistanceToNow(dateObj, {
                            addSuffix: true,
                            locale: ptBR,
                          });
                        }
                      } catch (dateError) {
                        console.error("ChatMessage: Erro ao processar timestamp (fallback):", (msg as any).timestamp, dateError);
                      }
                    }

                    return (
                      <div key={msg.id || `msg-${(msg as any).timestamp || Math.random()}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} gap-3 max-w-[80%]`}>
                          <Avatar className={`${msg.role === 'user' ? 'mt-1' : 'mt-1'} h-8 w-8`}>
                            <AvatarFallback className={msg.role === 'user' ? 'bg-primary' : 'bg-secondary'}>
                              {msg.role === 'user' ? 'U' : 'AI'}
                            </AvatarFallback>
                          </Avatar>
                          <div className={`rounded-lg p-3 break-words ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : msg.role === 'system' ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                            {msg.role === 'assistant' ? (
                              <ReactMarkdown
                                components={{
                                  // Opcional: customizar como as imagens são renderizadas, se necessário
                                  // img: ({node, ...props}) => <img style={{maxWidth: '100%', maxHeight: '300px', borderRadius: '4px'}} {...props} />
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            ) : (
                              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                            )}
                            {msg.attachmentUrl && (
                              <div className="mt-2">
                                <img
                                  src={msg.attachmentUrl}
                                  alt="Anexo"
                                  className="mt-2 rounded-md max-h-64 max-w-full object-contain"
                                />
                              </div>
                            )}
                            <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-primary-foreground/70' : 'text-secondary-foreground/70'}`}>
                              {formattedDate}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center">
                  <Image className="h-16 w-16 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Comece a conversar</h3>
                  <p className="text-muted-foreground text-center max-w-md mb-4">
                    Envie uma mensagem para começar a conversa. Você pode enviar imagens de plantas baixas e renders para que a IA analise e sugira móveis do seu catálogo.
                  </p>
                </div>
              )}
            </div>

            <Separator />

            {/* Área do arquivo selecionado */}
            {file && (
              <div className="p-3 bg-muted/30 border-t">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Image className="h-5 w-5 mr-2 text-muted-foreground" />
                    <span className="text-sm truncate max-w-[300px]">{file.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFile}
                    className="h-8 w-8 p-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Formulário para enviar mensagem */}
            <form onSubmit={handleSendMessage} className="p-4 border-t">
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sendMessageMutation.isPending}
                >
                  <FileUp className="h-5 w-5" />
                  <span className="sr-only">Anexar imagem</span>
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                  disabled={sendMessageMutation.isPending}
                />
                <div className="flex-grow">
                  <Textarea
                    placeholder="Digite sua mensagem... Descreva se está enviando uma planta baixa ou um render."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="resize-none min-h-[80px]"
                    disabled={sendMessageMutation.isPending}
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={
                    sendMessageMutation.isPending || 
                    (!message.trim() && !file)
                  }
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                  <span className="sr-only">Enviar</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {project.status === "processing" 
                  ? "Aguarde enquanto processamos suas imagens..." 
                  : "Envie imagens da planta baixa e do render para que a IA possa analisar e sugerir móveis."}
              </p>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}