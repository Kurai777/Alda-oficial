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
  
  const queryKey = catalogId 
    ? ['/api/products', { userId, catalogId }] 
    : ['/api/products', { userId }];
  
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      console.log(`[RealtimeProducts] Buscando produtos para usuário ${userId} ${catalogId ? `e catálogo ${catalogId}` : ''}`);
      
      const url = catalogId 
        ? `/api/products?catalogId=${catalogId}` 
        : `/api/products`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        let errorText = 'Erro desconhecido do servidor';
        try {
          errorText = await response.text();
        } catch (e) {
          // Ignorar se não conseguir ler o texto
        }
        console.error(`Erro ao buscar produtos (${url}): ${response.status} - ${errorText}`);
        throw new Error(`Erro ao buscar produtos: ${response.status} - ${errorText}`);
      }
      
      try {
        return await response.json();
      } catch (e) {
        console.error(`Erro ao fazer parse do JSON da resposta de ${url}:`, e);
        throw new Error(`Falha ao processar resposta do servidor para ${url}.`);
      }
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