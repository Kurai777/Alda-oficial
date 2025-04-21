import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";

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

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    // Set initial position
    let yPos = 20;
    const margin = 20;
    const rightMargin = 190;
    
    // Add company header
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("ALD-A Móveis", margin, yPos);
    yPos += 10;
    
    // Add date
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Data: ${formatDate(date)}`, rightMargin, yPos, { align: 'right' });
    yPos += 15;
    
    // Add moodboard title
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("MOODBOARD", margin, yPos);
    yPos += 8;
    
    doc.setFontSize(14);
    doc.text(title, margin, yPos);
    yPos += 15;
    
    // Add client information
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("INFORMAÇÕES DO PROJETO", margin, yPos);
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    if (clientName) {
      doc.text(`Cliente: ${clientName}`, margin, yPos);
      yPos += 6;
    }
    
    if (architectName) {
      doc.text(`Arquiteto: ${architectName}`, margin, yPos);
      yPos += 6;
    }
    
    doc.text(`Data de criação: ${formatDate(date)}`, margin, yPos);
    yPos += 15;
    
    // Products header
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("PRODUTOS INCLUÍDOS", margin, yPos);
    yPos += 8;
    
    // Table headers
    doc.setFontSize(10);
    doc.text("Código", margin, yPos);
    doc.text("Produto", margin + 30, yPos);
    doc.text("Preço", rightMargin, yPos, { align: 'right' });
    yPos += 2;
    
    // Add a separator line
    doc.line(margin, yPos, rightMargin, yPos);
    yPos += 6;
    
    // List products
    doc.setFont("helvetica", "normal");
    products.forEach((product) => {
      // Check if we need a new page
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.text(product.code, margin, yPos);
      doc.text(product.name, margin + 30, yPos);
      doc.text(formatPrice(product.price), rightMargin, yPos, { align: 'right' });
      yPos += 6;
    });
    
    // Add a separator line
    yPos += 2;
    doc.line(margin, yPos, rightMargin, yPos);
    yPos += 8;
    
    // Add total
    const totalPrice = products.reduce((sum, product) => sum + product.price, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Total:", margin + 100, yPos);
    doc.text(formatPrice(totalPrice), rightMargin, yPos, { align: 'right' });
    
    // Add footer
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.text("Moodboard gerado por ALD-A Móveis.", margin, 280);
    
    // Save the document
    doc.save(`Moodboard_${title.replace(/\s+/g, '_')}_${date.toISOString().split('T')[0]}.pdf`);
    
    // Call provided onExport callback if available
    if (onExport) {
      onExport();
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button 
            variant="ghost"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            onClick={handleExportPDF}
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
