import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FixProductImagesButtonProps {
  catalogId: number;
  onComplete?: (result: any) => void;
}

export function FixProductImagesButton({ catalogId, onComplete }: FixProductImagesButtonProps) {
  const [isFixing, setIsFixing] = useState(false);
  const { toast } = useToast();

  const fixImages = async () => {
    if (!catalogId) {
      toast({
        title: "Erro",
        description: "ID do catálogo não fornecido",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsFixing(true);
      
      const response = await apiRequest('POST', `/api/fix-product-images/${catalogId}`);
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Sucesso",
          description: result.message || "Imagens corrigidas com sucesso",
        });
      } else {
        toast({
          title: "Erro",
          description: result.message || "Falha ao corrigir imagens",
          variant: "destructive"
        });
      }
      
      if (onComplete) {
        onComplete(result);
      }
    } catch (error) {
      console.error("Erro ao corrigir imagens:", error);
      toast({
        title: "Erro",
        description: "Falha ao processar a solicitação de correção de imagens",
        variant: "destructive"
      });
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <Button 
      onClick={fixImages}
      disabled={isFixing || !catalogId}
      variant="outline"
      size="sm"
    >
      {isFixing ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Corrigindo imagens...
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          Corrigir imagens
        </>
      )}
    </Button>
  );
}