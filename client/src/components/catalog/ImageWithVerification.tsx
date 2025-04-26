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
  imageUrl?: string; // URL da imagem se já disponível
  altText?: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  width?: number | string;
  height?: number | string;
  disableVerification?: boolean; // Opção para desativar verificação (usar URL diretamente)
  forceCacheBusting?: boolean; // Opção para forçar cache busting (evitar cache do navegador)
}

export default function ImageWithVerification({
  productId,
  imageUrl: initialImageUrl,
  altText = "Imagem do produto",
  className = "",
  onLoad,
  onError,
  width,
  height,
  disableVerification = false,
  forceCacheBusting = false
}: ProductImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl || null);
  const [loading, setLoading] = useState(!initialImageUrl);
  const [error, setError] = useState(false);
  const [isShared, setIsShared] = useState(false);
  
  // Efeito para verificar a imagem ao montar o componente
  useEffect(() => {
    // Se uma URL foi fornecida e a verificação está desativada, usar diretamente
    if ((initialImageUrl && disableVerification) || !productId) {
      setLoading(false);
      return;
    }
    
    // Se temos uma nova URL inicial, use-a
    if (initialImageUrl && initialImageUrl !== imageUrl) {
      setImageUrl(initialImageUrl);
      setLoading(false);
      return;
    }
    
    let isMounted = true;
    const controller = new AbortController();
    
    async function verifyImage() {
      try {
        if (!isMounted) return;
        setLoading(true);
        setError(false);
        
        // Se já temos uma URL e não é uma URL relativa, podemos usá-la diretamente
        if (initialImageUrl && (initialImageUrl.startsWith('http') || initialImageUrl.startsWith('data:'))) {
          if (isMounted) {
            setImageUrl(initialImageUrl);
            setLoading(false);
          }
          return;
        }
        
        // Verificar a disponibilidade da imagem
        const response = await fetch(`/api/verify-product-image/${productId}`, {
          method: 'GET',
          signal: controller.signal
        });
        
        if (!isMounted) return;
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.hasImage) {
            // Se a imagem existe, verificar se é compartilhada
            if (data.isShared) {
              setIsShared(true);
              
              // Criar uma cópia única para este produto
              try {
                const uniqueResponse = await fetch(`/api/create-unique-image/${productId}`, {
                  method: 'POST',
                  signal: controller.signal
                });
                
                if (!isMounted) return;
                
                if (uniqueResponse.ok) {
                  const uniqueData = await uniqueResponse.json();
                  if (uniqueData.success) {
                    // Usar a URL única criada com cache busting
                    setImageUrl(`/api/product-image/${productId}?t=${Date.now()}`);
                  } else {
                    // Mesmo com erro, usar a URL original
                    setImageUrl(initialImageUrl || `/api/product-image/${productId}`);
                  }
                } else {
                  setImageUrl(initialImageUrl || `/api/product-image/${productId}`);
                }
              } catch (err) {
                console.error(`Erro ao criar imagem única para produto ${productId}:`, err);
                if (isMounted) {
                  setImageUrl(initialImageUrl || `/api/product-image/${productId}`);
                }
              }
            } else {
              // Imagem não compartilhada, usar diretamente
              setImageUrl(initialImageUrl || `/api/product-image/${productId}`);
            }
          } else {
            // Imagem não disponível, verificar se temos uma URL alternativa
            if (initialImageUrl) {
              setImageUrl(initialImageUrl);
            } else {
              setImageUrl(null);
              setError(true);
            }
          }
        } else {
          // Erro na requisição, verificar se temos uma URL alternativa
          if (initialImageUrl) {
            setImageUrl(initialImageUrl);
          } else {
            setImageUrl(null);
            setError(true);
          }
        }
      } catch (err) {
        console.error(`Erro ao verificar imagem para produto ${productId}:`, err);
        
        // Em caso de erro, usar a URL inicial se disponível
        if (isMounted) {
          if (initialImageUrl) {
            setImageUrl(initialImageUrl);
          } else {
            setImageUrl(null);
            setError(true);
          }
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    
    verifyImage();
    
    return () => {
      isMounted = false;
      try {
        controller.abort();
      } catch (e) {
        // Ignorar erros ao abortar
      }
    };
  }, [productId, initialImageUrl, disableVerification]);
  
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
  // Adicionar cache busting à URL da imagem se necessário
  let finalImageUrl = imageUrl;
  if (forceCacheBusting && imageUrl) {
    // Adicionar ou atualizar parâmetro de timestamp para evitar cache do navegador
    finalImageUrl = imageUrl.includes('?') 
      ? `${imageUrl}&t=${Date.now()}` 
      : `${imageUrl}?t=${Date.now()}`;
  }
  
  return (
    <div className={`relative ${className}`}>
      {isShared && (
        <div className="absolute top-1 right-1 bg-yellow-400 text-xs px-1 py-0.5 rounded-sm">
          Única
        </div>
      )}
      <img
        src={finalImageUrl}
        alt={altText}
        className={className}
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{ width, height }}
      />
    </div>
  );
}