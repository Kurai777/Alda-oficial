import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface MoodboardProduct {
  id: number;
  name: string;
  code: string;
  price: number;
  imageUrl: string;
}

interface MoodboardPreviewProps {
  title: string;
  clientName?: string;
  architectName?: string;
  date: Date;
  mainImage?: string;
  products: MoodboardProduct[];
  onExport?: () => void;
}

export default function MoodboardPreview({
  title,
  clientName,
  architectName,
  date,
  mainImage = "https://images.unsplash.com/photo-1600210492493-0946911123ea?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1074&q=80",
  products,
  onExport
}: MoodboardPreviewProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(price / 100);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

  const getRelativeTime = (date: Date) => {
    return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button 
            variant="ghost"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            onClick={onExport}
          >
            Exportar PDF <Download className="ml-1 h-4 w-4" />
          </Button>
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-100 p-3 flex justify-between items-center border-b">
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="text-xs text-gray-500">
                {clientName && `Cliente: ${clientName}`}
                {clientName && architectName && " • "}
                {architectName && `Arquiteto: ${architectName}`}
              </p>
            </div>
            <div className="text-xs text-gray-500 flex flex-col items-end">
              <span>{formatDate(date)}</span>
              <span className="text-xs opacity-75">{getRelativeTime(date)}</span>
            </div>
          </div>
          
          <div className="p-4">
            <div className="grid grid-cols-12 gap-4">
              {/* Main Image */}
              <div className="col-span-12 sm:col-span-8">
                <div className="rounded-lg overflow-hidden shadow-sm h-64 sm:h-72 md:h-80">
                  <img 
                    src={mainImage} 
                    alt={title} 
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              
              {/* Featured Products */}
              <div className="col-span-12 sm:col-span-4 grid grid-cols-2 sm:grid-cols-1 gap-4">
                {products.slice(0, 2).map((product) => (
                  <div key={product.id} className="rounded-lg overflow-hidden shadow-sm">
                    <img 
                      src={product.imageUrl} 
                      alt={product.name} 
                      className="w-full h-32 object-cover"
                      onError={(e) => {
                        // Fallback image if the product image fails to load
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x150?text=Sem+Imagem';
                      }}
                    />
                    <div className="p-2 bg-white">
                      <h4 className="text-xs font-medium">{product.name}</h4>
                      <p className="text-xs text-gray-500">{product.code} • {formatPrice(product.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Additional Products */}
              <div className="col-span-12 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {products.slice(2).map((product) => (
                  <div key={product.id} className="rounded-lg overflow-hidden shadow-sm">
                    <img 
                      src={product.imageUrl} 
                      alt={product.name} 
                      className="w-full h-32 object-cover"
                      onError={(e) => {
                        // Fallback image if the product image fails to load
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x150?text=Sem+Imagem';
                      }}
                    />
                    <div className="p-2 bg-white">
                      <h4 className="text-xs font-medium">{product.name}</h4>
                      <p className="text-xs text-gray-500">{product.code} • {formatPrice(product.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
