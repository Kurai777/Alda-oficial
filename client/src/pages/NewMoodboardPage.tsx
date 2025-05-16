import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient, UseMutationResult, useQuery, QueryKey } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { InsertMoodboard, Moodboard, Product } from '@shared/schema';
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from "@/lib/auth";

// Função para buscar os produtos do usuário
const fetchUserProducts = async (): Promise<Product[]> => {
  const { data } = await axios.get<Product[]>('/api/products');
  return data;
};

// API para CRIAR/SALVAR o moodboard (manual ou após geração IA)
const saveMoodboardApi = async (moodboardData: InsertMoodboard): Promise<Moodboard> => {
  const { data } = await axios.post<Moodboard>('/api/moodboards', moodboardData);
  return data;
};

// NOVA API para GERAR conteúdo do moodboard com IA
interface GenerateAiContentParams {
  userId: number;
  productIds: number[];
  userPrompt: string;
}
const generateAiContentApi = async (params: GenerateAiContentParams): Promise<Moodboard> => { // Espera retornar um Moodboard completo
  const { data } = await axios.post<Moodboard>('/api/moodboards/generate-ai-content', params);
  return data;
};

const NewMoodboardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Estados do formulário principal
  const [projectName, setProjectName] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [userPrompt, setUserPrompt] = useState(''); // Prompt do usuário para IA
  const [description, setDescription] = useState(''); // Descrição (pode ser da IA ou manual)
  const [style, setStyle] = useState(''); // Estilo (pode ser da IA ou manual)
  const [colorPalette, setColorPalette] = useState<string[]>([]); // Paleta (pode ser da IA)
  
  const [formError, setFormError] = useState<string | null>(null);

  const { 
    data: products, 
    isLoading: isLoadingProducts, 
    error: productsError, 
    isError: isProductsError 
  } = useQuery<Product[], Error, Product[], QueryKey>({
    queryKey: ['userProducts'], 
    queryFn: fetchUserProducts,
  });

  // Mutação para GERAR conteúdo com IA
  const generateContentMutation = useMutation<Moodboard, AxiosError, GenerateAiContentParams>(
    {
      mutationFn: generateAiContentApi,
      onSuccess: (data: Moodboard) => {
        toast({ title: "Conteúdo Gerado!", description: "A IA preencheu os campos do moodboard." });
        setProjectName(data.projectName || '');
        setDescription(data.description || '');
        setStyle(data.style || '');
        setColorPalette(Array.isArray(data.colorPalette) ? data.colorPalette : []);
      },
      onError: (err: AxiosError) => {
        const responseData = err.response?.data as { message?: string };
        setFormError(responseData?.message || err.message || 'Falha ao gerar conteúdo com IA.');
      },
    }
  );

  // Mutação para SALVAR o moodboard (seja manual ou após geração IA)
  const saveMoodboardMutation = useMutation<Moodboard, AxiosError, InsertMoodboard>(
    {
      mutationFn: saveMoodboardApi,
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ['moodboards'] });
        toast({ title: "Moodboard Salvo!", description: `"${data.projectName}" foi salvo com sucesso.` });
        navigate('/moodboards');
      },
      onError: (err: AxiosError) => {
        const responseData = err.response?.data as { message?: string };
        setFormError(responseData?.message || err.message || 'Ocorreu um erro ao salvar o moodboard.');
      },
    }
  );

  const handleProductSelect = (productId: number) => {
    setSelectedProductIds(prevSelectedIds => {
      if (prevSelectedIds.includes(productId)) {
        return prevSelectedIds.filter(id => id !== productId);
      } else {
        return [...prevSelectedIds, productId];
      }
    });
  };

  const handleGenerateWithAi = async () => {
    setFormError(null);
    if (!user) {
      setFormError('Usuário não autenticado.');
      return;
    }
    if (selectedProductIds.length === 0 && !userPrompt.trim()) {
      setFormError('Selecione produtos ou forneça um prompt para a IA.');
      return;
    }
    generateContentMutation.mutate({ userId: user.id, productIds: selectedProductIds, userPrompt });
  };

  const handleSaveMoodboard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!user) {
      setFormError('Usuário não autenticado.');
      return;
    }
    if (!projectName.trim()) {
      setFormError('O nome do projeto é obrigatório.');
      return;
    }
    saveMoodboardMutation.mutate({
      userId: user.id,
      projectName,
      productIds: selectedProductIds.length > 0 ? selectedProductIds : [],
      description: description || undefined,
      style: style || undefined,
      colorPalette: colorPalette.length > 0 ? colorPalette : [],
    });
  };

  const isSaving = saveMoodboardMutation.isPending;
  const isGenerating = generateContentMutation.isPending;
  const productsErrorMessage = productsError instanceof Error ? productsError.message : 'Erro ao buscar produtos';

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-6">Criar Novo Moodboard</h1>
      
      <form onSubmit={handleSaveMoodboard} className="max-w-3xl mx-auto bg-white p-6 rounded-lg shadow space-y-6">
        <div>
          <Label htmlFor="projectName">Nome do Projeto:</Label>
          <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Ex: Sala de Estar Elegante" required disabled={isSaving || isGenerating} />
        </div>
        <div>
          <Label htmlFor="userPrompt">Seu Pedido para a IA (para gerar descrição, estilo, paleta):</Label>
          <Textarea id="userPrompt" value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} placeholder="Ex: Crie um moodboard com estilo moderno e cores vibrantes para os produtos selecionados... (Deixe em branco se não quiser usar IA para esta parte)" rows={3} disabled={isSaving || isGenerating} />
          <Button type="button" onClick={handleGenerateWithAi} className="mt-2 bg-teal-500 hover:bg-teal-600 text-white" disabled={isSaving || isGenerating || (!userPrompt.trim() && selectedProductIds.length === 0)}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isGenerating ? 'Gerando Conteúdo...' : 'Gerar com IA'}
          </Button>
        </div>
        <div>
          <Label htmlFor="description">Descrição (gerada pela IA ou manual):</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} disabled={isSaving || isGenerating} />
        </div>
        <div>
          <Label htmlFor="style">Estilo (gerado pela IA ou manual):</Label>
          <Input id="style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={isSaving || isGenerating} placeholder="Ex: Moderno, Rústico..." />
        </div>
        {colorPalette.length > 0 && (
          <div>
            <Label>Paleta de Cores (sugerida pela IA):</Label>
            <div className="flex flex-wrap gap-2">
              {colorPalette.map((color, index) => (
                <div key={index} className="p-2 rounded-md shadow flex items-center border">
                  <div style={{ backgroundColor: color }} className="w-6 h-6 rounded-full border border-gray-300 mr-2"></div>
                  <span className="text-xs text-gray-600">{color}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Selecione os Produtos</h2>
          {isLoadingProducts && <p className="text-gray-500">Carregando produtos...</p>}
          {isProductsError && (
            <div className="text-red-600 bg-red-100 p-3 rounded">
              Erro ao carregar produtos: {productsErrorMessage}
            </div>
          )}
          {!isLoadingProducts && !isProductsError && Array.isArray(products) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-96 overflow-y-auto border p-4 rounded">
              {products.length > 0 ? (
                products.map((product: Product) => (
                  <div 
                    key={product.id} 
                    onClick={() => !(isSaving || isGenerating) && handleProductSelect(product.id)}
                    className={`border rounded-lg p-2 cursor-pointer transition-all duration-150 ${selectedProductIds.includes(product.id) ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50' : 'border-gray-200 hover:shadow-md'} ${isSaving || isGenerating ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <img 
                        src={product.imageUrl || '/placeholder-image.svg'}
                        alt={product.name}
                        className="w-full h-24 object-contain mb-2 bg-gray-100 rounded"
                        onError={(e) => { e.currentTarget.src = '/placeholder-image.svg'; }}
                     />
                    <p className="text-xs font-medium text-gray-700 truncate">{product.name}</p>
                    <p className="text-xs text-gray-500">{product.code}</p>
                  </div>
                ))
              ) : (
                <p className="col-span-full text-center text-gray-500">Nenhum produto encontrado no seu catálogo.</p>
              )}
            </div>
          )}
        </div>
        {formError && (
          <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">Erro:</strong>
            <span className="block sm:inline"> {formError}</span>
          </div>
        )}
        <div className="flex items-center justify-end space-x-3">
          <Button type="button" variant="outline" onClick={() => navigate('/moodboards')} disabled={isSaving || isGenerating}>Cancelar</Button>
          <Button type="submit" className="bg-blue-500 hover:bg-blue-600 text-white" disabled={isSaving || isGenerating || !projectName.trim()}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Salvando...' : 'Salvar Moodboard'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default NewMoodboardPage; 