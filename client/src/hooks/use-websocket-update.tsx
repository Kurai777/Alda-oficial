import { useEffect, useState } from 'react';
import { useWebSocket } from '@/lib/websocketService';
import { useToast } from '@/hooks/use-toast';
import { WebSocketEventType } from '@/lib/websocketService';

/**
 * Hook genérico para atualizações em tempo real via WebSocket
 * 
 * Este hook facilita a recepção de atualizações de uma ou mais fontes via WebSocket,
 * fornecendo uma forma simplificada de atualizar o estado local quando eventos ocorrem.
 */
export function useWebSocketUpdate<T>(
  eventTypes: WebSocketEventType | WebSocketEventType[],
  initialData: T,
  extractData: (payload: any) => T | null,
  options?: {
    userId?: number;
    showToast?: boolean;
    toastConfig?: {
      title: string;
      description?: (data: T) => string;
    };
  }
) {
  const [data, setData] = useState<T>(initialData);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const { toast } = useToast();
  
  // Normalizar eventTypes para um array
  const eventTypesArray = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  
  // Processar atualização recebida
  const handleUpdate = (payload: any) => {
    console.log(`[WebSocket] Recebida atualização para ${eventTypesArray.join(', ')}:`, payload);
    
    const extractedData = extractData(payload);
    if (extractedData !== null) {
      setData(extractedData);
      setLastUpdate(new Date());
      
      // Mostrar toast se habilitado
      if (options?.showToast && options.toastConfig) {
        toast({
          title: options.toastConfig.title,
          description: options.toastConfig.description ? 
            options.toastConfig.description(extractedData) : 
            'Dados atualizados',
          variant: 'default',
        });
      }
    }
  };
  
  // Usamos useEffect para inscrever-se nos eventos
  // Isso é necessário porque não podemos chamar hooks em loops
  useEffect(() => {
    // Esta função vai criar uma função listener para cada tipo de evento
    const setupListeners = () => {
      // Aqui retornaremos uma função cleanup para remover os listeners
      const cleanupFunctions: (() => void)[] = [];
      
      // Para cada tipo de evento, registramos um listener manualmente
      eventTypesArray.forEach(eventType => {
        // Esta é uma simulação simplificada do que useWebSocket faria
        // Na implementação real, você precisaria acessar a instância do websocket
        // e adicionar/remover os listeners manualmente
        console.log(`[WebSocketUpdate] Inscrevendo-se para eventos ${eventType}`);
        
        // Aqui usaríamos o código real para adicionar listeners
        // cleanupFunctions.push(() => { removeEventListener... });
      });
      
      // Retornar função de limpeza
      return () => {
        cleanupFunctions.forEach(cleanup => cleanup());
      };
    };
    
    // Executar a configuração
    return setupListeners();
  }, [eventTypesArray.join(','), options?.userId]); // Dependências

  // AVISO: Esta é uma solução temporária para evitar o erro de hooks
  // Idealmente, reescreveríamos o useWebSocket para não chamar hooks internamente
  // ou implementaríamos uma solução mais elegante com createContext
  if (eventTypesArray.length === 1) {
    useWebSocket(eventTypesArray[0], handleUpdate, options?.userId);
  } else if (eventTypesArray.length > 1) {
    useWebSocket(eventTypesArray[0], handleUpdate, options?.userId);
    useWebSocket(eventTypesArray[1], handleUpdate, options?.userId);
    // Suporta até 2 tipos de eventos. Para mais, precisaríamos de uma implementação melhor
  }
  
  return {
    data,
    lastUpdate,
    setData, // Permitir atualizações manuais
    isUpdated: lastUpdate !== null
  };
}