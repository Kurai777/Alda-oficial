/**
 * Botão para processar catálogo completo
 * 
 * Este componente oferece um botão que, quando clicado, inicia o processamento
 * completo de um catálogo de Excel, extraindo todos os produtos (500+)
 * com suas respectivas imagens, preços e detalhes.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Database, Loader2, FileSpreadsheet } from 'lucide-react';
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
  const { toast } = useToast();

  const handleProcessCatalog = async () => {
    if (!catalogId) return;
    
    try {
      setIsProcessing(true);
      
      const response = await fetch(`/api/process-full-catalog/${catalogId}`, {
        method: 'POST',
      });
      
      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setShowResults(true);
        
        toast({
          title: "Processamento concluído",
          description: `Catálogo processado com sucesso. ${data.productsCount || 0} produtos encontrados.`,
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
              <br /><br />
              Deseja continuar?
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
                "Sim, processar catálogo completo"
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