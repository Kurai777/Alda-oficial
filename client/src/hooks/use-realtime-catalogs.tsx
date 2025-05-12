import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/lib/websocketService';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook para obter catálogos com atualizações em tempo real
 * 
 * Este hook combina o React Query para buscar dados iniciais
 * com WebSocket para receber atualizações em tempo real.
 */
export function useRealtimeCatalogs(userId?: number) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Construir a chave da query
  const queryKey = ['/api/catalogs', { userId }];
  
  // Usar React Query para buscar dados iniciais
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      console.log(`[WebSocket] Buscando catálogos para usuário ${userId}`);
      const response = await fetch(`/backend/catalogs`);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar catálogos: ${response.status}`);
      }
      
      return await response.json();
    },
    enabled: !!userId,
  });
  
  // Inscrever-se para atualizações em tempo real via WebSocket
  useWebSocket(['CATALOG_CREATED', 'CATALOG_UPDATED', 'CATALOG_DELETED'], (payload) => {
    console.log('[WebSocket] Recebida atualização de catálogo:', payload);
    
    // Extrair o catálogo dos dados de payload
    const catalog = payload.catalog;
    
    if (!catalog) return;
    
    // Se o catálogo não pertence ao usuário atual, ignorar
    if (userId && catalog.userId !== userId) return;
    
    // Atualizar o cache do React Query com os novos dados
    queryClient.invalidateQueries({ queryKey });
    
    // Mostrar notificação toast
    toast({
      title: getToastTitle(payload.type),
      description: `${catalog.name}`,
      variant: 'default',
    });
  });
  
  // Retornar os mesmos valores que useQuery
  return query;
}

// Função auxiliar para determinar o título do toast com base no tipo de evento
function getToastTitle(eventType: string): string {
  switch (eventType) {
    case 'CATALOG_CREATED':
      return 'Novo catálogo adicionado';
    case 'CATALOG_UPDATED':
      return 'Catálogo atualizado';
    case 'CATALOG_DELETED':
      return 'Catálogo removido';
    default:
      return 'Atualização de catálogo';
  }
}