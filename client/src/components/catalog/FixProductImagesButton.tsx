/**
 * Botão para corrigir imagens de produtos
 * 
 * Este componente oferece um botão que, quando clicado, inicia o processo de correção
 * de imagens compartilhadas em um catálogo, garantindo que cada produto tenha sua
 * própria imagem exclusiva.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Image as ImageIcon, Loader2 } from 'lucide-react';
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
} from "@/components/ui/alert-dialog";

interface FixProductImagesButtonProps {
  catalogId: number;
  className?: string;
  onComplete?: () => void;
}

export default function FixProductImagesButton({ 
  catalogId, 
  className = "", 
  onComplete 
}: FixProductImagesButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<any>(null);
  const { toast } = useToast();

  const handleFixImages = async () => {
    if (!catalogId) return;
    
    try {
      setIsProcessing(true);
      
      const response = await fetch(`/api/fix-catalog-images/${catalogId}`, {
        method: 'POST',
      });
      
      if (response.ok) {
        const data = await response.json();
        setResults(data.results);
        setShowResults(true);
        
        toast({
          title: "Processamento concluído",
          description: `${data.results.fixed} imagens foram corrigidas.`,
          variant: "default",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Erro ao corrigir imagens",
          description: error.message || "Ocorreu um erro ao tentar corrigir as imagens dos produtos.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Erro ao corrigir imagens:", error);
      toast({
        title: "Erro inesperado",
        description: "Ocorreu um erro inesperado ao tentar corrigir as imagens dos produtos.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseResults = () => {
    setShowResults(false);
    
    // Forçar o recarregamento dos dados para atualizar as imagens
    // Isso fará com que a interface seja atualizada com as novas imagens
    if (onComplete) {
      onComplete();
    }
    
    // Avisar o usuário que a página será recarregada para mostrar as imagens corretas
    toast({
      title: "Atualizando exibição",
      description: "A página será atualizada para mostrar as imagens corrigidas.",
      duration: 3000,
    });
    
    // Recarregar a página após um curto atraso
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  return (
    <>
      <Button
        className={className}
        variant="outline"
        size="sm"
        disabled={isProcessing}
        onClick={handleFixImages}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Corrigindo imagens...
          </>
        ) : (
          <>
            <ImageIcon className="mr-2 h-4 w-4" />
            Corrigir imagens do catálogo
          </>
        )}
      </Button>

      <AlertDialog open={showResults} onOpenChange={setShowResults}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resultado da correção de imagens</AlertDialogTitle>
            <AlertDialogDescription>
              {results && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-100 p-3 rounded-md">
                      <p className="text-sm font-medium">Total de produtos</p>
                      <p className="text-lg font-bold">{results.total}</p>
                    </div>
                    <div className="bg-green-100 p-3 rounded-md">
                      <p className="text-sm font-medium">Imagens corrigidas</p>
                      <p className="text-lg font-bold text-green-700">{results.fixed}</p>
                    </div>
                    <div className="bg-blue-100 p-3 rounded-md">
                      <p className="text-sm font-medium">Já estavam corretas</p>
                      <p className="text-lg font-bold text-blue-700">{results.alreadyUnique}</p>
                    </div>
                    <div className="bg-red-100 p-3 rounded-md">
                      <p className="text-sm font-medium">Falhas</p>
                      <p className="text-lg font-bold text-red-700">{results.failed}</p>
                    </div>
                  </div>
                  
                  {results.products && results.products.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">Detalhes:</p>
                      <div className="max-h-40 overflow-y-auto border rounded-md">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                ID
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Mensagem
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {results.products.map((product: any) => (
                              <tr key={product.id}>
                                <td className="px-3 py-1 whitespace-nowrap text-xs">
                                  {product.id}
                                </td>
                                <td className="px-3 py-1 whitespace-nowrap text-xs">
                                  {product.status === 'fixed' && (
                                    <span className="flex items-center text-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Corrigido
                                    </span>
                                  )}
                                  {product.status === 'ok' && (
                                    <span className="flex items-center text-blue-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      OK
                                    </span>
                                  )}
                                  {product.status === 'error' && (
                                    <span className="flex items-center text-red-600">
                                      <AlertCircle className="h-3 w-3 mr-1" />
                                      Erro
                                    </span>
                                  )}
                                  {product.status === 'skipped' && (
                                    <span className="flex items-center text-gray-600">
                                      <AlertCircle className="h-3 w-3 mr-1" />
                                      Ignorado
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-1 text-xs">
                                  {product.message}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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