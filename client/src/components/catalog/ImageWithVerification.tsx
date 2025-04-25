/**
 * Componente de Imagem com Verificação
 * 
 * Este componente garante a exibição correta da imagem do produto,
 * verificando a disponibilidade da imagem no servidor antes de exibi-la
 * e criando uma cópia única caso a imagem seja compartilhada entre produtos.
 */

import { useState, useEffect } from 'react';
import { Loader2, ImageOff, Image as ImageIcon } from 'lucide-react';

interface ProductImageProps {
  productId: number;
  altText?: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  width?: number | string;
  height?: number | string;
}

export default function ImageWithVerification({
  productId,
  altText = "Imagem do produto",
  className = "",
  onLoad,
  onError,
  width,
  height
}: ProductImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isShared, setIsShared] = useState(false);
  
  // Efeito para verificar a imagem ao montar o componente
  useEffect(() => {
    if (!productId) return;
    
    const controller = new AbortController();
    const signal = controller.signal;
    
    async function verifyImage() {
      try {
        setLoading(true);
        setError(false);
        
        // Verificar a disponibilidade da imagem
        const response = await fetch(`/api/verify-product-image/${productId}`, {
          method: 'GET',
          signal
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.hasImage) {
            // Se a imagem existe, verificar se é compartilhada
            if (data.isShared) {
              setIsShared(true);
              
              // Criar uma cópia única para este produto
              const uniqueResponse = await fetch(`/api/create-unique-image/${productId}`, {
                method: 'POST',
                signal
              });
              
              if (uniqueResponse.ok) {
                const uniqueData = await uniqueResponse.json();
                if (uniqueData.success) {
                  // Usar a URL única criada
                  setImageUrl(`/api/product-image/${productId}?t=${Date.now()}`);
                } else {
                  // Mesmo com erro, usar a URL original
                  setImageUrl(`/api/product-image/${productId}`);
                }
              } else {
                setImageUrl(`/api/product-image/${productId}`);
              }
            } else {
              // Imagem não compartilhada, usar diretamente
              setImageUrl(`/api/product-image/${productId}`);
            }
          } else {
            // Imagem não disponível
            setImageUrl(null);
            setError(true);
          }
        } else {
          // Erro na requisição
          setImageUrl(null);
          setError(true);
        }
      } catch (err) {
        console.error(`Erro ao verificar imagem para produto ${productId}:`, err);
        setImageUrl(null);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    
    verifyImage();
    
    return () => {
      controller.abort();
    };
  }, [productId]);
  
  // Quando a imagem é carregada com sucesso
  const handleImageLoad = () => {
    onLoad?.();
  };
  
  // Quando ocorre um erro ao carregar a imagem
  const handleImageError = () => {
    setError(true);
    onError?.();
  };
  
  // Renderização do estado de carregamento
  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`} style={{ width, height }}>
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }
  
  // Renderização do estado de erro
  if (error || !imageUrl) {
    // Determinar o placeholder com base na categoria (futuro)
    return (
      <div className={`flex flex-col items-center justify-center bg-gray-100 ${className}`} style={{ width, height }}>
        <ImageOff className="h-10 w-10 mb-2 text-gray-400" />
        <span className="text-xs text-gray-500">Imagem indisponível</span>
      </div>
    );
  }
  
  // Renderização da imagem
  return (
    <div className={`relative ${className}`}>
      {isShared && (
        <div className="absolute top-1 right-1 bg-yellow-400 text-xs px-1 py-0.5 rounded-sm">
          Única
        </div>
      )}
      <img
        src={imageUrl}
        alt={altText}
        className={className}
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{ width, height }}
      />
    </div>
  );
}