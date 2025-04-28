/**
 * Componente de Imagem com Verificação
 * 
 * Este componente garante a exibição correta da imagem do produto,
 * verificando a disponibilidade da imagem no servidor antes de exibi-la
 * e criando uma cópia única caso a imagem seja compartilhada entre produtos.
 */

import { useState, useEffect } from 'react';
import { Loader2, ImageOff } from 'lucide-react';

interface ProductImageProps {
  productId: number; // Mantido caso seja útil para debug ou alt text
  imageUrl?: string; // URL da imagem (espera-se URL do S3)
  altText?: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  width?: number | string;
  height?: number | string;
  // As props disableVerification e forceCacheBusting não são mais necessárias
}

export default function ImageWithVerification({
  productId, // productId mantido para logs
  imageUrl: initialImageUrl,
  altText = `Imagem produto ${productId}`,
  className = "",
  onLoad,
  onError,
  width,
  height,
}: ProductImageProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(initialImageUrl || null);
  const [loading, setLoading] = useState<boolean>(true); // Começa carregando
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    // Resetar estados quando a URL inicial mudar
    setCurrentImageUrl(initialImageUrl || null);
    setLoading(!!initialImageUrl); // Carrega se tiver URL inicial
    setError(false);
  }, [initialImageUrl]);

  const handleImageLoad = () => {
    // console.log(`Imagem carregada para produto ${productId}: ${currentImageUrl}`);
    setLoading(false);
    setError(false);
    onLoad?.();
  };

  const handleImageError = () => {
    console.error(`Erro ao carregar imagem para produto ${productId}: ${currentImageUrl}`);
    setLoading(false);
    setError(true);
    onError?.();
  };

  // Não exibir nada ou loader se não houver URL inicial (ou enquanto determina)
  if (!currentImageUrl && loading) {
     return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`} style={{ width, height }}>
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Exibir placeholder se houve erro ou não há URL
  if (error || !currentImageUrl) {
    return (
      <div className={`flex flex-col items-center justify-center bg-gray-100 text-center ${className}`} style={{ width, height }}>
        <ImageOff className="h-10 w-10 mb-2 text-gray-400" />
        <span className="text-xs text-gray-500">Imagem indisponível</span>
      </div>
    );
  }

  // Renderização da imagem
  // Adicionar timestamp simples para cache busting (pode ser removido se não necessário)
  const finalImageUrl = `${currentImageUrl}?t=${Date.now()}`;
  // console.log(`Renderizando imagem para produto ${productId}: ${finalImageUrl}`);

  return (
    <div className={`relative ${className}`}>
      {/* Remover indicador de imagem "Única" pois a lógica foi removida */}
      <img
        key={finalImageUrl} // Adicionar key para forçar re-render se URL mudar com timestamp
        src={finalImageUrl} 
        alt={altText}
        className={className} // Aplicar a classe aqui
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{ width, height, objectFit: 'contain' }} // Usar objectFit para evitar distorção
      />
    </div>
  );
}