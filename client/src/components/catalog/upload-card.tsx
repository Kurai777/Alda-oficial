import { useState, ChangeEvent, DragEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CloudUpload, FileText, FileSpreadsheet, XCircle, Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type UploadMode = "complete" | "separate";

export default function UploadCard() {
  const [uploadMode, setUploadMode] = useState<UploadMode>("separate");
  const [artisticFile, setArtisticFile] = useState<File | null>(null);
  const [pricingFile, setPricingFile] = useState<File | null>(null);
  const [completeFile, setCompleteFile] = useState<File | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const commonFileValidation = (file: File, allowedExtensions: string[]) => {
    let isValid = false;
    let errorMessage = "";
    if (file.size > 100 * 1024 * 1024) { // 100MB
      errorMessage = "Arquivo muito grande. O tamanho máximo permitido é 100MB.";
      return { isValid, errorMessage };
    }
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (allowedExtensions.includes(fileExtension)) {
      isValid = true;
    } else {
      errorMessage = `Tipo de arquivo inválido. Permitidos: ${allowedExtensions.join(', ')}`;
    }
    return { isValid, errorMessage };
  };

  const handleFileSelection = (e: ChangeEvent<HTMLInputElement>, setFile: (file: File | null) => void, allowedExtensions: string[], fieldName: string) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const { isValid, errorMessage } = commonFileValidation(file, allowedExtensions);
      if (!isValid) {
        toast({ title: `Arquivo Inválido para ${fieldName}`, description: errorMessage, variant: "destructive" });
        setFile(null);
        e.target.value = ""; 
        return;
      }
      setFile(file);
    } else {
      setFile(null); // Limpar se nenhum arquivo for selecionado
    }
  };
  
  const handleGlobalDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    toast({ title: "Ação de Arrastar", description: "Por favor, use os botões 'Selecionar Arquivo' para cada campo.", variant: "default" });
  };

  const handleSubmitCatalog = async () => {
    if (!user) {
      toast({ title: "Erro de Autenticação", description: "Você precisa estar logado.", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append('userId', user.id.toString());
    formData.append('uploadMode', uploadMode);

    if (uploadMode === "complete") {
      if (!completeFile) {
        toast({ title: "Arquivo Obrigatório", description: "Por favor, selecione o arquivo de catálogo completo.", variant: "destructive" });
        return;
      }
      formData.append('artisticFile', completeFile); // No backend, este será o arquivo principal
    } else { // separate mode
      if (!artisticFile) {
        toast({ title: "Arquivo Artístico Obrigatório", description: "Por favor, selecione o arquivo artístico/visual.", variant: "destructive" });
        return;
      }
      formData.append('artisticFile', artisticFile);
      if (pricingFile) {
        formData.append('pricingFile', pricingFile);
      }
    }

    try {
      setIsUploading(true);
      const response = await fetch('/api/catalogs/upload', { method: 'POST', body: formData });

      if (!response.ok) {
        let errorText = `Upload falhou: ${response.statusText}`;
        try { const errorData = await response.json(); errorText = errorData.message || errorText; } catch (e) { /* Mantém o statusText original */ }
        throw new Error(errorText);
      }

      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/catalogs"] });
      toast({ title: "Envio Concluído!", description: result.message || "Seu(s) catálogo(s) está(ão) sendo processado(s)." });
      setArtisticFile(null); setPricingFile(null); setCompleteFile(null);
      
      // Limpar inputs visuais de forma compatível
      const artisticFileInput = document.getElementById('artisticFile') as HTMLInputElement | null;
      if (artisticFileInput) artisticFileInput.value = "";

      const pricingFileInput = document.getElementById('pricingFile') as HTMLInputElement | null;
      if (pricingFileInput) pricingFileInput.value = "";

      const completeFileInput = document.getElementById('completeFile') as HTMLInputElement | null;
      if (completeFileInput) completeFileInput.value = "";

    } catch (error) {
      toast({ title: "Falha no Upload", description: error instanceof Error ? error.message : "Ocorreu um erro.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };
  
  const FileInputField = ({ id, label, acceptedExtensions, selectedFile, onChange, onRemove, helpText, isRequired }: {
    id: string; label: string; acceptedExtensions: string[]; selectedFile: File | null;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void;
    helpText: string; isRequired?: boolean;
  }) => (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-1 flex items-center">
        {id === "artisticFile" || id === "completeFile" ? <FileText className="h-5 w-5 mr-2 text-primary-600" /> : <FileSpreadsheet className="h-5 w-5 mr-2 text-blue-600" />}
        {label} {isRequired && <span className="text-red-500 ml-1">*</span>}
      </h3>
      <p className="text-xs text-gray-500 mb-2">{helpText}<br />Permitido: {acceptedExtensions.join(', ')} (até 100MB)</p>
      <label htmlFor={id} className={`w-full cursor-pointer rounded-md font-medium text-primary-600 hover:text-primary-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-500 p-3 border border-primary-300 hover:border-primary-500 flex items-center justify-center ${selectedFile ? 'bg-green-50' : 'bg-white'}`}>
        <CloudUpload className="h-5 w-5 mr-2" />
        <span>{selectedFile ? `Trocar ${label}` : `Selecionar ${label}`}</span>
        <input id={id} name={id} type="file" className="sr-only" accept={acceptedExtensions.join(',')} onChange={onChange} disabled={isUploading} />
      </label>
      {selectedFile && (
        <div className="mt-2 flex items-center justify-between p-2 bg-gray-100 rounded text-sm">
          <span>{selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={isUploading}><XCircle className="h-4 w-4 text-red-500" /></Button>
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6" onDragOver={(e) => { e.preventDefault(); setIsDragging(true);}} onDragLeave={() => setIsDragging(false)} onDrop={handleGlobalDrop}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Novo Catálogo (Upload Inteligente)</h2>
        </div>

        <RadioGroup value={uploadMode} onValueChange={(value) => setUploadMode(value as UploadMode)} className="mb-6">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="separate" id="modeSeparate" />
            <Label htmlFor="modeSeparate">Arquivos Separados (Visual + Preços)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="complete" id="modeComplete" />
            <Label htmlFor="modeComplete">Catálogo Único/Completo (Excel ou PDF com tudo)</Label>
          </div>
        </RadioGroup>

        <div className={`border-2 border-dashed ${isDragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300'} rounded-lg p-6 transition-colors`}>
          <div className="space-y-6">
            {uploadMode === "separate" && (
              <>
                <FileInputField
                  id="artisticFile"
                  label="Arquivo Artístico (Visual)"
                  acceptedExtensions={['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp']}
                  selectedFile={artisticFile}
                  onChange={(e) => handleFileSelection(e, setArtisticFile, ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'], "Arquivo Artístico")}
                  onRemove={() => { 
                    setArtisticFile(null); 
                    const inputElement = document.getElementById('artisticFile') as HTMLInputElement | null;
                    if (inputElement) {
                      inputElement.value = ""; 
                    }
                  }}
                  helpText="PDF com imagens e nomes dos produtos, ou um Excel apenas com dados visuais/descritivos."
                  isRequired={true}
                />
                <FileInputField
                  id="pricingFile"
                  label="Arquivo de Preços (Opcional)"
                  acceptedExtensions={['.xlsx', '.xls', '.pdf']}
                  selectedFile={pricingFile}
                  onChange={(e) => handleFileSelection(e, setPricingFile, ['.xlsx', '.xls', '.pdf'], "Arquivo de Preços")}
                  onRemove={() => { 
                    setPricingFile(null); 
                    const inputElement = document.getElementById('pricingFile') as HTMLInputElement | null;
                    if (inputElement) {
                      inputElement.value = ""; 
                    }
                  }}
                  helpText="Planilha Excel ou PDF com códigos/nomes e tabelas de preços."
                />
              </>
            )}

            {uploadMode === "complete" && (
              <FileInputField
                id="completeFile"
                label="Arquivo de Catálogo Completo"
                acceptedExtensions={['.xlsx', '.xls', '.pdf']}
                selectedFile={completeFile}
                onChange={(e) => handleFileSelection(e, setCompleteFile, ['.xlsx', '.xls', '.pdf'], "Catálogo Completo")}
                onRemove={() => { 
                  setCompleteFile(null); 
                  const inputElement = document.getElementById('completeFile') as HTMLInputElement | null;
                  if (inputElement) {
                    inputElement.value = ""; 
                  }
                }}
                helpText="Envie um único arquivo Excel ou PDF que já contenha todas as informações: visuais, descrições, códigos, preços, etc."
                isRequired={true}
              />
            )}
            
            <Button 
              onClick={handleSubmitCatalog} 
              disabled={isUploading || (uploadMode === "complete" && !completeFile) || (uploadMode === "separate" && !artisticFile)}
              className="w-full mt-4"
            >
              {isUploading ? "Enviando..." : "Enviar para Processamento"}
            </Button>
            
            {isUploading && (
              <div className="mt-4">
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
