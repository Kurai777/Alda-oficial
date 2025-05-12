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
  
  // Inscrever-se em cada tipo de evento
  eventTypesArray.forEach(eventType => {
    useWebSocket(eventType, handleUpdate, options?.userId);
  });
  
  return {
    data,
    lastUpdate,
    setData, // Permitir atualizações manuais
    isUpdated: lastUpdate !== null
  };
}