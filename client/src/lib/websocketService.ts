/**
 * Serviço de WebSocket para atualizações em tempo real
 * 
 * Este serviço gerencia conexões WebSocket e fornece uma API para enviar e receber
 * mensagens em tempo real na aplicação. Permite que componentes se inscrevam
 * em eventos específicos.
 */

// Tipos de eventos que podem ser recebidos do servidor
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
  | 'AI_PROCESSING_STARTED'
  | 'AI_PROCESSING_COMPLETE'
  | 'AI_PROCESSING_ERROR'
  | 'AI_PROCESSING_COMPLETE_NO_OBJECTS';

// Estrutura de uma mensagem WebSocket
export interface WebSocketMessage {
  type: WebSocketEventType;
  payload: any;
  timestamp: number;
}

// Tipo para callbacks de eventos
type EventCallback = (payload: any) => void;

class WebSocketService {
  private socket: WebSocket | null = null;
  private eventListeners: Map<WebSocketEventType, Set<EventCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private projectId?: string;

  // Inicializa a conexão WebSocket
  connect(projectId?: string | number) {
    if (this.isConnecting || this.socket?.readyState === WebSocket.OPEN) {
      console.log("[WebSocket] Já conectado ou conectando. Ignorando solicitação.");
      return;
    }

    this.isConnecting = true;
    this.projectId = projectId ? projectId.toString() : undefined;

    try {
      // Determinar o protocolo correto (ws/wss)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Construir a URL do WebSocket
      let wsUrl = `${protocol}//${window.location.host}/ws`;
      
      // Adicionar projectId como query parameter se fornecido
      if (this.projectId) {
        wsUrl += `?projectId=${this.projectId}`;
      }

      console.log(`[WebSocket] Conectando a: ${wsUrl}`);
      this.socket = new WebSocket(wsUrl);

      // Configurar handlers de eventos
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('[WebSocket] Erro ao inicializar conexão:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  // Verifica se o WebSocket está conectado
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  // Desconecta o WebSocket
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      console.log('[WebSocket] Fechando conexão...');
      // Remover todos os event handlers para evitar memory leaks
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      
      // Fechar a conexão se ainda estiver aberta
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }
    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }

  // Envia uma mensagem para o servidor
  send(type: string, payload: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Tentativa de enviar mensagem com websocket fechado.');
      return false;
    }

    try {
      const message = JSON.stringify({
        type,
        payload,
        timestamp: Date.now()
      });
      this.socket.send(message);
      return true;
    } catch (error) {
      console.error('[WebSocket] Erro ao enviar mensagem:', error);
      return false;
    }
  }

  // Inscreve-se para receber notificações de um tipo específico de evento
  subscribe(eventType: WebSocketEventType, callback: EventCallback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)?.add(callback);
    
    // Conectar automaticamente se ainda não estiver conectado
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.connect(this.projectId);
    }
  }

  // Cancela a inscrição de um callback para um tipo de evento
  unsubscribe(eventType: WebSocketEventType, callback: EventCallback) {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType)?.delete(callback);
    }
  }

  // Handler para quando a conexão é estabelecida
  private handleOpen(event: Event) {
    console.log('[WebSocket] Conexão estabelecida!');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Notificar que estamos conectados
    if (this.projectId) {
      console.log(`[WebSocket] Conectado ao projeto ${this.projectId}`);
    }
  }

  // Handler para quando mensagens são recebidas
  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      
      if (message && message.type) {
        // Notificar todos os callbacks registrados para este tipo de evento
        const listeners = this.eventListeners.get(message.type);
        if (listeners) {
          listeners.forEach(callback => {
            try {
              callback(message.payload);
            } catch (error) {
              console.error(`[WebSocket] Erro no callback para evento ${message.type}:`, error);
            }
          });
        }
      }
    } catch (error) {
      console.error('[WebSocket] Erro ao processar mensagem:', error);
    }
  }

  // Handler para quando a conexão é fechada
  private handleClose(event: CloseEvent) {
    console.log(`[WebSocket] Conexão fechada. Código: ${event.code}, Razão: "${event.reason}"`);
    this.socket = null;
    this.isConnecting = false;
    
    // Tentar reconectar se não foi um fechamento limpo
    if (event.code !== 1000 && event.code !== 1001) {
      this.scheduleReconnect();
    }
  }

  // Handler para erros na conexão
  private handleError(event: Event) {
    console.error('[WebSocket] Erro na conexão:', event);
    this.isConnecting = false;
    // WebSocket vai chamar onclose automaticamente após um erro
  }

  // Agenda uma tentativa de reconexão
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WebSocket] Número máximo de tentativas de reconexão atingido.');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WebSocket] Tentando reconectar em ${delay}ms (tentativa ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.projectId);
    }, delay);
  }
}

// Exportar uma instância singleton do serviço
export const webSocketService = new WebSocketService();

// Hook para usar o WebSocket em componentes React
import { useEffect } from 'react';

export function useWebSocket(
  eventType: WebSocketEventType | WebSocketEventType[],
  callback: EventCallback,
  projectId?: string | number
) {
  useEffect(() => {
    // Se eventType for um array, assinar todos os eventos
    const eventTypes = Array.isArray(eventType) ? eventType : [eventType];
    
    // Conectar ao WebSocket com o projectId fornecido
    webSocketService.connect(projectId);
    
    // Assinar aos eventos
    eventTypes.forEach(type => {
      webSocketService.subscribe(type, callback);
    });
    
    // Ao desmontar o componente, cancelar inscrições
    return () => {
      eventTypes.forEach(type => {
        webSocketService.unsubscribe(type, callback);
      });
    };
  }, [eventType, callback, projectId]);
}