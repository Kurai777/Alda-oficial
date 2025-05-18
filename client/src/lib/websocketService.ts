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
  private currentConnectedProjectId?: string;

  connect(newProjectId?: string | number) {
    const newProjectIdStr = newProjectId ? newProjectId.toString() : undefined;

    if (this.socket?.readyState === WebSocket.OPEN && this.currentConnectedProjectId === newProjectIdStr) {
      console.log(`[WebSocket Service] Já conectado ao projeto ${newProjectIdStr}. Ignorando.`);
      return;
    }
    if (this.isConnecting && this.currentConnectedProjectId === newProjectIdStr) {
      console.log(`[WebSocket Service] Conexão já em progresso para o projeto ${newProjectIdStr}. Ignorando.`);
      return;
    }

    if (this.socket) {
      console.log(`[WebSocket Service] Mudança de projeto ou reconexão solicitada. Fechando socket existente (se houver) para ${this.currentConnectedProjectId}.`);
      this.disconnect();
    }
    
    this.isConnecting = true;
    this.currentConnectedProjectId = newProjectIdStr;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl = `${protocol}//${window.location.host}/ws`;
      
      if (this.currentConnectedProjectId) {
        wsUrl += `?projectId=${this.currentConnectedProjectId}`;
      }

      console.log(`[WebSocket Service] Tentando conectar a: ${wsUrl} (ID do Projeto para esta conexão: ${this.currentConnectedProjectId || 'Nenhum'})`);
      
      this.socket = new WebSocket(wsUrl);
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('[WebSocket Service] Erro ao inicializar conexão:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isConnecting = false;

    if (this.socket) {
      console.log(`[WebSocket Service] Fechando conexão para projeto ${this.currentConnectedProjectId || 'geral'}...`);
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close(1000, "Desconexão solicitada pelo cliente");
      }
      this.socket = null;
    }
    this.reconnectAttempts = 0;
  }

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

  subscribe(eventType: WebSocketEventType, callback: EventCallback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)?.add(callback);
    
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.connect(this.currentConnectedProjectId);
    }
  }

  unsubscribe(eventType: WebSocketEventType, callback: EventCallback) {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType)?.delete(callback);
    }
  }

  private handleOpen(event: Event) {
    console.log('[WebSocket] Conexão estabelecida!');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    if (this.currentConnectedProjectId) {
      console.log(`[WebSocket] Conectado ao projeto ${this.currentConnectedProjectId}`);
    }
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      
      if (message && message.type) {
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

  private handleClose(event: CloseEvent) {
    console.log(`[WebSocket Service] Conexão fechada para projeto ${this.currentConnectedProjectId || 'geral'}. Código: ${event.code}, Razão: "${event.reason}"`);
    this.socket = null;
    this.isConnecting = false;
    if (event.code !== 1000 && event.code !== 1001) {
      this.scheduleReconnect();
    }
  }

  private handleError(event: Event) {
    console.error(`[WebSocket Service] Erro na conexão para projeto ${this.currentConnectedProjectId || 'geral'}:`, event);
    this.isConnecting = false;
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WebSocket Service] Número máximo de tentativas de reconexão atingido.');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WebSocket Service] Tentando reconectar para projeto ${this.currentConnectedProjectId || 'geral'} em ${delay}ms (tentativa ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.currentConnectedProjectId);
    }, delay);
  }
}

export const webSocketService = new WebSocketService();

import { useEffect } from 'react';

export function useWebSocket(
  eventType: WebSocketEventType | WebSocketEventType[],
  callback: EventCallback,
  projectId?: string | number
) {
  useEffect(() => {
    const eventTypes = Array.isArray(eventType) ? eventType : [eventType];
    
    webSocketService.connect(projectId);
    
    eventTypes.forEach(type => {
      webSocketService.subscribe(type, callback);
    });
    
    return () => {
      eventTypes.forEach(type => {
        webSocketService.unsubscribe(type, callback);
      });
    };
  }, [eventType, callback, projectId]);
}