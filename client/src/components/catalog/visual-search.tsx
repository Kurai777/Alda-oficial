import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Image, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Product } from "@shared/schema";
import ProductCard from "./product-card";

export default function VisualSearch() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      // Check if file is an image
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Tipo de arquivo inválido",
          description: "Por favor, selecione uma imagem.",
          variant: "destructive",
        });
        return;
      }
      
      setSelectedFile(file);
      
      // Create preview URL
      const fileUrl = URL.createObjectURL(file);
      setPreviewUrl(fileUrl);
    }
  };

  const handleSearch = async () => {
    if (!selectedFile || !user) return;
    
    setIsSearching(true);
    setSearchResults([]); // Limpar resultados anteriores
    
    try {
      const formData = new FormData();
      formData.append('searchImage', selectedFile); // Nome do campo esperado pelo multer

      console.log("Enviando imagem para busca visual...");
      // Chamar a rota correta do backend com FormData
      const response = await fetch("/api/products/visual-search", {
        method: "POST",
        body: formData,
        credentials: "include", // Enviar cookies de sessão
      });

      if (!response.ok) {
        let errorMsg = "Erro na busca visual.";
        try {
          const errorData = await response.json();
          errorMsg = errorData.message || errorMsg;
        } catch (e) { /* Ignorar erro de parse se não for JSON */ }
        throw new Error(errorMsg);
      }

      // Processar a resposta JSON com os produtos encontrados
      const results: Product[] = await response.json();
      setSearchResults(results);
      console.log("Resultados da busca visual:", results);

      toast({
        title: "Busca visual concluída",
        description: `Encontrados ${results.length} produtos similares.`,
      });

    } catch (error: any) {
      console.error("Erro na busca visual:", error);
      toast({
        title: "Falha na Busca Visual",
        description: error.message || "Não foi possível realizar a busca.",
        variant: "destructive",
      });
      setSearchResults([]); // Limpar resultados em caso de erro
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-xl font-semibold mb-4">Busca Visual por IA</h2>
        <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
          <div className="md:w-1/2">
            <div 
              className={`border-2 border-dashed border-gray-300 rounded-lg p-4 h-64 flex items-center justify-center ${
                previewUrl ? 'relative' : ''
              }`}
            >
              {previewUrl ? (
                <>
                  <img 
                    src={previewUrl} 
                    alt="Preview" 
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setSearchResults([]);
                      }}
                      className="bg-white hover:bg-gray-100 text-gray-800"
                    >
                      Alterar imagem
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <Image className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-500">Envie uma imagem, render ou foto de referência</p>
                  <label htmlFor="image-upload" className="mt-2 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 cursor-pointer">
                    <span>Selecionar Imagem</span>
                    <input 
                      id="image-upload" 
                      name="image-upload" 
                      type="file" 
                      accept="image/*" 
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                  </label>
                </div>
              )}
            </div>
            
            {previewUrl && (
              <Button 
                className="w-full mt-2"
                onClick={handleSearch}
                disabled={isSearching}
              >
                {isSearching ? (
                  <>
                    <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                    Buscando...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Buscar Produtos Similares
                  </>
                )}
              </Button>
            )}
          </div>
          
          <div className="md:w-1/2">
            <div className="bg-gray-50 rounded-lg p-4 h-64 overflow-y-auto">
              <h3 className="font-medium text-gray-900 mb-2">Resultados da IA</h3>
              
              {searchResults.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {searchResults.map((product) => (
                    <div key={product.id} className="border rounded-md overflow-hidden bg-white hover:shadow-sm transition-shadow">
                      <img 
                        src={product.imageUrl} 
                        alt={product.name} 
                        className="w-full h-20 object-cover"
                      />
                      <div className="p-2">
                        <h4 className="text-xs font-medium truncate">{product.name}</h4>
                        <p className="text-xs text-gray-500">{product.code}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-4">
                  {isSearching 
                    ? "Processando sua imagem..." 
                    : "Faça o upload de uma imagem para que nossa IA encontre produtos similares em seu catálogo."}
                </p>
              )}
              
              {isSearching && (
                <div className="animate-pulse flex flex-col space-y-2 mt-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-16 bg-gray-200 rounded-md"></div>
                    <div className="h-16 bg-gray-200 rounded-md"></div>
                    <div className="h-16 bg-gray-200 rounded-md"></div>
                    <div className="h-16 bg-gray-200 rounded-md"></div>
                    <div className="h-16 bg-gray-200 rounded-md"></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
