import React, { useState } from 'react';
import { WebSocketExample } from '@/components/websocket-example';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/**
 * Página de teste para WebSocket
 * 
 * Esta página permite testar a funcionalidade de WebSocket em diferentes contextos:
 * - Chat global (sem projectId)
 * - Chat de projeto específico (com projectId)
 */
export default function WebSocketTestPage() {
  const [projectId, setProjectId] = useState<string>('');
  const [inputProjectId, setInputProjectId] = useState<string>('');
  
  const handleSetProject = () => {
    setProjectId(inputProjectId.trim());
  };
  
  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Teste de WebSocket</h1>
        <p className="text-muted-foreground mt-2">
          Esta página demonstra a funcionalidade de comunicação em tempo real usando WebSockets.
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Configurações</CardTitle>
            <CardDescription>
              Configure os parâmetros de conexão WebSocket
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="projectId">ID do Projeto</Label>
                <div className="flex gap-2">
                  <Input 
                    id="projectId"
                    placeholder="Digite o ID do projeto (opcional)" 
                    value={inputProjectId}
                    onChange={(e) => setInputProjectId(e.target.value)}
                  />
                  <Button onClick={handleSetProject}>Definir</Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {projectId 
                    ? `Conectado ao projeto: ${projectId}`
                    : 'Nenhum projeto específico configurado (chat global)'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Tabs defaultValue="chat">
          <TabsList className="mb-4">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="info">Status da Conexão</TabsTrigger>
          </TabsList>
          
          <TabsContent value="chat">
            <WebSocketExample projectId={projectId} />
          </TabsContent>
          
          <TabsContent value="info">
            <Card>
              <CardHeader>
                <CardTitle>Informações da Conexão</CardTitle>
                <CardDescription>
                  Detalhes técnicos da conexão WebSocket
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="font-medium">URL do WebSocket:</span>
                    <code className="ml-2 p-1 bg-muted rounded text-sm">
                      {`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws${projectId ? `?projectId=${projectId}` : ''}`}
                    </code>
                  </div>
                  <div>
                    <span className="font-medium">Exemplo de Evento:</span>
                    <pre className="mt-1 p-2 bg-muted rounded text-sm whitespace-pre-wrap overflow-auto">
                      {JSON.stringify({
                        type: 'CHAT_MESSAGE',
                        payload: {
                          message: 'Olá, esta é uma mensagem de exemplo!',
                          timestamp: Date.now(),
                          projectId: projectId || undefined
                        },
                        timestamp: Date.now()
                      }, null, 2)}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}