import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CloudUpload, FileText, FileSpreadsheet, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function UploadCard() {
  const [artisticFile, setArtisticFile] = useState<File | null>(null);
  const [pricingFile, setPricingFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const commonFileValidation = (file: File) => {
    const allowedArtisticExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedPricingExtensions = ['.xlsx', '.xls', '.pdf'];
    
    let isValid = false;
    let errorMessage = "";

    if (file.size > 100 * 1024 * 1024) {
      errorMessage = "Arquivo muito grande. O tamanho máximo permitido é 100MB.";
      isValid = false;
      return { isValid, errorMessage };
    }

    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if ([...allowedArtisticExtensions, ...allowedPricingExtensions].includes(fileExtension)) {
      isValid = true;
    } else {
      errorMessage = "Tipo de arquivo inválido. Verifique as extensões permitidas.";
      isValid = false;
    }
    return { isValid, errorMessage };
  }

  const handleArtisticFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const { isValid, errorMessage } = commonFileValidation(file);
      if (!isValid) {
        toast({ title: "Arquivo Artístico Inválido", description: errorMessage, variant: "destructive" });
        setArtisticFile(null);
        e.target.value = "";
        return;
      }
      setArtisticFile(file);
    }
  };

  const handlePricingFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const { isValid, errorMessage } = commonFileValidation(file);
      if (!isValid) {
        toast({ title: "Arquivo de Preços Inválido", description: errorMessage, variant: "destructive" });
        setPricingFile(null);
        e.target.value = "";
        return;
      }
      setPricingFile(file);
    }
  };
  
  const handleGlobalDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    toast({
      title: "Ação de Arrastar",
      description: "Por favor, use os botões 'Selecionar Arquivo' para cada tipo.",
      variant: "default",
    });
  };

  const handleSubmitCatalog = async () => {
    if (!artisticFile) {
      toast({
        title: "Arquivo Artístico Obrigatório",
        description: "Por favor, selecione o arquivo PDF artístico do catálogo.",
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
      const formData = new FormData();
      formData.append('artisticFile', artisticFile);
      if (pricingFile) {
        formData.append('pricingFile', pricingFile);
      }
      formData.append('userId', user.id.toString());

      const response = await fetch('/api/catalogs/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorText = `Upload falhou: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorText = errorData.message || errorText;
        } catch (e) { /* Mantém o statusText original */ }
        console.error("Upload failed with status:", response.status, "Response:", errorText);
        throw new Error(errorText);
      }

      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/catalogs"] });

      toast({
        title: "Catálogo(s) enviado(s) com sucesso!",
        description: result.message || "Seu catálogo está sendo processado.",
      });
      setArtisticFile(null);
      setPricingFile(null);

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
  
  const FileDisplay = ({ file, onRemove }: { file: File | null, onRemove: () => void }) => {
    if (!file) return null;
    return (
      <div className="mt-2 flex items-center justify-between p-2 bg-gray-100 rounded text-sm">
        <span>{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={isUploading}>
          <XCircle className="h-4 w-4 text-red-500" />
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardContent 
        className="pt-6"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true);}}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleGlobalDrop}
      >
        <h2 className="text-xl font-semibold mb-4">Novo Catálogo (Upload Inteligente)</h2>
        <div className={`border-2 border-dashed ${isDragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300'} rounded-lg p-6 transition-colors`}>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                <FileText className="h-5 w-5 mr-2 text-primary-600" />
                Arquivo Artístico (Visual)
                <span className="text-red-500 ml-1">*</span>
              </h3>
              <p className="text-xs text-gray-500 mb-2">
                PDF com imagens e nomes dos produtos. (Obrigatório)
                <br />Permitido: .pdf, .jpg, .jpeg, .png, .gif, .webp (até 100MB)
              </p>
              <label htmlFor="artistic-file-upload" className={`w-full cursor-pointer rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500 p-3 border border-primary-300 hover:border-primary-500 flex items-center justify-center ${artisticFile ? 'bg-green-50' : 'bg-white'}`}>
                <CloudUpload className="h-5 w-5 mr-2" />
                <span>{artisticFile ? "Trocar Arquivo Artístico" : "Selecionar Arquivo Artístico"}</span>
                <input 
                  id="artistic-file-upload" 
                  name="artistic-file-upload" 
                  type="file" 
                  className="sr-only"
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                  onChange={handleArtisticFileChange}
                  disabled={isUploading}
                />
              </label>
              <FileDisplay file={artisticFile} onRemove={() => { setArtisticFile(null); const el = document.getElementById('artistic-file-upload') as HTMLInputElement; if(el) el.value = ""; }} />
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                <FileSpreadsheet className="h-5 w-5 mr-2 text-blue-600" />
                Arquivo de Preços (Opcional)
              </h3>
              <p className="text-xs text-gray-500 mb-2">
                Planilha Excel ou PDF com códigos/nomes e preços.
                <br />Permitido: .xlsx, .xls, .pdf (até 100MB)
              </p>
              <label htmlFor="pricing-file-upload" className={`w-full cursor-pointer rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500 p-3 border border-primary-300 hover:border-primary-500 flex items-center justify-center ${pricingFile ? 'bg-green-50' : 'bg-white'}`}>
                <CloudUpload className="h-5 w-5 mr-2" />
                <span>{pricingFile ? "Trocar Arquivo de Preços" : "Selecionar Arquivo de Preços"}</span>
                <input 
                  id="pricing-file-upload" 
                  name="pricing-file-upload" 
                  type="file" 
                  className="sr-only"
                  accept=".xlsx,.xls,.pdf"
                  onChange={handlePricingFileChange}
                  disabled={isUploading}
                />
              </label>
              <FileDisplay file={pricingFile} onRemove={() => { setPricingFile(null); const el = document.getElementById('pricing-file-upload') as HTMLInputElement; if(el) el.value = ""; }} />
            </div>
            
            <Button 
              onClick={handleSubmitCatalog} 
              disabled={isUploading || !artisticFile}
              className="w-full"
            >
              {isUploading ? "Enviando Catálogo(s)..." : "Enviar Catálogo(s) para Processamento"}
            </Button>
            
            {isUploading && (
              <div className="mt-2">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-primary-500 h-2.5 rounded-full w-1/2 animate-pulse"></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Enviando arquivos... Isso pode levar um momento.</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
