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
    const allowedExtensions = ['.xlsx', '.xls', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Por favor, envie um arquivo Excel (.xlsx, .xls), PDF ou imagem (.jpg, .png, .gif, .webp).",
        variant: "destructive",
      });
      return;
    }

    // Check file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "O tamanho máximo permitido é 100MB.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Erro de Autenticação",
        description: "Você precisa estar logado para fazer upload.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUploading(true);
      
      // Criar um objeto FormData para enviar o arquivo
      const formData = new FormData();
      formData.append('file', file);
      
      // Usar o ID do usuário do nosso banco de dados.
      // O backend já deve pegar o userId da sessão para segurança.
      // Incluir no formData pode ser útil para logs ou se a sessão não for usada diretamente na lógica de arquivo.
      formData.append('userId', user.id.toString());
      console.log('Enviando upload para userId: ' + user.id);
      
      // Enviar o arquivo para o servidor - URL ATUALIZADA
      const response = await fetch('/api/catalogs/upload', { // ALTERADO AQUI
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        // Tentar ler a resposta como texto para mais detalhes do erro
        let errorText = `Upload falhou: ${response.statusText}`;
        try {
          const errorData = await response.json(); // Tenta parsear como JSON primeiro
          errorText = errorData.message || errorText; 
        } catch (e) {
          try { // Senão, tenta como texto
            errorText = await response.text();
          } catch (e2) { /* Mantém o statusText original */ }
        }
        console.error("Upload failed with status:", response.status, "Response:", errorText);
        throw new Error(errorText);
      }
      
      const result = await response.json();
      
      // Invalidate catalogs query to refresh the list - CHAVE ATUALIZADA
      queryClient.invalidateQueries({ queryKey: ["/api/catalogs"] }); // ALTERADO AQUI
      
      toast({
        title: "Catálogo enviado com sucesso",
        description: result.message || "Seu catálogo está sendo processado.", // Usar mensagem da API se disponível
      });
    } catch (error) {
      console.error("Upload failed:", error);
      toast({
        title: "Falha no upload",
        description: error instanceof Error ? error.message : "Ocorreu um erro ao enviar o catálogo.",
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
              Arraste e solte um arquivo Excel, PDF ou imagem do seu catálogo aqui, ou
            </p>
            <div>
              <label htmlFor="file-upload" className="cursor-pointer rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500">
                <span>Selecione um arquivo</span>
                <input 
                  id="file-upload" 
                  name="file-upload" 
                  type="file" 
                  className="sr-only"
                  accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.gif,.webp"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Excel, PDF, imagens (JPG, PNG), até 100MB
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
