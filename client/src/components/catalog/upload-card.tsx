import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CloudUpload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function UploadCard() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    // Check file type
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.pdf')) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Por favor, envie um arquivo Excel (.xlsx, .xls) ou PDF.",
        variant: "destructive",
      });
      return;
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "O tamanho máximo permitido é 10MB.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUploading(true);
      
      // Criar um objeto FormData para enviar o arquivo
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', user?.id?.toString() || '1');
      
      // Enviar o arquivo para o servidor
      const response = await fetch('/api/catalogs/upload', {
        method: 'POST',
        body: formData,
        // Não configuramos headers quando enviamos FormData
      });
      
      if (!response.ok) {
        throw new Error(`Upload falhou: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Invalidate catalogs query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/catalogs"] });
      
      toast({
        title: "Catálogo enviado com sucesso",
        description: "Seu catálogo está sendo processado. Os produtos serão extraídos automaticamente.",
      });
    } catch (error) {
      console.error("Upload failed:", error);
      toast({
        title: "Falha no upload",
        description: "Ocorreu um erro ao enviar o catálogo.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-xl font-semibold mb-4">Catálogo de Produtos</h2>
        <div 
          className={`border-2 border-dashed ${
            isDragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300'
          } rounded-lg p-6 text-center transition-colors`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="space-y-2">
            <CloudUpload className="h-10 w-10 mx-auto text-gray-400" />
            <h3 className="text-lg font-medium text-gray-900">Importe seu catálogo</h3>
            <p className="text-sm text-gray-500">
              Arraste e solte um arquivo Excel ou PDF do seu catálogo aqui, ou
            </p>
            <div>
              <label htmlFor="file-upload" className="cursor-pointer rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500">
                <span>Selecione um arquivo</span>
                <input 
                  id="file-upload" 
                  name="file-upload" 
                  type="file" 
                  className="sr-only"
                  accept=".xlsx,.xls,.pdf"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Excel, PDF, até 10MB
            </p>
            {isUploading && (
              <div className="mt-2">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-primary-500 h-2.5 rounded-full w-1/2 animate-pulse"></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Enviando arquivo...</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
