import { useCallback } from 'react';
import { webSocketService, WebSocketEventType } from '@/lib/websocketService';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook para facilitar o envio de notificações de atualização via WebSocket
 * e invalidar automaticamente queries do TanStack Query.
 * 
 * @param options Opções de configuração do hook
 * @returns Funções para enviar notificações de atualização
 */
export function useWebSocketUpdate(options: {
  /** IDs de queries para invalidar após notificações */
  invalidateQueries?: string[],
  /** Exibir toast de confirmação ao enviar notificação */
  showToasts?: boolean
} = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { invalidateQueries = [], showToasts = false } = options;

  /**
   * Envia uma notificação de atualização para clientes conectados ao mesmo projeto
   */
  const sendUpdateNotification = useCallback((
    type: WebSocketEventType, 
    payload: any, 
    projectId?: string | number
  ) => {
    // Enviar notificação via WebSocket
    const success = webSocketService.send(type, { ...payload, projectId });

    if (success) {
      // Log para depuração
      console.log(`[WebSocket] Enviada notificação de atualização: ${type}`, payload);
      
      // Invalidar queries locais
      if (invalidateQueries.length > 0) {
        invalidateQueries.forEach(queryKey => {
          console.log(`[WebSocket] Invalidando query: ${queryKey}`);
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      }

      // Exibir toast de confirmação se configurado
      if (showToasts) {
        const messages: Record<string, string> = {
          'PRODUCT_CREATED': 'Produto criado com sucesso',
          'PRODUCT_UPDATED': 'Produto atualizado com sucesso',
          'PRODUCT_DELETED': 'Produto excluído com sucesso',
          'CATALOG_CREATED': 'Catálogo criado com sucesso',
          'CATALOG_UPDATED': 'Catálogo atualizado com sucesso',
          'CATALOG_DELETED': 'Catálogo excluído com sucesso',
          'QUOTE_CREATED': 'Orçamento criado com sucesso',
          'QUOTE_UPDATED': 'Orçamento atualizado com sucesso',
          'DESIGN_PROJECT_UPDATED': 'Projeto de design atualizado',
          'CHAT_MESSAGE': 'Mensagem enviada',
          'PROJECT_UPDATE': 'Projeto atualizado com sucesso',
        };

        toast({
          title: messages[type] || 'Operação realizada com sucesso',
          description: 'Outros dispositivos conectados serão notificados da alteração'
        });
      }

      return true;
    } else {
      console.error('[WebSocket] Falha ao enviar notificação de atualização');
      return false;
    }
  }, [invalidateQueries, queryClient, showToasts, toast]);

  /**
   * Notifica sobre a criação de um produto
   */
  const notifyProductCreated = useCallback((productData: any, projectId?: string | number) => {
    return sendUpdateNotification('PRODUCT_CREATED', { product: productData }, projectId);
  }, [sendUpdateNotification]);

  /**
   * Notifica sobre a atualização de um produto
   */
  const notifyProductUpdated = useCallback((productData: any, projectId?: string | number) => {
    return sendUpdateNotification('PRODUCT_UPDATED', { product: productData }, projectId);
  }, [sendUpdateNotification]);

  /**
   * Notifica sobre a criação de um catálogo
   */
  const notifyCatalogCreated = useCallback((catalogData: any, projectId?: string | number) => {
    return sendUpdateNotification('CATALOG_CREATED', { catalog: catalogData }, projectId);
  }, [sendUpdateNotification]);

  /**
   * Notifica sobre a atualização de um catálogo
   */
  const notifyCatalogUpdated = useCallback((catalogData: any, projectId?: string | number) => {
    return sendUpdateNotification('CATALOG_UPDATED', { catalog: catalogData }, projectId);
  }, [sendUpdateNotification]);

  /**
   * Notifica sobre a criação ou atualização de um orçamento
   */
  const notifyQuoteUpdated = useCallback((quoteData: any, projectId?: string | number) => {
    return sendUpdateNotification('QUOTE_UPDATED', { quote: quoteData }, projectId);
  }, [sendUpdateNotification]);

  return {
    sendUpdateNotification,
    notifyProductCreated,
    notifyProductUpdated,
    notifyCatalogCreated,
    notifyCatalogUpdated,
    notifyQuoteUpdated
  };
}