import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter'; // Usaremos wouter
import { useQuery, QueryKey } from '@tanstack/react-query'; // Importar QueryKey
import axios from 'axios';
import { Moodboard, Product } from '@shared/schema'; // Importar tipos
import { ArrowLeft, Palette, Package, Info, Image, Download } from 'lucide-react'; // Adicionar ícones
import { Button } from '@/components/ui/button'; // Importar Button

// Função para buscar detalhes de um moodboard específico
const fetchMoodboardDetails = async (moodboardId: string | undefined): Promise<Moodboard | null> => {
  if (!moodboardId) return null;
  const { data } = await axios.get<Moodboard>(`/api/moodboards/${moodboardId}`);
  return data;
};

// Função para buscar detalhes de um produto específico
const fetchProductDetails = async (productId: number): Promise<Product | null> => {
  try {
    const { data } = await axios.get<Product>(`/api/products/${productId}`);
    return data;
  } catch (error) {
    console.error(`Erro ao buscar produto ID ${productId}:`, error);
    return null;
  }
};

const MoodboardDetailPage: React.FC = () => {
  const params = useParams();
  const moodboardId = params.id;

  // Usar a sintaxe de objeto para useQuery
  const { data: moodboard, isLoading, isError, error } = useQuery<Moodboard | null, Error, Moodboard | null, QueryKey>(
    { // Objeto de opções
      queryKey: ['moodboardDetails', moodboardId], 
      queryFn: () => fetchMoodboardDetails(moodboardId),
      enabled: !!moodboardId, 
    }
  );

  // Estado para armazenar os detalhes dos produtos
  const [productsDetails, setProductsDetails] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  useEffect(() => {
    const fetchAllProductDetails = async () => {
      if (moodboard && Array.isArray(moodboard.productIds) && moodboard.productIds.length > 0) {
        setIsLoadingProducts(true);
        const productPromises = moodboard.productIds.map(id => fetchProductDetails(id));
        try {
          const resolvedProducts = await Promise.all(productPromises);
          setProductsDetails(resolvedProducts.filter(p => p !== null) as Product[]);
        } catch (fetchError) {
          console.error("Erro ao buscar todos os detalhes dos produtos:", fetchError);
          setProductsDetails([]); // Limpar em caso de erro no Promise.all
        } finally {
          setIsLoadingProducts(false);
        }
      } else {
        setProductsDetails([]);
        setIsLoadingProducts(false);
      }
    };

    if (moodboardId) { // Só buscar se houver um moodboardId e o moodboard principal já foi carregado
        fetchAllProductDetails();
    }
  }, [moodboard, moodboardId]); // Adicionar moodboardId às dependências e garantir que moodboard é a dependência principal

  const moodboardErrorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao carregar moodboard.';

  const handleDownloadImage = () => {
    if (moodboard && moodboard.generatedImageUrl) {
      window.open(moodboard.generatedImageUrl, '_blank');
    }
  };

  if (isLoading) {
    return <div className="container mx-auto p-8 text-center text-gray-500">Carregando detalhes do moodboard...</div>;
  }

  if (isError || !moodboard) { // Se há erro ou moodboard é null/undefined após a query
    return (
      <div className="container mx-auto p-8 text-center">
        <Info size={48} className="mx-auto text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-red-700 mb-2">Erro ao Carregar Moodboard</h2>
        <p className="text-red-600">{moodboardErrorMessage}</p>
        <Link to="/moodboards" className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700">
          <ArrowLeft size={18} className="mr-2" />
          Voltar para Meus Moodboards
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex justify-between items-center mb-6">
        <Link to="/moodboards" className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium">
          <ArrowLeft size={20} className="mr-1" />
          Voltar para Meus Moodboards
        </Link>
        {/* Botão de Download */}
        {moodboard && moodboard.generatedImageUrl && (
          <Button onClick={handleDownloadImage} variant="outline">
            <Download size={18} className="mr-2" />
            Baixar Moodboard
          </Button>
        )}
      </div>

      <div className="bg-white shadow-lg rounded-lg p-6 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">{moodboard.projectName}</h1>
        <div className="text-xs text-gray-500 mb-1">
          Criado em: {moodboard.createdAt ? new Date(moodboard.createdAt).toLocaleDateString('pt-BR') : 'N/A'} 
          {moodboard.updatedAt && moodboard.updatedAt !== moodboard.createdAt ? ` | Atualizado em: ${new Date(moodboard.updatedAt).toLocaleDateString('pt-BR')}` : ''}
        </div>
        <p className="text-sm text-gray-600 mb-1">Estilo: <span className="font-medium text-gray-700">{moodboard.style || 'Não definido'}</span></p>
        <p className="text-sm text-gray-600 mb-6">Status: <span className="font-medium text-gray-700">{moodboard.status || 'N/A'}</span></p>
        
        {moodboard.description && (
          <div className="mb-6 pb-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-700 mb-2 flex items-center"><Palette size={20} className="mr-2 text-blue-500"/>Descrição do Projeto</h2>
            <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-4 rounded-md">{moodboard.description}</p>
          </div>
        )}

        {moodboard.colorPalette && Array.isArray(moodboard.colorPalette) && moodboard.colorPalette.length > 0 && (
          <div className="mb-6 pb-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-700 mb-3 flex items-center"><Palette size={20} className="mr-2 text-purple-500"/>Paleta de Cores</h2>
            <div className="flex flex-wrap gap-3">
              {moodboard.colorPalette.map((color, index) => (
                <div key={index} className="p-3 rounded-lg shadow-md bg-white flex flex-col items-center border border-gray-200 min-w-[80px]">
                  <div style={{ backgroundColor: color }} className="w-10 h-10 rounded-full border-2 border-white shadow-inner mb-2"></div>
                  <span className="text-xs text-gray-600 font-medium">{color}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Exibir Imagem Gerada pelo DALL-E */}
        {moodboard.generatedImageUrl && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-3 flex items-center">
              <Image size={20} className="mr-2 text-indigo-500"/>
              Visualização do Moodboard (Gerada por IA)
            </h2>
            <div className="bg-gray-100 rounded-lg p-2 shadow-inner aspect-[1024/1024] max-w-2xl mx-auto"> {/* Manter aspect ratio */} 
              <img 
                src={moodboard.generatedImageUrl} 
                alt={`Moodboard: ${moodboard.projectName}`} 
                className="w-full h-full object-contain rounded-md"
              />
            </div>
            {/* Opcional: mostrar o iaPrompt usado para DALL-E se existir no moodboard.iaPrompt (precisaria salvar o prompt específico do DALL-E) */}
            {/* {moodboard.iaPrompt && <p className='text-xs text-gray-400 mt-1'>Prompt DALL-E: {moodboard.iaPrompt.substring(0,100)}...</p>} */}
          </div>
        )}
        {!moodboard.generatedImageUrl && moodboard.status === 'image_generation_failed' && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 rounded-md border border-red-200">
            <p>Falha ao gerar a imagem visual para este moodboard.</p>
          </div>
        )}
        {!moodboard.generatedImageUrl && moodboard.status === 'text_generated' && (
          <div className="mb-8 p-4 bg-yellow-50 text-yellow-700 rounded-md border border-yellow-200">
            <p>A imagem visual para este moodboard ainda está pendente ou não foi solicitada.</p>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-3 flex items-center"><Package size={20} className="mr-2 text-green-500"/>Produtos Incluídos</h2>
          {isLoadingProducts && <p className="text-gray-500 py-4">Carregando produtos do moodboard...</p>}
          {!isLoadingProducts && moodboard && Array.isArray(moodboard.productIds) && moodboard.productIds.length > 0 && (
            productsDetails.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {productsDetails.map(product => (
                    <div key={product.id} className="border rounded-lg p-3 bg-white shadow-md hover:shadow-lg transition-shadow">
                    {product.imageUrl && (
                        <img 
                        src={product.imageUrl} 
                        alt={product.name} 
                        className="w-full h-36 object-contain mb-3 rounded-md bg-gray-100 p-1"
                        onError={(e) => { e.currentTarget.src = '/placeholder-image.svg'; }}
                        />
                    )}
                    {!product.imageUrl && (
                        <div className="w-full h-36 bg-gray-100 flex items-center justify-center mb-3 rounded-md">
                            <Package size={40} className="text-gray-300"/>
                        </div>
                    )}
                    <h3 className="font-semibold text-sm text-gray-800 truncate" title={product.name}>{product.name}</h3>
                    <p className="text-xs text-gray-500">Código: {product.code}</p>
                    </div>
                ))}
                </div>
            ) : (
                <p className="col-span-full text-gray-500 text-center py-4">Não foi possível carregar os detalhes dos produtos incluídos.</p>
            )
          )}
          {/* Se não há productIds no moodboard, ou se o moodboard ainda não carregou essa info */}
          {(!moodboard || !Array.isArray(moodboard.productIds) || moodboard.productIds.length === 0) && !isLoadingProducts && (
              <p className="text-gray-500 text-center py-4">Nenhum produto foi adicionado a este moodboard ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MoodboardDetailPage; 