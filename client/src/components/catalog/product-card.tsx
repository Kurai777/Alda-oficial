import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Product } from "@shared/schema";

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
      <div className="relative">
        <img 
          src={product.imageUrl} 
          alt={product.name} 
          className="h-48 w-full object-cover"
          onError={(e) => {
            // Fallback image if the product image fails to load
            (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x150?text=Sem+Imagem';
          }}
        />
        <Badge variant="outline" className="absolute top-2 right-2 bg-white px-2 py-1 rounded-full text-xs font-medium text-primary-600">
          Cod: {product.code}
        </Badge>
      </div>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-1">{product.name}</h3>
        <p className="text-xs text-gray-500 mb-2">{product.description}</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {formatPrice(product.price)}
            </p>
            <p className="text-xs text-gray-500">
              ou 10x de {formatInstallments(product.price)}
            </p>
          </div>
          <Button 
            size="icon"
            variant="ghost"
            className="p-2 bg-primary-50 rounded-full text-primary-500 hover:bg-primary-100"
            onClick={handleAddToQuote}
          >
            <PlusCircle className="h-5 w-5" />
          </Button>
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
