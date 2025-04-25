import { useState, useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  ChevronLeft, 
  Loader2, 
  ShoppingCart, 
  Package, 
  TrendingUp,
  Ruler,
  Palette
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Product } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function ProductDetailPage() {
  const { productId } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedColor, setSelectedColor] = useState<string>("");

  // Buscar produto por ID
  const { data: product, isLoading, error } = useQuery<Product>({
    queryKey: [`/api/products/${productId}`],
    enabled: !!productId,
  });

  // Selecionar a primeira cor automaticamente quando o produto carrega
  useEffect(() => {
    if (product?.colors && product.colors.length > 0) {
      setSelectedColor(product.colors[0]);
    }
  }, [product]);

  // Funções de formatação
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(price);
  };

  const formatDimension = (value: number | undefined | null) => {
    if (value === undefined || value === null) return "N/A";
    return `${value} cm`;
  };

  // Utilidades de cores
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
    
    return colorMap[color.toLowerCase()] || 'bg-gray-300';
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
    
    return nameMap[color.toLowerCase()] || color;
  };

  const handleAddToQuote = () => {
    toast({
      title: "Produto adicionado",
      description: `${product?.name} foi adicionado ao orçamento`,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Produto não encontrado</h1>
          <p className="mb-6">O produto que você está procurando não existe ou foi removido.</p>
          <Button onClick={() => navigate("/")}>Voltar para a página inicial</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Imagem */}
        <div className="bg-muted rounded-lg overflow-hidden h-[400px] flex items-center justify-center">
          {product.imageUrl ? (
            <img 
              src={product.imageUrl?.startsWith('data:') 
                ? product.imageUrl 
                : product.imageUrl?.startsWith('/uploads/') || product.imageUrl?.startsWith('http')
                  ? product.imageUrl
                  : product.imageUrl?.startsWith('/')
                    ? product.imageUrl
                    : product.imageUrl ? `/${product.imageUrl}` : ''} 
              alt={product.name} 
              className="h-full w-full object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.parentElement?.classList.add('bg-muted');
                target.style.display = 'none';
                const icon = document.createElement('div');
                icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-20 w-20 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span class="text-sm text-muted-foreground">Imagem do produto não disponível</span>`;
                icon.className = 'flex flex-col items-center justify-center h-full w-full';
                target.parentElement?.appendChild(icon);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm text-muted-foreground">Imagem do produto não disponível</span>
            </div>
          )}
        </div>
        
        {/* Informações */}
        <div>
          <Badge variant="outline" className="mb-2">
            Código: {product.code}
          </Badge>
          
          <h1 className="text-3xl font-bold mb-2">{product.name}</h1>
          
          {product.manufacturer && (
            <div className="mb-2">
              <Badge variant="secondary" className="text-primary-700 bg-primary-50">
                Fabricante: {product.manufacturer}
              </Badge>
            </div>
          )}
          
          {product.location && (
            <div className="mb-3">
              <Badge variant="outline" className="text-gray-600 bg-gray-50">
                Localização: {product.location}
              </Badge>
            </div>
          )}
          
          <div className="text-2xl font-bold text-primary mb-1">
            {formatPrice(product.price)}
          </div>
          
          <p className="text-sm text-muted-foreground mb-6">
            ou 10x de {formatPrice(product.price / 10)} sem juros
          </p>
          
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Descrição</h3>
            <p className="text-muted-foreground">{product.description || "Sem descrição disponível"}</p>
          </div>
          
          {/* Informação de estoque */}
          {product.stock !== undefined && product.stock !== null && (
            <div className="mb-6">
              <h3 className="font-semibold mb-2">Disponibilidade</h3>
              <div className="flex items-center gap-2">
                <Badge 
                  variant={Number(product.stock) > 0 ? "outline" : "destructive"}
                  className={Number(product.stock) > 0 ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800"}
                >
                  {Number(product.stock) > 0 ? "Em estoque" : "Indisponível"}
                </Badge>
                {Number(product.stock) > 0 && (
                  <span className="text-sm text-gray-500">
                    {product.stock} unidades disponíveis
                  </span>
                )}
              </div>
            </div>
          )}
          
          {product.colors && product.colors.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold mb-2">Cores disponíveis</h3>
              <div className="flex gap-2">
                {product.colors.map((color) => (
                  <button
                    key={color}
                    className={`h-8 w-8 rounded-full ${getColorClass(color)} border ${
                      selectedColor === color 
                        ? 'ring-2 ring-primary ring-offset-2' 
                        : 'border-gray-300'
                    }`}
                    title={getColorName(color)}
                    onClick={() => setSelectedColor(color)}
                  />
                ))}
              </div>
              {selectedColor && (
                <p className="text-sm mt-2">Cor selecionada: {getColorName(selectedColor)}</p>
              )}
            </div>
          )}
          
          <div className="flex flex-col gap-4 mt-8">
            <Button 
              size="lg" 
              className="w-full"
              onClick={handleAddToQuote}
            >
              <ShoppingCart className="mr-2 h-5 w-5" />
              Adicionar ao orçamento
            </Button>
          </div>
        </div>
      </div>
      
      <Separator className="my-12" />
      
      {/* Especificações */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Especificações</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-4">
                <Ruler className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Dimensões</h3>
              </div>
              
              <ul className="space-y-2 text-sm">
                {product.sizes && product.sizes.map((size, index) => (
                  <li key={index} className="flex justify-between">
                    <span className="text-muted-foreground">{size.label || `Tamanho ${index + 1}`}</span>
                    <span>{`${size.width || 'N/A'} x ${size.height || 'N/A'} x ${size.depth || 'N/A'} cm`}</span>
                  </li>
                ))}
                {(!product.sizes || product.sizes.length === 0) && (
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Dimensões</span>
                    <span>Não disponíveis</span>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-4">
                <Palette className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Materiais</h3>
              </div>
              
              {product.materials && product.materials.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {product.materials.map((material, index) => (
                    <li key={index} className="flex justify-between">
                      <span className="text-muted-foreground">{`Material ${index + 1}`}</span>
                      <span>{material}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Informação de materiais não disponível</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Informações adicionais */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Informações adicionais</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <Package className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Embalagem</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Consulte nosso atendimento para informações detalhadas sobre embalagem e entrega.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Garantia</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Este produto possui garantia de fábrica. Verifique os termos e condições.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}