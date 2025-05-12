import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@/lib/websocketService';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook para obter orçamentos com atualizações em tempo real
 * 
 * Este hook combina o React Query para buscar dados iniciais
 * com WebSocket para receber atualizações em tempo real.
 */
export function useRealtimeQuotes(userId?: number) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Construir a chave da query
  const queryKey = ['/api/quotes', { userId }];
  
  // Usar React Query para buscar dados iniciais
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      console.log(`[WebSocket] Buscando orçamentos para usuário ${userId}`);
      const response = await fetch(`/backend/quotes`);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar orçamentos: ${response.status}`);
      }
      
      return await response.json();
    },
    enabled: !!userId,
  });
  
  // Inscrever-se para atualizações em tempo real via WebSocket
  useWebSocket(['QUOTE_CREATED', 'QUOTE_UPDATED'], (payload) => {
    console.log('[WebSocket] Recebida atualização de orçamento:', payload);
    
    // Extrair o orçamento dos dados de payload
    const quote = payload.quote;
    
    if (!quote) return;
    
    // Se o orçamento não pertence ao usuário atual, ignorar
    if (userId && quote.userId !== userId) return;
    
    // Atualizar o cache do React Query com os novos dados
    queryClient.invalidateQueries({ queryKey });
    
    // Mostrar notificação toast
    toast({
      title: getToastTitle(payload.type),
      description: `Cliente: ${quote.clientName || 'Sem nome'}, Valor: ${formatCurrency(quote.totalAmount || 0)}`,
      variant: 'default',
    });
  });
  
  // Retornar os mesmos valores que useQuery
  return query;
}

// Função auxiliar para determinar o título do toast com base no tipo de evento
function getToastTitle(eventType: string): string {
  switch (eventType) {
    case 'QUOTE_CREATED':
      return 'Novo orçamento criado';
    case 'QUOTE_UPDATED':
      return 'Orçamento atualizado';
    default:
      return 'Atualização de orçamento';
  }
}

// Função auxiliar para formatar valores monetários
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value / 100); // Assuming the value is stored in cents
}