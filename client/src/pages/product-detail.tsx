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
  Palette,
  Image as ImageIcon
} from "lucide-react";

// Componente para verificar e exibir imagens com garantia de correspondência
interface ImageWithVerificationProps {
  productId?: number;
  productName: string;
  productCode?: string;
  category?: string;
}

function ImageWithVerification({ productId, productName, productCode, category }: ImageWithVerificationProps) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    if (!productId) {
      setImageUrl("/placeholders/default.svg");
      setIsLoading(false);
      return;
    }

    // Verificar a disponibilidade da imagem
    fetch(`/api/verify-product-image/${productId}`)
      .then(response => response.json())
      .then(data => {
        if (data.hasImage) {
          // Se a API retornar uma URL direta, usar
          if (data.directUrl) {
            setImageUrl(data.imageUrl);
          } else {
            // Caso contrário, usar a rota de API que garante fallback
            setImageUrl(`/api/product-image/${productId}`);
          }
        } else {
          // Se não há imagem, determinar um placeholder baseado na categoria
          let placeholderFile = 'default.svg';
          if (category) {
            const normalizedCategory = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (normalizedCategory.includes('sofa')) placeholderFile = 'sofa.svg';
            else if (normalizedCategory.includes('mesa')) placeholderFile = 'mesa.svg';
            else if (normalizedCategory.includes('poltrona')) placeholderFile = 'poltrona.svg';
            else if (normalizedCategory.includes('armario') || normalizedCategory.includes('estante')) placeholderFile = 'armario.svg';
          }
          setImageUrl(`/placeholders/${placeholderFile}`);
        }
        setIsLoading(false);
      })
      .catch(error => {
        console.error("Erro ao verificar imagem:", error);
        setImageUrl(`/api/product-image/${productId}`); // Usar API diretamente como fallback
        setIsLoading(false);
        setHasError(true);
      });
  }, [productId, category]);

  const handleImageError = () => {
    // Se a imagem falhar ao carregar, usar placeholder
    let placeholderFile = 'default.svg';
    if (category) {
      const normalizedCategory = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalizedCategory.includes('sofa')) placeholderFile = 'sofa.svg';
      else if (normalizedCategory.includes('mesa')) placeholderFile = 'mesa.svg';
      else if (normalizedCategory.includes('poltrona')) placeholderFile = 'poltrona.svg';
      else if (normalizedCategory.includes('armario') || normalizedCategory.includes('estante')) placeholderFile = 'armario.svg';
    }
    setImageUrl(`/placeholders/${placeholderFile}`);
    setHasError(true);
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-100 animate-pulse">
        <ImageIcon className="h-12 w-12 text-gray-300" />
      </div>
    );
  }

  return (
    <img 
      src={imageUrl}
      alt={productName} 
      className="h-full w-full object-cover"
      loading="lazy"
      onError={handleImageError}
    />
  );
};
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
        {/* Imagem - Usar o componente de verificação de imagens para garantir correspondência */}
        <div className="bg-muted rounded-lg overflow-hidden h-[400px] flex items-center justify-center">
          <ImageWithVerification 
            productId={product.id} 
            productName={product.name} 
            productCode={product.code}
            category={product.category}
          />
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