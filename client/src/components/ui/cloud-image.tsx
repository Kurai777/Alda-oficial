/**
 * Componente de imagem inteligente com suporte para S3
 * 
 * Este componente gerencia automaticamente o acesso a imagens armazenadas no S3,
 * com fallback para armazenamento local e migração automática sob demanda.
 */

import React, { useState } from 'react';
import { useImageS3Check } from '@/hooks/use-image-s3-check';
import { Loader2, Cloud, CloudOff, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface CloudImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  userId: number | string;
  catalogId: number | string;
  filename: string;
  fallbackSrc?: string;
  autoMigrate?: boolean;
  showControls?: boolean;
  imageClassName?: string;
  containerClassName?: string;
}

export const CloudImage: React.FC<CloudImageProps> = ({
  userId,
  catalogId,
  filename,
  fallbackSrc,
  autoMigrate = false,
  showControls = false,
  alt = 'Imagem',
  imageClassName = '',
  containerClassName = '',
  ...props
}) => {
  const [hasError, setHasError] = useState(false);
  
  // Usar o hook para verificar a imagem no S3
  const {
    loading,
    imageUrl,
    isS3Image,
    status,
    error,
    migrateToS3
  } = useImageS3Check(userId, catalogId, filename, { autoMigrate });
  
  // Tratamento de erro na carga da imagem
  const handleError = () => {
    setHasError(true);
  };
  
  // URL real a ser usada
  const effectiveUrl = hasError ? 
    fallbackSrc : 
    (imageUrl || fallbackSrc || `/api/images/${userId}/${catalogId}/${filename}`);
  
  // Estado de carregamento
  if (loading) {
    return (
      <div className={cn("flex items-center justify-center p-2 bg-muted rounded", containerClassName)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // Estado de erro
  if ((error || !status?.exists) && !fallbackSrc) {
    return (
      <div className={cn("flex flex-col items-center justify-center p-2 bg-muted/30 rounded border border-dashed", containerClassName)}>
        <div className="text-muted-foreground text-xs">Imagem não disponível</div>
      </div>
    );
  }
  
  return (
    <div className={cn("relative group", containerClassName)}>
      <img 
        src={effectiveUrl}
        alt={alt}
        onError={handleError}
        className={cn("object-contain", imageClassName)}
        {...props}
      />
      
      {/* Controles e status */}
      {showControls && (
        <div className="absolute top-1 right-1 flex gap-1">
          <TooltipProvider>
            {/* Status S3 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-1 rounded-full bg-background shadow-sm">
                  {isS3Image ? (
                    <Cloud className="h-4 w-4 text-primary" />
                  ) : (
                    <CloudOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isS3Image ? 'Armazenada na nuvem' : 'Armazenamento local'}</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Botão de migração para S3 */}
            {status?.s3Available && !isS3Image && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="h-6 w-6"
                    onClick={() => migrateToS3()}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Migrar para armazenamento em nuvem</p>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      )}
    </div>
  );
};

export default CloudImage;