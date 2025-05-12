import React, { useState, useEffect } from 'react';
import { webSocketService, useWebSocket } from '@/lib/websocketService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send } from 'lucide-react';

/**
 * Componente de exemplo que demonstra o uso do WebSocket para 
 * comunicação em tempo real.
 */
export function WebSocketExample({ projectId }: { projectId?: string }) {
  const [messages, setMessages] = useState<Array<{text: string, timestamp: number}>>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [messageText, setMessageText] = useState('');

  // Usar o hook useWebSocket para gerenciar a conexão e receber mensagens
  useWebSocket('CHAT_MESSAGE', (payload) => {
    console.log('Mensagem recebida via WebSocket:', payload);
    if (payload.message) {
      setMessages(prev => [...prev, {
        text: payload.message,
        timestamp: payload.timestamp || Date.now()
      }]);
    }
  }, projectId);

  // Efeito para conectar no início e atualizar status de conexão
  useEffect(() => {
    setConnectionStatus('connecting');
    const checkConnectionInterval = setInterval(() => {
      if (webSocketService.isConnected()) {
        setConnectionStatus('connected');
        clearInterval(checkConnectionInterval);
      }
    }, 1000);

    // Limpeza
    return () => {
      clearInterval(checkConnectionInterval);
    };
  }, [projectId]);

  // Função para enviar mensagem via WebSocket
  const sendMessage = () => {
    if (!messageText.trim()) return;
    
    const sent = webSocketService.send('CHAT_MESSAGE', {
      message: messageText,
      timestamp: Date.now(),
      projectId
    });
    
    if (sent) {
      // Adicionar a mensagem localmente também para feedback imediato
      setMessages(prev => [...prev, {
        text: `Eu: ${messageText}`,
        timestamp: Date.now()
      }]);
      setMessageText('');
    } else {
      console.error('Falha ao enviar mensagem: WebSocket não está conectado');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Chat em Tempo Real
          <ConnectionStatus status={connectionStatus} />
        </CardTitle>
        <CardDescription>
          {projectId 
            ? `Conectado ao projeto: ${projectId}`
            : 'Conectado ao servidor principal'}
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="h-64 overflow-y-auto bg-muted/20 rounded-md p-3 mb-3">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Nenhuma mensagem ainda. Comece a conversar!
            </div>
          ) : (
            <div className="flex flex-col space-y-2">
              {messages.map((msg, i) => (
                <div key={i} className="break-words">
                  <span className="text-sm text-muted-foreground">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="bg-card border p-2 rounded-md mt-1">
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex space-x-2">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Digite sua mensagem..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <Button 
            onClick={sendMessage} 
            disabled={connectionStatus !== 'connected' || !messageText.trim()}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Componente para exibir o status da conexão WebSocket
function ConnectionStatus({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  return (
    <Badge variant={
      status === 'connected' ? 'default' : 
      status === 'connecting' ? 'outline' : 
      'destructive'
    }>
      {status === 'connecting' && (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      )}
      {status === 'connected' ? 'Conectado' : 
       status === 'connecting' ? 'Conectando...' : 
       'Desconectado'}
    </Badge>
  );
}