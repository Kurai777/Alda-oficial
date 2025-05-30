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
import ImageWithVerification from "@/components/catalog/ImageWithVerification";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Product, ProductVariation, Catalog } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function ProductDetailPage() {
  const { productId } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedColor, setSelectedColor] = useState<string>("");

  // Estados para variações e classes de preço
  const [productVariations, setProductVariations] = useState<ProductVariation[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<string | number | null>(null);
  const [isLoadingVariations, setIsLoadingVariations] = useState<boolean>(false);
  const [variationError, setVariationError] = useState<string | null>(null);
  const [selectedPriceClassName, setSelectedPriceClassName] = useState<string | null>(null);
  const [catalogClassDefinitions, setCatalogClassDefinitions] = useState<Array<{ className: string; definition: Record<string, string>; }> | null>(null);
  
  // Novos estados para opções dinâmicas da classe selecionada
  const [currentClassOptions, setCurrentClassOptions] = useState<string[]>([]);
  const [selectedClassOption, setSelectedClassOption] = useState<string | null>(null);

  // Buscar produto por ID
  const { data: product, isLoading, error } = useQuery<Product>({
    queryKey: [`/api/products/${productId}`],
    enabled: !!productId,
  });

  // Efeito para buscar variações do produto
  useEffect(() => {
    if (productId) {
      const fetchVariations = async () => {
        setIsLoadingVariations(true);
        setVariationError(null);
        setSelectedPriceClassName(null);
        try {
          const response = await fetch(`/api/products/${productId}/variations`);
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Erro ao buscar variações: ${response.statusText}`);
          }
          const data: ProductVariation[] = await response.json();
          setProductVariations(data);
          if (data && data.length > 0) {
            const firstVariation = data[0];
            setSelectedVariationId(firstVariation.id);
            if (firstVariation.priceClasses && firstVariation.priceClasses.length > 0) {
              setSelectedPriceClassName(firstVariation.priceClasses[0].className);
            }
          } else {
            setSelectedVariationId(null); // Nenhuma variação, então nenhuma classe selecionada
          }
        } catch (error: any) {
          console.error("Erro ao buscar variações do produto (detalhe):", error);
          setVariationError(error.message || "Não foi possível carregar as variações.");
          setProductVariations([]);
        } finally {
          setIsLoadingVariations(false);
        }
      };
      fetchVariations();
    }
  }, [productId]);

  // Efeito para buscar definições de classe do catálogo quando o produto (e seu catalogId) estiver carregado
  useEffect(() => {
    if (product && product.catalogId) {
      const fetchCatalogDefinitions = async () => {
        try {
          const response = await fetch(`/api/catalogs/${product.catalogId}`);
          if (!response.ok) {
            console.warn(`Não foi possível buscar definições de classe para o catálogo ${product.catalogId} (detalhe): ${response.statusText}`);
            setCatalogClassDefinitions(null);
            return;
          }
          const catalogData: Catalog = await response.json();
          if (catalogData && catalogData.classDefinitions) {
            setCatalogClassDefinitions(catalogData.classDefinitions);
          } else {
            setCatalogClassDefinitions(null);
          }
        } catch (error) {
          console.warn(`Erro ao buscar definições de classe para o catálogo ${product.catalogId} (detalhe):`, error);
          setCatalogClassDefinitions(null);
        }
      };
      fetchCatalogDefinitions();
    } else if (!product) { // Se o produto for null (ex: erro ao buscar produto principal)
        setCatalogClassDefinitions(null);
    }
  }, [product]); // Depende do objeto product (que contém catalogId)

   // Efeito para atualizar a classe de preço selecionada quando a variação muda (similar ao ProductCard)
   useEffect(() => {
    if (selectedVariationId && productVariations.length > 0) {
      const currentSelectedVariation = productVariations.find(v => v.id === Number(selectedVariationId));
      if (currentSelectedVariation && currentSelectedVariation.priceClasses && currentSelectedVariation.priceClasses.length > 0) {
        const currentClassStillExists = currentSelectedVariation.priceClasses.some(pc => pc.className === selectedPriceClassName);
        if (!selectedPriceClassName || !currentClassStillExists) {
          setSelectedPriceClassName(currentSelectedVariation.priceClasses[0].className);
        }
      } else {
        setSelectedPriceClassName(null);
      }
    } else if (productVariations.length === 0) {
        setSelectedPriceClassName(null);
    }
  }, [selectedVariationId, productVariations, selectedPriceClassName]);

  // Efeito para popular currentClassOptions e definir a primeira como selecionada
  useEffect(() => {
    if (selectedPriceClassName && catalogClassDefinitions) {
      const activeClassDef = catalogClassDefinitions.find(def => def.className === selectedPriceClassName);
      if (activeClassDef && activeClassDef.definition) {
        const options = Object.values(activeClassDef.definition); // Pega só os valores (ex: "AMARELO", "AREIA")
        setCurrentClassOptions(options);
        if (options.length > 0) {
          // Se a opção atualmente selecionada não estiver nas novas opções, ou nenhuma estiver selecionada,
          // selecionar a primeira nova opção.
          if (!selectedClassOption || !options.includes(selectedClassOption)) {
            setSelectedClassOption(options[0]);
          }
        } else {
          setSelectedClassOption(null);
        }
      } else {
        setCurrentClassOptions([]);
        setSelectedClassOption(null);
      }
    } else {
      setCurrentClassOptions([]);
      setSelectedClassOption(null);
    }
  }, [selectedPriceClassName, catalogClassDefinitions, selectedClassOption]); // Adicionado selectedClassOption para reavaliar se ele ainda é válido

  // Funções de formatação
  const formatPrice = (priceInCents: number | undefined | null) => {
    if (priceInCents === undefined || priceInCents === null) return "Sob consulta";
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(priceInCents / 100);
  };

  const formatInstallments = (priceInCents: number | undefined | null) => {
    if (priceInCents === undefined || priceInCents === null) return formatPrice(priceInCents);
    const installmentValueInReais = (priceInCents / 10) / 100;
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(installmentValueInReais);
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
      description: `${product?.name} ${selectedVariationId ? `(Variação ID: ${selectedVariationId})` : ''} ${selectedPriceClassName ? `(Classe: ${selectedPriceClassName})` : ''} ${selectedClassOption ? `(Opção: ${selectedClassOption})` : ''} foi adicionado ao orçamento`,
    });
  };

  // Lógica para obter o preço da variação selecionada ou o preço base em CENTAVOS
  const getDisplayPrice = () => { // Deve retornar CENTAVOS
    if (selectedVariationId && productVariations.length > 0) {
      const selectedVar = productVariations.find(v => v.id === Number(selectedVariationId));
      if (selectedVar && selectedVar.priceClasses && selectedVar.priceClasses.length > 0) {
        if (selectedPriceClassName) {
          const priceInfo = selectedVar.priceClasses.find(pc => pc.className === selectedPriceClassName);
          if (priceInfo && typeof priceInfo.value === 'number') {
            return priceInfo.value; // CENTAVOS
          }
        }
        // Fallback para o primeiro preço da variação
        const firstPriceInfo = selectedVar.priceClasses[0];
        if (firstPriceInfo && typeof firstPriceInfo.value === 'number') {
          return firstPriceInfo.value; // CENTAVOS
        }
      }
    }
    return product?.price; // product.price do banco deve ser CENTAVOS
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
            altText={product.name}
            className="h-full w-full object-cover"
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
            {formatPrice(getDisplayPrice())}
          </div>
          
          <p className="text-sm text-muted-foreground mb-6">
            ou 10x de {formatInstallments(getDisplayPrice())} sem juros
          </p>
          
          {/* Dropdown de Variações */}
          {isLoadingVariations && (
            <div className="flex items-center text-sm text-muted-foreground my-2">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Carregando opções...
            </div>
          )}
          {variationError && <p className="text-sm text-red-500 my-2">{variationError}</p>}
          {!isLoadingVariations && !variationError && productVariations && productVariations.length > 0 && (
            <div className="my-4">
              <label htmlFor={`variation-select-${product.id}`} className="block text-sm font-medium text-gray-700 mb-1">Opção:</label>
              <select
                id={`variation-select-${product.id}`}
                value={selectedVariationId || ''}
                onChange={(e) => setSelectedVariationId(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
              >
                {productVariations.map((variation) => (
                  <option key={variation.id} value={variation.id}>
                    {variation.name} 
                    {variation.dimensionsLabel ? ` (${variation.dimensionsLabel})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dropdown de Classes de Preço */}
          {selectedVariationId && 
           productVariations.find(v => v.id === Number(selectedVariationId))?.priceClasses && 
           (productVariations.find(v => v.id === Number(selectedVariationId))?.priceClasses?.length || 0) > 0 && (
            <div className="my-4">
              <label htmlFor={`price-class-select-detail-${product.id}`} className="block text-sm font-medium text-gray-700 mb-1">Acabamento/Classe:</label>
              <select
                id={`price-class-select-detail-${product.id}`}
                value={selectedPriceClassName || ''}
                onChange={(e) => setSelectedPriceClassName(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary focus:border-primary"
              >
                {productVariations.find(v => v.id === Number(selectedVariationId))?.priceClasses?.map((pc) => {
                  let optionText = pc.className;
                  let optionTitle = pc.className; // Fallback para o title
                  if (catalogClassDefinitions) {
                    const definition = catalogClassDefinitions.find(def => def.className === pc.className);
                    if (definition && definition.definition) {
                      const defEntries = Object.entries(definition.definition);
                      // Mostrar apenas os valores das 2 primeiras entradas da definição no texto da opção
                      const defDetailsShort = defEntries.slice(0, 2).map(([, val]) => `${val}`).join(", ");
                      // Mostrar todas as chaves e valores no tooltip
                      const defDetailsFull = defEntries.map(([key, val]) => `${key}: ${val}`).join(", ");

                      if (defDetailsShort) {
                        optionText = `${pc.className} (${defDetailsShort}${defEntries.length > 2 ? ', ...' : ''})`;
                        optionTitle = `${pc.className} - Detalhes: ${defDetailsFull}`;
                      } else {
                        // Caso não haja defDetailsShort (ex: definition é um objeto vazio), o title ainda pode ser útil se houver className
                        optionTitle = pc.className;
                      }
                    } else {
                       // Caso definition não seja encontrada ou pc.className não esteja em catalogClassDefinitions
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
          
          {/* SELETORES DINÂMICOS DE COR/OPÇÃO BASEADOS NA CLASSE */}
          {currentClassOptions.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold mb-2">{Object.keys(catalogClassDefinitions?.find(def => def.className === selectedPriceClassName)?.definition || {})[0] || 'Opções'}:</h3>
              <div className="flex flex-wrap gap-2">
                {currentClassOptions.map((optionValue) => (
                  <button
                    key={optionValue}
                    className={`h-8 w-8 rounded-full border flex items-center justify-center 
                               ${getColorClass(optionValue)} 
                               ${selectedClassOption === optionValue 
                                 ? 'ring-2 ring-primary ring-offset-2' 
                                 : 'border-gray-300'}`}
                    title={getColorName(optionValue)} // Tooltip com o nome da cor/opção
                    onClick={() => setSelectedClassOption(optionValue)}
                  >
                    {/* Opcional: Adicionar um checkmark ou mudar a borda se for selecionado e não for uma cor visual */} 
                    {/* {!getColorClass(optionValue).startsWith('bg-') && optionValue.substring(0,1)} Breve texto se não for cor */} 
                  </button>
                ))}
              </div>
              {selectedClassOption && (
                <p className="text-sm mt-2">Selecionado: {getColorName(selectedClassOption)}</p>
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