import React, { useState, useEffect } from 'react';
import { useWebSocket } from '@/lib/websocketService';
import { useAuth } from '@/lib/auth';
import { WebSocketEventType } from '@/lib/websocketService';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// Tipos de notificação que queremos ouvir
const NOTIFICATION_EVENTS: WebSocketEventType[] = [
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'CATALOG_CREATED',
  'CATALOG_UPDATED',
  'QUOTE_CREATED',
  'QUOTE_UPDATED'
];

// Interface para um item de notificação
interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  type: WebSocketEventType;
  entityId?: number;
}

/**
 * Componente de Centro de Notificações com WebSocket
 * 
 * Exibe um ícone de sino com o número de notificações não lidas
 * e uma lista das notificações recentes quando clicado.
 */
export default function NotificationCenter() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  
  // Efeito para atualizar o contador de não lidos
  useEffect(() => {
    const count = notifications.filter(n => !n.read).length;
    setUnreadCount(count);
  }, [notifications]);
  
  // Função para marcar notificações como lidas
  const markAllAsRead = () => {
    setNotifications(prev => 
      prev.map(notification => ({ ...notification, read: true }))
    );
  };
  
  // Função para limpar todas as notificações
  const clearAll = () => {
    setNotifications([]);
  };
  
  // Processar mensagem WebSocket e criar notificação
  const processWebSocketEvent = (payload: any, type: WebSocketEventType) => {
    if (!payload) return;
    
    // Criar item de notificação com base no tipo de evento
    let newNotification: NotificationItem;
    
    switch (type) {
      case 'PRODUCT_CREATED':
        newNotification = {
          id: `product-created-${Date.now()}`,
          title: 'Novo Produto',
          message: `Produto "${payload.product?.name}" adicionado ao catálogo.`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.product?.id
        };
        break;
        
      case 'PRODUCT_UPDATED':
        newNotification = {
          id: `product-updated-${Date.now()}`,
          title: 'Produto Atualizado',
          message: `Produto "${payload.product?.name}" foi atualizado.`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.product?.id
        };
        break;
        
      case 'CATALOG_CREATED':
        newNotification = {
          id: `catalog-created-${Date.now()}`,
          title: 'Novo Catálogo',
          message: `Catálogo "${payload.catalog?.name}" foi criado.`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.catalog?.id
        };
        break;
        
      case 'CATALOG_UPDATED':
        newNotification = {
          id: `catalog-updated-${Date.now()}`,
          title: 'Catálogo Atualizado',
          message: `Catálogo "${payload.catalog?.name}" foi atualizado.`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.catalog?.id
        };
        break;
        
      case 'QUOTE_CREATED':
        newNotification = {
          id: `quote-created-${Date.now()}`,
          title: 'Novo Orçamento',
          message: `Um novo orçamento foi criado para "${payload.quote?.clientName || 'Cliente'}"`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.quote?.id
        };
        break;
        
      case 'QUOTE_UPDATED':
        newNotification = {
          id: `quote-updated-${Date.now()}`,
          title: 'Orçamento Atualizado',
          message: `Orçamento para "${payload.quote?.clientName || 'Cliente'}" foi atualizado.`,
          timestamp: Date.now(),
          read: false,
          type,
          entityId: payload.quote?.id
        };
        break;
        
      default:
        return; // Ignorar tipos desconhecidos
    }
    
    // Adicionar à lista de notificações (limitando a 20 itens)
    setNotifications(prev => [newNotification, ...prev].slice(0, 20));
  };
  
  // Subscrever a todos os tipos de evento de notificação
  // Não podemos chamar hooks em loops, então devemos definir manualmente para cada tipo
  useWebSocket('PRODUCT_CREATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: PRODUCT_CREATED`, payload);
    processWebSocketEvent(payload, 'PRODUCT_CREATED');
  }, user?.id);
  
  useWebSocket('PRODUCT_UPDATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: PRODUCT_UPDATED`, payload);
    processWebSocketEvent(payload, 'PRODUCT_UPDATED');
  }, user?.id);
  
  useWebSocket('CATALOG_CREATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: CATALOG_CREATED`, payload);
    processWebSocketEvent(payload, 'CATALOG_CREATED');
  }, user?.id);
  
  useWebSocket('CATALOG_UPDATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: CATALOG_UPDATED`, payload);
    processWebSocketEvent(payload, 'CATALOG_UPDATED');
  }, user?.id);
  
  useWebSocket('QUOTE_CREATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: QUOTE_CREATED`, payload);
    processWebSocketEvent(payload, 'QUOTE_CREATED');
  }, user?.id);
  
  useWebSocket('QUOTE_UPDATED', (payload) => {
    console.log(`[WebSocket] Notificação recebida: QUOTE_UPDATED`, payload);
    processWebSocketEvent(payload, 'QUOTE_UPDATED');
  }, user?.id);
  
  // Marcar notificações como lidas quando o popover é aberto
  useEffect(() => {
    if (open) {
      const timeoutId = setTimeout(() => {
        markAllAsRead();
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [open]);
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-primary">
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 border-b flex items-center justify-between">
          <h4 className="font-medium">Notificações</h4>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={markAllAsRead} className="h-8 text-xs">
              Marcar como lidas
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAll} className="h-8 text-xs">
              Limpar
            </Button>
          </div>
        </div>
        
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-muted-foreground">Sem notificações</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map(notification => (
                <div 
                  key={notification.id}
                  className={cn(
                    "p-4 border-b hover:bg-muted/50 cursor-pointer transition-colors",
                    !notification.read && "bg-muted/30"
                  )}
                  onClick={() => {
                    setNotifications(prev => 
                      prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
                    );
                  }}
                >
                  <div className="flex justify-between">
                    <h5 className="font-medium">{notification.title}</h5>
                    <span className="text-xs text-muted-foreground">
                      {new Date(notification.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm mt-1">{notification.message}</p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}