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
  
  // Construir a chave da query com base nos parâmetros
  const queryKey = catalogId 
    ? ['/api/products', { userId, catalogId }] 
    : ['/api/products', { userId }];
  
  // Usar React Query para buscar dados iniciais
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      console.log(`[WebSocket] Buscando produtos para usuário ${userId} ${catalogId ? `e catálogo ${catalogId}` : ''}`);
      const endpoint = `/backend/products${catalogId ? `?catalogId=${catalogId}` : ''}`;
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar produtos: ${response.status}`);
      }
      
      return await response.json();
    },
    enabled: !!userId,
  });
  
  // Inscrever-se para atualizações em tempo real via WebSocket
  useWebSocket(['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED'], (payload) => {
    console.log('[WebSocket] Recebida atualização de produto:', payload);
    
    // Extrair o produto dos dados de payload
    const product = payload.product;
    
    if (!product) return;
    
    // Se o produto não pertence ao usuário ou catálogo atual, ignorar
    if (userId && product.userId !== userId) return;
    if (catalogId && product.catalogId !== catalogId) return;
    
    // Atualizar o cache do React Query com os novos dados
    queryClient.invalidateQueries({ queryKey });
    
    // Mostrar notificação toast
    toast({
      title: getToastTitle(payload.type),
      description: `${product.name} (${product.code})`,
      variant: 'default',
    });
  });
  
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