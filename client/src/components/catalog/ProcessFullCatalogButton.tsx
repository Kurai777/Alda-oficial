/**
 * Botão para processar catálogo completo
 * 
 * Este componente oferece um botão que, quando clicado, inicia o processamento
 * completo de um catálogo de Excel, extraindo todos os produtos (500+)
 * com suas respectivas imagens, preços e detalhes.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Database, Loader2, FileSpreadsheet, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ProcessFullCatalogButtonProps {
  catalogId: number;
  className?: string;
  onComplete?: () => void;
}

export default function ProcessFullCatalogButton({ 
  catalogId, 
  className = "", 
  onComplete 
}: ProcessFullCatalogButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [useAI, setUseAI] = useState(false);
  const { toast } = useToast();

  const handleProcessCatalog = async () => {
    if (!catalogId) return;
    
    try {
      setIsProcessing(true);
      
      // Configurar os parâmetros da requisição
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ useAI })
      };
      
      // Fazer a requisição incluindo a opção de IA
      const response = await fetch(`/api/process-full-catalog/${catalogId}`, requestOptions);
      
      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setShowResults(true);
        
        // Personalizar a mensagem com base no uso de IA
        const messageDescription = useAI && data.enhancedCount > 0
          ? `Catálogo processado com sucesso. ${data.productsCount || 0} produtos encontrados, sendo ${data.enhancedCount} enriquecidos com IA.`
          : `Catálogo processado com sucesso. ${data.productsCount || 0} produtos encontrados.`;
        
        toast({
          title: "Processamento concluído",
          description: messageDescription,
          variant: "default",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Erro ao processar catálogo",
          description: error.message || "Ocorreu um erro ao processar o catálogo completo.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Erro ao processar catálogo completo:", error);
      toast({
        title: "Erro inesperado",
        description: "Ocorreu um erro inesperado ao processar o catálogo completo.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseResults = () => {
    setShowResults(false);
    
    // Forçar o recarregamento dos dados para atualizar a lista
    if (onComplete) {
      onComplete();
    }
    
    // Avisar o usuário que a página será recarregada
    toast({
      title: "Atualizando exibição",
      description: "A página será atualizada para mostrar todos os produtos.",
      duration: 3000,
    });
    
    // Recarregar a página após um curto atraso
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className={className}
            variant="outline"
            size="sm"
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processando catálogo...
              </>
            ) : (
              <>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Processar Catálogo Completo
              </>
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Processar catálogo completo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação processará o arquivo Excel original e extrairá TODOS os produtos do catálogo, 
              que podem chegar a 500+ itens. O processamento pode levar alguns minutos.
              
              <div className="flex items-center space-x-2 mt-4 mb-2 bg-gray-50 p-3 rounded-md border">
                <Switch 
                  id="ai-mode" 
                  checked={useAI}
                  onCheckedChange={setUseAI}
                />
                <div>
                  <Label htmlFor="ai-mode" className="font-medium cursor-pointer">
                    <Sparkles className="h-4 w-4 inline mr-1 text-yellow-500" /> 
                    Enriquecer com IA
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Utiliza inteligência artificial para completar e melhorar os dados dos produtos
                  </p>
                </div>
              </div>
              
              <div className="text-sm mt-3">
                Deseja continuar?
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleProcessCatalog}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  {useAI && <Sparkles className="mr-2 h-4 w-4 text-yellow-500" />}
                  {`Sim, processar catálogo ${useAI ? 'com IA' : 'completo'}`}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResults} onOpenChange={setShowResults}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resultado do processamento</AlertDialogTitle>
            <AlertDialogDescription>
              {results && (
                <div className="space-y-4">
                  <div className="bg-green-100 p-4 rounded-md mb-4">
                    <h3 className="font-medium text-green-800 mb-2">Processamento concluído!</h3>
                    <p className="text-green-700">
                      Foram processados <strong>{results.productsCount || 0}</strong> produtos 
                      do arquivo Excel original.
                    </p>
                    {results.aiEnhanced && (
                      <p className="text-green-700 mt-2">
                        <Sparkles className="h-4 w-4 inline mr-1 text-yellow-500" />
                        <strong>{results.enhancedCount || 0}</strong> produtos foram enriquecidos com IA.
                      </p>
                    )}
                  </div>
                  
                  <p className="text-sm">
                    O sistema extraiu todas as informações disponíveis no Excel, incluindo:
                  </p>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    <li>Nomes de produtos</li>
                    <li>Códigos únicos</li>
                    <li>Preços</li>
                    <li>Categorias</li>
                    <li>Descrições</li>
                    <li>Imagens (quando disponíveis)</li>
                  </ul>
                  
                  {results.aiEnhanced && results.enhancedCount > 0 && (
                    <div className="mt-4 mb-2 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                      <h4 className="font-medium flex items-center">
                        <Sparkles className="h-4 w-4 inline mr-2 text-yellow-500" />
                        Melhorias com IA
                      </h4>
                      <p className="text-sm mt-1">
                        A inteligência artificial enriqueceu os dados dos produtos com:
                      </p>
                      <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                        <li>Descrições mais detalhadas e comerciais</li>
                        <li>Categorização automática de produtos</li>
                        <li>Dimensões e materiais inferidos quando ausentes</li>
                        <li>Correção de nomes incompletos ou genéricos</li>
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleCloseResults}>
              Fechar e atualizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}