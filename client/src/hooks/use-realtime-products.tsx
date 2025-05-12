import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/lib/websocketService';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook para obter produtos com atualizações em tempo real
 * 
 * Este hook combina o React Query para buscar dados iniciais
 * com WebSocket para receber atualizações em tempo real.
 */
export function useRealtimeProducts(userId?: number, catalogId?: number) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Construir a chave da query
  const queryKey = catalogId 
    ? ['/api/products', { userId, catalogId }] 
    : ['/api/products', { userId }];
  
  // Usar React Query para buscar dados iniciais
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      console.log(`[WebSocket] Buscando produtos para usuário ${userId} ${catalogId ? `e catálogo ${catalogId}` : ''}`);
      
      const url = catalogId 
        ? `/backend/products?catalogId=${catalogId}` 
        : `/backend/products`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar produtos: ${response.status}`);
      }
      
      return await response.json();
    },
    enabled: !!userId,
  });
  
  // Processar e atualizar produtos com base em eventos WebSocket
  const processWebSocketEvent = (payload: any, type: string) => {
    console.log(`[Dashboard] Produtos atualizados via WebSocket para o usuário ${userId}`, payload?.product);
    
    // Extrair produto do payload
    const product = payload?.product;
    
    if (!product) return;
    
    // Se há um catalogId específico e o produto não pertence a este catálogo, ignore
    if (catalogId && product.catalogId !== catalogId) return;
    
    // Invalidar a query para refazer a consulta
    queryClient.invalidateQueries({ queryKey });
    
    // Mostrar notificação para o usuário
    const productName = product.name || 'Produto';
    
    toast({
      title: getToastTitle(type),
      description: `${productName}`,
      variant: type === 'PRODUCT_DELETED' ? 'destructive' : 'default',
    });
  };
  
  // Inscrever-se para CRIAÇÃO de produto
  useWebSocket('PRODUCT_CREATED', (payload) => {
    processWebSocketEvent(payload, 'PRODUCT_CREATED');
  }, userId);
  
  // Inscrever-se para ATUALIZAÇÃO de produto
  useWebSocket('PRODUCT_UPDATED', (payload) => {
    processWebSocketEvent(payload, 'PRODUCT_UPDATED');
  }, userId);
  
  // Inscrever-se para EXCLUSÃO de produto
  useWebSocket('PRODUCT_DELETED', (payload) => {
    processWebSocketEvent(payload, 'PRODUCT_DELETED');
  }, userId);
  
  // Retornar os mesmos valores que useQuery
  return query;
}

// Função auxiliar para determinar o título do toast com base no tipo de evento
function getToastTitle(eventType: string): string {
  switch (eventType) {
    case 'PRODUCT_CREATED':
      return 'Novo produto adicionado';
    case 'PRODUCT_UPDATED':
      return 'Produto atualizado';
    case 'PRODUCT_DELETED':
      return 'Produto removido';
    default:
      return 'Atualização de produto';
  }
}