import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { webSocketService } from '@/lib/websocketService';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Componente que exibe o status da conexão WebSocket
 * Pode ser adicionado em qualquer lugar da interface para mostrar
 * se há uma conexão ativa com o servidor
 */
export default function WebSocketConnectionStatus() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [checkCount, setCheckCount] = useState(0);

  useEffect(() => {
    // Verificar status inicial
    if (webSocketService.isConnected()) {
      setStatus('connected');
    } else {
      setStatus('connecting');
      // Tentar conexão
      webSocketService.connect();
    }

    // Configurar verificação periódica
    const intervalId = setInterval(() => {
      if (webSocketService.isConnected()) {
        setStatus('connected');
      } else if (status === 'connected') {
        setStatus('disconnected');
      }
      setCheckCount(prev => prev + 1);
    }, 5000);

    // Limpar intervalo ao desmontar
    return () => clearInterval(intervalId);
  }, [status]);

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-green-500 hover:bg-green-600';
      case 'connecting':
        return 'bg-yellow-500 hover:bg-yellow-600';
      case 'disconnected':
        return 'bg-red-500 hover:bg-red-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'connected':
        return <Wifi className="h-3 w-3 mr-1" />;
      case 'connecting':
        return <Loader2 className="h-3 w-3 mr-1 animate-spin" />;
      case 'disconnected':
        return <WifiOff className="h-3 w-3 mr-1" />;
    }
  };

  const getTooltipText = () => {
    switch (status) {
      case 'connected':
        return 'Conectado ao servidor em tempo real';
      case 'connecting':
        return 'Tentando conectar ao servidor...';
      case 'disconnected':
        return 'Sem conexão com o servidor em tempo real. As atualizações podem ser atrasadas.';
    }
  };

  // Tentar reconectar em caso de desconexão
  useEffect(() => {
    if (status === 'disconnected' && checkCount % 3 === 0 && checkCount > 0) {
      console.log('[WebSocket] Tentando reconectar automaticamente...');
      webSocketService.connect();
      setStatus('connecting');
    }
  }, [checkCount, status]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`text-white ${getStatusColor()} cursor-help transition-colors`}
          >
            {getStatusIcon()}
            {status === 'connected' ? 'Online' : 
             status === 'connecting' ? 'Conectando...' : 
             'Offline'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}