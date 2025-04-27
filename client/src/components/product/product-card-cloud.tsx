/**
 * Card de produto com imagem otimizada para S3
 * 
 * Este componente exibe um card de produto com suporte para imagens
 * armazenadas no S3, com fallback automático e migração sob demanda.
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CloudImage } from '@/components/ui/cloud-image';
import { formatCurrency } from '@/lib/utils';
import { Product } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { Eye, ShoppingCart, Clipboard } from 'lucide-react';
import { extractImageFilename } from '@/lib/image-utils';

interface ProductCardCloudProps {
  product: Product;
  onAddToQuote?: (product: Product) => void;
  onViewDetails?: (product: Product) => void;
  showControls?: boolean;
  autoMigrate?: boolean;
}

export const ProductCardCloud: React.FC<ProductCardCloudProps> = ({
  product,
  onAddToQuote,
  onViewDetails,
  showControls = false,
  autoMigrate = false
}) => {
  const { toast } = useToast();
  
  // Extrair nome do arquivo da URL da imagem
  const imageFilename = extractImageFilename(product.imageUrl);
  
  // Função para copiar código para a área de transferência
  const copyCode = () => {
    if (product.code) {
      navigator.clipboard.writeText(product.code);
      toast({
        title: 'Código copiado',
        description: `O código ${product.code} foi copiado para a área de transferência.`
      });
    }
  };
  
  return (
    <Card className="overflow-hidden flex flex-col h-full group">
      <div className="relative aspect-square overflow-hidden bg-background">
        {imageFilename ? (
          <CloudImage 
            userId={product.userId}
            catalogId={product.catalogId || 0}
            filename={imageFilename}
            alt={product.name || 'Produto'}
            fallbackSrc="/placeholder-product.png"
            showControls={showControls}
            autoMigrate={autoMigrate}
            imageClassName="h-full w-full object-contain transition-all group-hover:scale-105"
            containerClassName="h-full w-full"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-muted/30">
            <p className="text-sm text-muted-foreground">Sem imagem</p>
          </div>
        )}
      </div>
      
      <CardHeader className="p-3">
        <CardTitle className="text-sm font-medium line-clamp-2">
          {product.name}
        </CardTitle>
        {product.code && (
          <div className="flex items-center gap-1">
            <CardDescription 
              className="text-xs cursor-pointer flex items-center gap-1"
              onClick={copyCode}
            >
              Cód: {product.code}
              <Clipboard className="h-3 w-3" />
            </CardDescription>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="p-3 pt-0 flex-grow">
        {product.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {product.description}
          </p>
        )}
        
        {(product.category || product.materials) && (
          <div className="flex flex-wrap gap-1 mb-2">
            {product.category && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">
                {product.category}
              </span>
            )}
            {product.materials && (
              <span className="px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px]">
                {product.materials}
              </span>
            )}
          </div>
        )}
      </CardContent>
      
      <CardFooter className="p-3 pt-0 flex items-center justify-between">
        <div className="font-bold">
          {product.price ? formatCurrency(product.price) : "Sob consulta"}
        </div>
        
        <div className="flex gap-1">
          {onViewDetails && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 px-2"
              onClick={() => onViewDetails(product)}
            >
              <Eye className="h-4 w-4 mr-1" />
              <span className="sr-only sm:not-sr-only sm:inline">Ver</span>
            </Button>
          )}
          
          {onAddToQuote && (
            <Button 
              variant="default" 
              size="sm" 
              className="h-8 px-2"
              onClick={() => onAddToQuote(product)}
            >
              <ShoppingCart className="h-4 w-4 mr-1" />
              <span className="sr-only sm:not-sr-only sm:inline">Adicionar</span>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default ProductCardCloud;