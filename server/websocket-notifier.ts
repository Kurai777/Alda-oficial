/**
 * Serviço para emitir notificações WebSocket
 * 
 * Este serviço facilita o envio de notificações via WebSocket
 * para atualizações de produtos, catálogos e orçamentos
 */

import { webSocketManager, WebSocketEventType } from './websocket-service';

/**
 * Classe NotificationService
 * 
 * Fornece métodos para enviar notificações de WebSocket para diferentes eventos do sistema
 */
class NotificationService {
  /**
   * Notifica a criação de um novo produto
   * @param product Dados do produto
   * @param userId ID do usuário
   */
  notifyProductCreated(product: any, userId?: number): void {
    console.log(`[WebSocket] Notificando criação de produto: ${product.name}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, 'PRODUCT_CREATED', { product });
    }
    
    // Se o produto estiver associado a um catálogo, enviar também para os clientes desse catálogo
    if (product.catalogId) {
      webSocketManager.broadcastToProject(
        product.catalogId.toString(), 
        'PRODUCT_CREATED', 
        { product }
      );
    }
  }
  
  /**
   * Notifica a atualização de um produto
   * @param product Dados do produto
   * @param userId ID do usuário
   */
  notifyProductUpdated(product: any, userId?: number): void {
    console.log(`[WebSocket] Notificando atualização de produto: ${product.name}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, 'PRODUCT_UPDATED', { product });
    }
    
    // Se o produto estiver associado a um catálogo, enviar também para os clientes desse catálogo
    if (product.catalogId) {
      webSocketManager.broadcastToProject(
        product.catalogId.toString(), 
        'PRODUCT_UPDATED', 
        { product }
      );
    }
  }
  
  /**
   * Notifica a exclusão de um produto
   * @param productId ID do produto
   * @param catalogId ID do catálogo
   * @param userId ID do usuário
   */
  notifyProductDeleted(productId: number, catalogId?: number, userId?: number): void {
    console.log(`[WebSocket] Notificando exclusão de produto: ${productId}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, 'PRODUCT_DELETED', { 
        product: { id: productId, catalogId }
      });
    }
    
    // Se o produto estiver associado a um catálogo, enviar também para os clientes desse catálogo
    if (catalogId) {
      webSocketManager.broadcastToProject(
        catalogId.toString(), 
        'PRODUCT_DELETED', 
        { product: { id: productId, catalogId } }
      );
    }
  }
  
  /**
   * Notifica a criação de um novo catálogo
   * @param catalog Dados do catálogo
   * @param userId ID do usuário
   */
  notifyCatalogCreated(catalog: any, userId?: number): void {
    console.log(`[WebSocket] Notificando criação de catálogo: ${catalog.name}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, 'CATALOG_CREATED', { catalog });
    }
    
    // Enviar também para os clientes específicos deste catálogo
    webSocketManager.broadcastToProject(
      catalog.id.toString(), 
      'CATALOG_CREATED', 
      { catalog }
    );
  }
  
  /**
   * Notifica a atualização de um catálogo
   * @param catalog Dados do catálogo
   * @param userId ID do usuário
   */
  notifyCatalogUpdated(catalog: any, userId?: number): void {
    console.log(`[WebSocket] Notificando atualização de catálogo: ${catalog.name}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, 'CATALOG_UPDATED', { catalog });
    }
    
    // Enviar também para os clientes específicos deste catálogo
    webSocketManager.broadcastToProject(
      catalog.id.toString(), 
      'CATALOG_UPDATED', 
      { catalog }
    );
  }
  
  /**
   * Notifica a criação ou atualização de um orçamento
   * @param quote Dados do orçamento
   * @param isNew Indica se é um novo orçamento (true) ou atualização (false)
   * @param userId ID do usuário
   */
  notifyQuoteUpdated(quote: any, isNew: boolean = false, userId?: number): void {
    const eventType: WebSocketEventType = isNew ? 'QUOTE_CREATED' : 'QUOTE_UPDATED';
    console.log(`[WebSocket] Notificando ${isNew ? 'criação' : 'atualização'} de orçamento: ${quote.id}`);
    
    // Enviar para todos os clientes deste usuário
    if (userId) {
      webSocketManager.broadcastToUser(userId, eventType, { quote });
    }
    
    // Enviar também para os clientes específicos deste orçamento
    webSocketManager.broadcastToProject(
      quote.id.toString(), 
      eventType, 
      { quote }
    );
  }
  
  /**
   * Envia uma mensagem de chat para um projeto específico
   * @param projectId ID do projeto
   * @param message Conteúdo da mensagem
   * @param sender Informações do remetente
   */
  sendChatMessage(projectId: string, message: string, sender: any): void {
    console.log(`[WebSocket] Enviando mensagem de chat para projeto: ${projectId}`);
    
    webSocketManager.broadcastToProject(
      projectId,
      'CHAT_MESSAGE',
      {
        message,
        sender,
        timestamp: Date.now()
      }
    );
  }
}

// Exportar uma instância singleton do serviço
export const notificationService = new NotificationService();