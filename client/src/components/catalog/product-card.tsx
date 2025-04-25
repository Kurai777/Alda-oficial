import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlusCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Product } from "@shared/schema";
import { Link } from "wouter";

interface ProductCardProps {
  product: Product;
  onAddToQuote?: (product: Product, color: string) => void;
}

export default function ProductCard({ product, onAddToQuote }: ProductCardProps) {
  const [selectedColor, setSelectedColor] = useState<string>(
    product.colors && product.colors.length > 0 ? product.colors[0] : ''
  );
  const { toast } = useToast();

  const handleAddToQuote = () => {
    if (onAddToQuote) {
      onAddToQuote(product, selectedColor);
    } else {
      toast({
        title: "Produto adicionado",
        description: `${product.name} foi adicionado ao orçamento`,
      });
    }
  };

  // Formatting functions
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(price / 100);
  };

  const formatInstallments = (price: number) => {
    const installmentValue = price / 1000;
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(installmentValue);
  };

  // Color utilities
  const getColorClass = (color: string) => {
    const colorMap: { [key: string]: string } = {
      'white': 'bg-white',
      'black': 'bg-gray-800',
      'gray': 'bg-gray-500',
      'brown': 'bg-yellow-700',
      'dark-brown': 'bg-yellow-900',
      'red': 'bg-red-600',
      'green': 'bg-green-600',
      'blue': 'bg-blue-600',
      'yellow': 'bg-yellow-500',
      'purple': 'bg-purple-600',
      'pink': 'bg-pink-600',
    };
    
    return colorMap[color] || 'bg-gray-300';
  };

  const getColorName = (color: string) => {
    const nameMap: { [key: string]: string } = {
      'white': 'Branco',
      'black': 'Preto',
      'gray': 'Cinza',
      'brown': 'Marrom',
      'dark-brown': 'Marrom Escuro',
      'red': 'Vermelho',
      'green': 'Verde',
      'blue': 'Azul',
      'yellow': 'Amarelo',
      'purple': 'Roxo',
      'pink': 'Rosa',
    };
    
    return nameMap[color] || color;
  };

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow border border-gray-100">
      <Link href={`/product/${product.id}`}>
        <div className="relative cursor-pointer">
          <div className="h-48 w-full overflow-hidden bg-muted flex items-center justify-center">
            {product.imageUrl ? (
              <img 
                src={product.imageUrl.startsWith('data:') 
                  ? product.imageUrl 
                  : product.id 
                    ? `/api/product-image/${product.id}` 
                    : product.imageUrl.startsWith('https://mock-firebase-storage.com/')
                      ? `/api/images/${product.userId}/${product.catalogId}/${product.code || 'default'}.jpg`
                      : product.imageUrl.startsWith('https://') || product.imageUrl.startsWith('http://')
                        ? product.imageUrl
                        : product.imageUrl.startsWith('/uploads/') || product.imageUrl.startsWith('/temp/')
                          ? product.imageUrl
                          : product.imageUrl.startsWith('/')
                            ? product.imageUrl
                            : `/${product.imageUrl}`
                }
                alt={product.name} 
                className="h-full w-full object-cover"
                onError={(e) => {
                  console.error(`Erro ao carregar imagem: ${product.imageUrl}`);
                  const target = e.target as HTMLImageElement;
                  target.parentElement?.classList.add('bg-muted');
                  target.style.display = 'none';
                  // Não usamos imagens fictícias, apenas exibimos um ícone
                  const icon = document.createElement('div');
                  icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span class="text-xs text-muted-foreground">Imagem não disponível</span>`;
                  icon.className = 'flex flex-col items-center justify-center h-full w-full';
                  target.parentElement?.appendChild(icon);
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full w-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-muted-foreground">Imagem não disponível</span>
              </div>
            )}
          </div>
          <Badge variant="outline" className="absolute top-2 right-2 bg-white px-2 py-1 rounded-full text-xs font-medium text-primary-600">
            Cod: {product.code}
          </Badge>
        </div>
      </Link>
      <CardContent className="p-4">
        <Link href={`/product/${product.id}`}>
          <h3 className="text-sm font-medium text-gray-900 mb-1 hover:text-primary cursor-pointer">{product.name}</h3>
        </Link>
        <div className="flex flex-col space-y-0.5 mb-2">
          {product.manufacturer && (
            <p className="text-xs text-primary-600 font-medium">
              {product.manufacturer}
            </p>
          )}
          {product.location && (
            <p className="text-xs text-gray-700">
              <span className="font-medium">Local:</span> {product.location}
            </p>
          )}
          <p className="text-xs text-gray-500">{product.description}</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {formatPrice(product.price)}
            </p>
            <p className="text-xs text-gray-500">
              ou 10x de {formatInstallments(product.price)}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/product/${product.id}`}>
              <Button 
                size="icon"
                variant="outline"
                className="p-2 rounded-full"
                title="Ver detalhes"
              >
                <Info className="h-4 w-4" />
              </Button>
            </Link>
            <Button 
              size="icon"
              variant="ghost"
              className="p-2 bg-primary-50 rounded-full text-primary-500 hover:bg-primary-100"
              onClick={handleAddToQuote}
              title="Adicionar ao orçamento"
            >
              <PlusCircle className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {product.colors && product.colors.length > 0 && (
          <div className="mt-3 flex gap-1">
            {product.colors.map((color) => (
              <button
                key={color}
                className={`h-4 w-4 rounded-full ${getColorClass(color)} border border-gray-300 focus:outline-none ${
                  selectedColor === color ? 'ring-1 ring-primary-500' : ''
                }`}
                title={getColorName(color)}
                onClick={() => setSelectedColor(color)}
              ></button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
