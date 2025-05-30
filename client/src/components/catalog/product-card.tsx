import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlusCircle, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Product, ProductVariation } from "@shared/schema";
import { Link } from "wouter";
import ImageWithVerification from "./ImageWithVerification";

interface ProductCardProps {
  product: Product;
  onAddToQuote?: (product: Product, color: string, variationId?: number) => void;
}

export default function ProductCard({ product, onAddToQuote }: ProductCardProps) {
  const [selectedColor, setSelectedColor] = useState<string>(
    product.colors && product.colors.length > 0 ? product.colors[0] : ''
  );
  const { toast } = useToast();

  // Estados para variações
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<string | number | null>(null);
  const [isLoadingVariations, setIsLoadingVariations] = useState<boolean>(false);
  const [variationError, setVariationError] = useState<string | null>(null);
  const [selectedPriceClassName, setSelectedPriceClassName] = useState<string | null>(null);
  const [catalogClassDefinitions, setCatalogClassDefinitions] = useState<Array<{ className: string; definition: Record<string, string>; }> | null>(null);

  useEffect(() => {
    if (product && product.id) {
      const fetchVariations = async () => {
        setIsLoadingVariations(true);
        setVariationError(null);
        setSelectedPriceClassName(null);
        try {
          const response = await fetch(`/api/products/${product.id}/variations`);
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erro ao buscar variações: ${response.statusText}`);
          }
          const data: ProductVariation[] = await response.json();
          setVariations(data);
          if (data && data.length > 0) {
            const firstVariation = data[0];
            setSelectedVariationId(firstVariation.id);
            if (firstVariation.priceClasses && firstVariation.priceClasses.length > 0) {
              setSelectedPriceClassName(firstVariation.priceClasses[0].className);
            } else {
              setSelectedPriceClassName(null);
            }
          } else {
            setSelectedVariationId(null);
            setSelectedPriceClassName(null);
          }
        } catch (error: any) {
          console.error("Erro ao buscar variações do produto:", error);
          setVariationError(error.message || "Não foi possível carregar as variações.");
          setVariations([]);
          setSelectedVariationId(null);
          setSelectedPriceClassName(null);
        } finally {
          setIsLoadingVariations(false);
        }
      };
      fetchVariations();
    }
  }, [product, product.id]);

  useEffect(() => {
    if (selectedVariationId && variations.length > 0) {
      const currentSelectedVariation = variations.find(v => v.id === Number(selectedVariationId));
      if (currentSelectedVariation && currentSelectedVariation.priceClasses && currentSelectedVariation.priceClasses.length > 0) {
        const currentClassStillExists = currentSelectedVariation.priceClasses.some(pc => pc.className === selectedPriceClassName);
        if (!selectedPriceClassName || !currentClassStillExists) {
          setSelectedPriceClassName(currentSelectedVariation.priceClasses[0].className);
        }
      } else {
        setSelectedPriceClassName(null);
      }
    } else if (variations.length === 0) {
      setSelectedPriceClassName(null);
    }
  }, [selectedVariationId, variations, selectedPriceClassName]);

  // Efeito para buscar as definições de classe do catálogo
  useEffect(() => {
    if (product && product.catalogId) {
      const fetchCatalogDefinitions = async () => {
        try {
          const response = await fetch(`/api/catalogs/${product.catalogId}`); // Assume que esta rota retorna o catálogo
          if (!response.ok) {
            // Não tratar como erro fatal aqui, o card pode funcionar sem as definições detalhadas
            console.warn(`Não foi possível buscar definições de classe para o catálogo ${product.catalogId}: ${response.statusText}`);
            setCatalogClassDefinitions(null);
            return;
          }
          const catalogData: Catalog = await response.json(); // Catalog deve ter classDefinitions
          if (catalogData && catalogData.classDefinitions) {
            setCatalogClassDefinitions(catalogData.classDefinitions);
          } else {
            setCatalogClassDefinitions(null);
          }
        } catch (error) {
          console.warn(`Erro ao buscar definições de classe para o catálogo ${product.catalogId}:`, error);
          setCatalogClassDefinitions(null);
        }
      };
      fetchCatalogDefinitions();
    } else {
      setCatalogClassDefinitions(null); // Resetar se não houver catalogId
    }
  }, [product, product.catalogId]); // Depende do product.catalogId

  const handleAddToQuote = () => {
    if (onAddToQuote) {
      onAddToQuote(product, selectedColor, selectedVariationId ? Number(selectedVariationId) : undefined);
    } else {
      toast({
        title: "Produto adicionado",
        description: `${product.name} ${selectedVariationId ? ` (variação ID: ${selectedVariationId})` : ''} foi adicionado ao orçamento`,
      });
    }
  };

  // Formatting functions
  const formatPrice = (priceInCents: number | undefined | null) => {
    if (priceInCents === undefined || priceInCents === null) return "Sob consulta";
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(priceInCents / 100); // Dividir centavos por 100
  };

  const formatInstallments = (priceInCents: number | undefined | null) => {
    if (priceInCents === undefined || priceInCents === null) return formatPrice(priceInCents); 
    const installmentValueInReais = (priceInCents / 10) / 100; // Parcela em Reais
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(installmentValueInReais);
  };

  // Lógica para obter o preço da variação selecionada ou o preço base em CENTAVOS
  const currentPrice = () => { // Deve retornar CENTAVOS
    if (selectedVariationId && variations.length > 0) {
      const selectedVar = variations.find(v => v.id === Number(selectedVariationId));
      if (selectedVar && selectedVar.priceClasses && selectedVar.priceClasses.length > 0) {
        if (selectedPriceClassName) {
          const priceInfo = selectedVar.priceClasses.find(pc => pc.className === selectedPriceClassName);
          if (priceInfo && typeof priceInfo.value === 'number') {
            return priceInfo.value; // Retorna valor em CENTAVOS da classe de preço selecionada
          }
        }
        const firstPriceInfo = selectedVar.priceClasses[0];
        if (firstPriceInfo && typeof firstPriceInfo.value === 'number') {
          return firstPriceInfo.value; // Retorna valor em CENTAVOS
        }
      }
    }
    return product.price; // Fallback para o preço do produto principal (que deve ser CENTAVOS)
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
            {/* Adicionar verificação prévia de imagem para resolver problema de associação */}
            <ImageWithVerification 
              productId={product.id} 
              imageUrl={product.imageUrl || undefined}
              altText={product.name || "Produto"}
              className="h-full w-full object-cover"
            />
          </div>
          <Badge variant="outline" className="absolute top-2 right-2 bg-white px-2 py-1 rounded-full text-xs font-medium text-primary-600">
            Cod: {product.code}
          </Badge>
        </div>
      </Link>
      <CardContent className="p-4">
        <Link href={`/product/${product.id}`}>
          <h3 className="text-sm font-medium text-gray-900 mb-1 hover:text-primary cursor-pointer line-clamp-1">{product.name}</h3>
        </Link>

        {/* Dropdown de Variações */}
        {isLoadingVariations && (
          <div className="flex items-center text-xs text-muted-foreground my-1">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            Carregando variações...
          </div>
        )}
        {variationError && <p className="text-xs text-red-500 my-1">{variationError}</p>}
        {!isLoadingVariations && !variationError && variations && variations.length > 0 && (
          <div className="my-2">
            <select
              value={selectedVariationId || ''}
              onChange={(e) => {
                setSelectedVariationId(e.target.value);
              }}
              className="w-full p-1.5 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-primary focus:border-primary"
            >
              {variations.map((variation) => (
                <option key={variation.id} value={variation.id}>
                  {variation.name} 
                  {variation.dimensionsLabel ? ` (${variation.dimensionsLabel})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Dropdown de Classes de Preço (aparece se a variação selecionada tiver classes) */}
        {selectedVariationId && variations.find(v => v.id === Number(selectedVariationId))?.priceClasses && (variations.find(v => v.id === Number(selectedVariationId))?.priceClasses?.length || 0) > 0 && (
          <div className="my-2">
            <label htmlFor={`price-class-select-${product.id}`} className="text-xs text-muted-foreground mb-1 block">Classe de Preço:</label>
            <select
              id={`price-class-select-${product.id}`}
              value={selectedPriceClassName || ''}
              onChange={(e) => setSelectedPriceClassName(e.target.value)}
              className="w-full p-1.5 border border-gray-300 rounded-md text-xs focus:ring-1 focus:ring-primary focus:border-primary"
            >
              {variations.find(v => v.id === Number(selectedVariationId))?.priceClasses?.map((pc) => {
                let optionText = pc.className;
                let optionTitle = pc.className; // Fallback para o title
                if (catalogClassDefinitions) {
                  const definition = catalogClassDefinitions.find(def => def.className === pc.className);
                  if (definition && definition.definition) {
                    const defEntries = Object.entries(definition.definition);
                    const defDetailsShort = defEntries.slice(0, 2).map(([key, val]) => `${val}`).join(", ");
                    const defDetailsFull = defEntries.map(([key, val]) => `${key}: ${val}`).join(", ");
                    
                    if (defDetailsShort) {
                      optionText = `${pc.className} (${defDetailsShort}${defEntries.length > 2 ? ', ...' : ''})`;
                      optionTitle = `${pc.className} - Detalhes: ${defDetailsFull}`;
                    } else {
                      optionTitle = pc.className;
                    }
                  } else {
                    optionTitle = pc.className;
                  }
                }
                return (
                  <option key={pc.className} value={pc.className} title={optionTitle}>
                    {optionText}
                  </option>
                );
              })}
            </select>
          </div>
        )}

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
              {formatPrice(currentPrice())}
            </p>
            <p className="text-xs text-gray-500">
              ou 10x de {formatInstallments(currentPrice())}
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
