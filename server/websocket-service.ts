/**
 * Serviço de WebSocket para o servidor
 * 
 * Este serviço gerencia conexões WebSocket e fornece uma API para enviar
 * mensagens em tempo real aos clientes conectados.
 */

import { WebSocket, WebSocketServer } from 'ws';

// Constantes para estados de WebSocket para evitar usar WebSocket como namespace
const WS_OPEN = 1; // WebSocket.OPEN

// Tipos de eventos que podem ser enviados para os clientes
export type WebSocketEventType = 
  | 'PRODUCT_CREATED' 
  | 'PRODUCT_UPDATED' 
  | 'PRODUCT_DELETED'
  | 'CATALOG_CREATED'
  | 'CATALOG_UPDATED'
  | 'CATALOG_DELETED'
  | 'QUOTE_CREATED'
  | 'QUOTE_UPDATED'
  | 'DESIGN_PROJECT_UPDATED'
  | 'CHAT_MESSAGE'
  | 'PROJECT_UPDATE';

// Estrutura de uma mensagem WebSocket
export interface WebSocketMessage {
  type: WebSocketEventType;
  payload: any;
  timestamp: number;
}

// Interface para uma conexão de cliente
interface ClientConnection {
  socket: WebSocket;
  userId?: number; // ID do usuário associado à conexão
  projectId?: string; // ID do projeto específico (se aplicável)
  lastActivity: number; // Timestamp da última atividade
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientConnection> = new Map();
  private projectClients: Map<string, Set<WebSocket>> = new Map();
  private userClients: Map<number, Set<WebSocket>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  // Inicializa o WebSocketServer
  initialize(wss: WebSocketServer) {
    if (this.wss) {
      console.warn('[WebSocketManager] WebSocketServer já inicializado.');
      return;
    }

    this.wss = wss;
    console.log('[WebSocketManager] Inicializando serviço WebSocket...');

    // Configurar event handlers
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      console.error('[WebSocketManager] Erro no servidor WebSocket:', error);
    });

    // Iniciar ping para manter conexões ativas e detectar clientes desconectados
    this.startPingInterval();
    
    console.log('[WebSocketManager] Serviço WebSocket inicializado com sucesso.');
  }

  // Trata nova conexão de cliente
  private handleConnection(socket: WebSocket, request: any) {
    // Extrair dados da URL de conexão (ex: projectId, userId, etc.)
    const url = new URL(request.url, `http://${request.headers.host}`);
    const projectId = url.searchParams.get('projectId');
    
    // Associar a socket com informações do cliente
    const clientConnection: ClientConnection = {
      socket,
      projectId: projectId || undefined,
      lastActivity: Date.now()
    };
    
    this.clients.set(socket, clientConnection);
    
    // Se um projectId foi fornecido, adicionar ao mapa de projetos
    if (projectId) {
      if (!this.projectClients.has(projectId)) {
        this.projectClients.set(projectId, new Set());
      }
      this.projectClients.get(projectId)?.add(socket);
      console.log(`[WebSocketManager] Cliente conectado ao projeto ${projectId}. Total de clientes: ${this.clients.size}`);
    } else {
      console.log(`[WebSocketManager] Novo cliente conectado. Total de clientes: ${this.clients.size}`);
    }

    // Configurar event handlers para este socket
    socket.on('message', (message) => this.handleMessage(socket, message));
    
    socket.on('close', () => {
      this.handleDisconnect(socket);
    });

    socket.on('error', (error) => {
      console.error('[WebSocketManager] Erro no socket de cliente:', error);
      // O evento 'close' será chamado automaticamente após um erro
    });

    // Enviar mensagem de boas-vindas (opcional)
    this.sendToClient(socket, 'CONNECTION_ESTABLISHED', { 
      message: 'Conexão estabelecida com o servidor',
      timestamp: Date.now()
    });
  }

  // Trata mensagens recebidas dos clientes
  private handleMessage(socket: WebSocket, data: WebSocket.Data) {
    const client = this.clients.get(socket);
    if (!client) return;

    // Atualizar timestamp de última atividade
    client.lastActivity = Date.now();

    try {
      const message = JSON.parse(data.toString());
      
      // Se a mensagem contém uma solicitação para associar um userId
      if (message.type === 'AUTH' && message.payload?.userId) {
        this.associateUserId(socket, message.payload.userId);
      }
      
      // Processar outras mensagens conforme necessário
      console.log(`[WebSocketManager] Mensagem recebida do cliente: ${message.type}`);
    } catch (error) {
      console.error('[WebSocketManager] Erro ao processar mensagem do cliente:', error);
    }
  }

  // Associa um ID de usuário ao socket
  private associateUserId(socket: WebSocket, userId: number) {
    const client = this.clients.get(socket);
    if (!client) return;

    client.userId = userId;
    
    // Adicionar ao mapa de usuários
    if (!this.userClients.has(userId)) {
      this.userClients.set(userId, new Set());
    }
    this.userClients.get(userId)?.add(socket);
    
    console.log(`[WebSocketManager] Cliente associado ao usuário ${userId}`);
  }

  // Trata desconexão de cliente
  private handleDisconnect(socket: WebSocket) {
    const client = this.clients.get(socket);
    if (!client) return;

    // Remover do mapa de projetos, se aplicável
    if (client.projectId && this.projectClients.has(client.projectId)) {
      this.projectClients.get(client.projectId)?.delete(socket);
      // Limpar conjunto se estiver vazio
      if (this.projectClients.get(client.projectId)?.size === 0) {
        this.projectClients.delete(client.projectId);
      }
    }

    // Remover do mapa de usuários, se aplicável
    if (client.userId && this.userClients.has(client.userId)) {
      this.userClients.get(client.userId)?.delete(socket);
      // Limpar conjunto se estiver vazio
      if (this.userClients.get(client.userId)?.size === 0) {
        this.userClients.delete(client.userId);
      }
    }

    // Remover do mapa de clientes
    this.clients.delete(socket);
    
    console.log(`[WebSocketManager] Cliente desconectado. Total de clientes: ${this.clients.size}`);
  }

  // Inicia intervalo de ping para manter conexões ativas
  private startPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      const now = Date.now();
      
      this.clients.forEach((client, socket) => {
        // Se o cliente está inativo por mais de 5 minutos (300000ms), desconectar
        if (now - client.lastActivity > 300000) {
          console.log('[WebSocketManager] Desconectando cliente inativo...');
          socket.terminate();
          this.handleDisconnect(socket);
          return;
        }
        
        // Enviar ping se a conexão estiver aberta
        if (socket.readyState === 1) { // WebSocket.OPEN é 1
          socket.ping();
        }
      });
    }, 30000); // A cada 30 segundos
  }

  // Envia mensagem para um cliente específico
  sendToClient(client: WebSocket, type: WebSocketEventType | string, payload: any) {
    if (client.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const message: WebSocketMessage = {
        type: type as WebSocketEventType,
        payload,
        timestamp: Date.now()
      };
      
      client.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WebSocketManager] Erro ao enviar mensagem para cliente:', error);
      return false;
    }
  }

  // Envia mensagem para todos os clientes conectados
  broadcast(type: WebSocketEventType, payload: any) {
    const message = JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    });
    
    let sentCount = 0;
    
    this.clients.forEach((client, socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
        sentCount++;
      }
    });
    
    return sentCount;
  }

  // Envia mensagem para todos os clientes associados a um usuário específico
  broadcastToUser(userId: number, type: WebSocketEventType, payload: any) {
    if (!this.userClients.has(userId)) {
      return 0;
    }
    
    const userSockets = this.userClients.get(userId);
    if (!userSockets || userSockets.size === 0) {
      return 0;
    }
    
    const message = JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    });
    
    let sentCount = 0;
    
    userSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
        sentCount++;
      }
    });
    
    return sentCount;
  }

  // Envia mensagem para todos os clientes de um projeto específico
  broadcastToProject(projectId: string, type: WebSocketEventType, payload: any) {
    if (!this.projectClients.has(projectId)) {
      console.log(`[WebSocketManager] Nenhum cliente conectado ao projeto ${projectId}`);
      return 0;
    }
    
    const projectSockets = this.projectClients.get(projectId);
    if (!projectSockets || projectSockets.size === 0) {
      console.log(`[WebSocketManager] Conjunto de clientes vazio para o projeto ${projectId}`);
      return 0;
    }
    
    console.log(`[WebSocketManager] Enviando mensagem para ${projectSockets.size} clientes do projeto ${projectId}`);
    
    const message = JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    });
    
    let sentCount = 0;
    
    projectSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
          sentCount++;
        } catch (error) {
          console.error(`[WebSocketManager] Erro ao enviar mensagem para cliente do projeto ${projectId}:`, error);
        }
      } else {
        console.log(`[WebSocketManager] Socket não está aberto para projeto ${projectId}. Estado: ${socket.readyState}`);
      }
    });
    
    console.log(`[WebSocketManager] Mensagem enviada para ${sentCount} clientes do projeto ${projectId}`);
    return sentCount;
  }

  // Retorna o número de clientes conectados
  getClientCount() {
    return this.clients.size;
  }

  // Retorna o número de projetos ativos
  getProjectCount() {
    return this.projectClients.size;
  }

  // Encerra o gerenciador WebSocket
  shutdown() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Fechar todas as conexões de clientes
    this.clients.forEach((client, socket) => {
      socket.terminate();
    });
    
    this.clients.clear();
    this.projectClients.clear();
    this.userClients.clear();
    
    console.log('[WebSocketManager] Serviço WebSocket encerrado.');
  }
}

// Exportar uma instância singleton do gerenciador
export const webSocketManager = new WebSocketManager();