import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { X, FileText, PaintBucket, Image } from "lucide-react";
import { Product } from "@shared/schema";
import { useQueryClient } from "@tanstack/react-query";
import jsPDF from "jspdf";

interface QuoteItem {
  product: Product;
  color: string;
  size?: string;
}

interface QuoteGeneratorProps {
  items?: QuoteItem[];
  onClearItems?: () => void;
}

export default function QuoteGenerator({ items = [], onClearItems }: QuoteGeneratorProps) {
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>(items);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [architectName, setArchitectName] = useState("");
  const [notes, setNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isMoodboardGenerating, setIsMoodboardGenerating] = useState(false);
  const [isRenderGenerating, setIsRenderGenerating] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Update quote items when items prop changes
  useEffect(() => {
    setQuoteItems(items);
  }, [items]);

  const handleRemoveItem = (index: number) => {
    const newItems = [...quoteItems];
    newItems.splice(index, 1);
    setQuoteItems(newItems);
  };

  const getTotalPrice = () => {
    return quoteItems.reduce((total, item) => total + item.product.price, 0);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(price / 100);
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

  const generatePDF = (quoteData: any) => {
    // Create a new PDF document
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
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, rightMargin, yPos, { align: 'right' });
    yPos += 15;
    
    // Add quote title
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("ORÇAMENTO", margin, yPos);
    yPos += 15;
    
    // Add client information
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("DADOS DO CLIENTE", margin, yPos);
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Nome: ${quoteData.clientName}`, margin, yPos);
    yPos += 6;
    
    if (quoteData.clientEmail) {
      doc.text(`E-mail: ${quoteData.clientEmail}`, margin, yPos);
      yPos += 6;
    }
    
    if (quoteData.clientPhone) {
      doc.text(`Telefone: ${quoteData.clientPhone}`, margin, yPos);
      yPos += 6;
    }
    
    if (quoteData.architectName) {
      doc.text(`Arquiteto: ${quoteData.architectName}`, margin, yPos);
      yPos += 6;
    }
    
    yPos += 10;
    
    // Add items header
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("ITENS", margin, yPos);
    yPos += 8;
    
    // Add table headers
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Código", margin, yPos);
    doc.text("Produto", margin + 30, yPos);
    doc.text("Cor", margin + 100, yPos);
    doc.text("Preço", rightMargin, yPos, { align: 'right' });
    yPos += 2;
    
    // Add a separator line
    doc.line(margin, yPos, rightMargin, yPos);
    yPos += 6;
    
    // List items
    doc.setFont("helvetica", "normal");
    quoteData.items.forEach((item: any) => {
      // Check if we need a new page
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.text(item.productCode, margin, yPos);
      doc.text(item.productName, margin + 30, yPos);
      doc.text(getColorName(item.color), margin + 100, yPos);
      doc.text(formatPrice(item.price), rightMargin, yPos, { align: 'right' });
      yPos += 6;
    });
    
    // Add a separator line
    yPos += 2;
    doc.line(margin, yPos, rightMargin, yPos);
    yPos += 8;
    
    // Add total
    doc.setFont("helvetica", "bold");
    doc.text("Total:", margin + 100, yPos);
    doc.text(formatPrice(quoteData.totalPrice), rightMargin, yPos, { align: 'right' });
    yPos += 15;
    
    // Add notes if there are any
    if (quoteData.notes) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("OBSERVAÇÕES", margin, yPos);
      yPos += 8;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      
      // Split long text into multiple lines
      const splitNotes = doc.splitTextToSize(quoteData.notes, rightMargin - margin);
      doc.text(splitNotes, margin, yPos);
      yPos += splitNotes.length * 6 + 10;
    }
    
    // Add footer
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.text("Este orçamento é válido por 30 dias.", margin, 280);
    
    // Return the PDF document
    return doc;
  };

  const handleGenerateQuote = async () => {
    if (!user) return;
    
    if (quoteItems.length === 0) {
      toast({
        title: "Nenhum item selecionado",
        description: "Adicione pelo menos um produto ao orçamento.",
        variant: "destructive",
      });
      return;
    }
    
    if (!clientName) {
      toast({
        title: "Nome do cliente obrigatório",
        description: "Informe o nome do cliente para gerar o orçamento.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      setIsGenerating(true);
      
      // Prepare quote data
      const quoteData = {
        userId: user.id,
        clientName,
        clientEmail,
        clientPhone,
        architectName,
        notes,
        items: quoteItems.map(item => ({
          productId: item.product.id,
          productName: item.product.name,
          productCode: item.product.code,
          color: item.color,
          size: item.size || "",
          price: item.product.price
        })),
        totalPrice: getTotalPrice(),
      };
      
      // Generate PDF
      const pdf = generatePDF(quoteData);
      
      // Save PDF
      pdf.save(`Orcamento_${clientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
      
      // Create quote in database
      await apiRequest("POST", "/api/quotes", quoteData);
      
      // Invalidate quotes query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      
      toast({
        title: "Orçamento gerado com sucesso",
        description: "O orçamento foi criado e está sendo baixado.",
      });
      
      // Clear form (but keep client info)
      if (onClearItems) {
        onClearItems();
      } else {
        setQuoteItems([]);
      }
      setNotes("");
      
    } catch (error) {
      console.error("Quote generation failed:", error);
      toast({
        title: "Falha ao gerar orçamento",
        description: "Ocorreu um erro ao gerar o orçamento.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateMoodboard = async () => {
    if (!user) return;
    
    if (quoteItems.length === 0) {
      toast({
        title: "Nenhum item selecionado",
        description: "Adicione pelo menos um produto para gerar o moodboard.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      setIsMoodboardGenerating(true);
      
      // In a real implementation, we would use the selected products to generate a moodboard
      // with a proper design and layout
      
      // For this demo, simulate moodboard generation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Create moodboard entry in database
      await apiRequest("POST", "/api/moodboards", {
        userId: user.id,
        projectName: `Projeto para ${clientName || "Cliente"}`,
        clientName,
        architectName,
        productIds: quoteItems.map(item => item.product.id),
      });
      
      // Invalidate moodboards query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/moodboards"] });
      
      toast({
        title: "Moodboard gerado com sucesso",
        description: "O moodboard foi criado e está disponível na aba Moodboards.",
      });
      
    } catch (error) {
      console.error("Moodboard generation failed:", error);
      toast({
        title: "Falha ao gerar moodboard",
        description: "Ocorreu um erro ao gerar o moodboard.",
        variant: "destructive",
      });
    } finally {
      setIsMoodboardGenerating(false);
    }
  };

  const handleGenerateRender = async () => {
    if (!user) return;
    
    if (quoteItems.length === 0) {
      toast({
        title: "Nenhum item selecionado",
        description: "Adicione pelo menos um produto para gerar o render.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      setIsRenderGenerating(true);
      
      // In a real implementation, we would use AI (like DALL-E) to generate a render
      // with the selected products
      
      // For this demo, simulate render generation
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      toast({
        title: "Render gerado com sucesso",
        description: "O render foi criado e está disponível para visualização.",
      });
      
    } catch (error) {
      console.error("Render generation failed:", error);
      toast({
        title: "Falha ao gerar render",
        description: "Ocorreu um erro ao gerar o render com IA.",
        variant: "destructive",
      });
    } finally {
      setIsRenderGenerating(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-xl font-semibold mb-4">Gerador de Orçamentos</h2>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-2/3">
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-sm mb-3 text-gray-700">
                Itens Selecionados ({quoteItems.length})
              </h3>
              
              {quoteItems.length > 0 ? (
                <div className="space-y-4">
                  {quoteItems.map((item, index) => (
                    <div key={`${item.product.id}-${index}`} className="flex gap-4 pb-4 border-b border-gray-100">
                      <img 
                        src={item.product.imageUrl} 
                        alt={item.product.name} 
                        className="w-16 h-16 object-cover rounded-md"
                        onError={(e) => {
                          // Fallback image if the product image fails to load
                          (e.target as HTMLImageElement).src = 'https://via.placeholder.com/64?text=Sem+Imagem';
                        }}
                      />
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <div>
                            <h4 className="text-sm font-medium">{item.product.name}</h4>
                            <p className="text-xs text-gray-500">Cod: {item.product.code}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-gray-400 hover:text-red-500"
                            onClick={() => handleRemoveItem(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center">
                            <Label className="text-xs text-gray-500 mr-2">Cor:</Label>
                            <div 
                              className="h-4 w-4 rounded-full border border-gray-300 focus:outline-none"
                              style={{ backgroundColor: item.color }}
                              title={getColorName(item.color)}
                            ></div>
                            <span className="ml-1 text-xs">{getColorName(item.color)}</span>
                          </div>
                          <span className="font-medium text-sm">
                            {formatPrice(item.product.price)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center">
                    <span className="text-gray-700 font-medium">Total:</span>
                    <span className="text-lg font-semibold text-gray-900">
                      {formatPrice(getTotalPrice())}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <p>Nenhum item adicionado ao orçamento.</p>
                  <p className="text-sm mt-2">Adicione produtos a partir do catálogo.</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="lg:w-1/3">
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-sm mb-3 text-gray-700">Dados do Cliente</h3>
              
              <div className="space-y-3">
                <div>
                  <Label htmlFor="client-name" className="text-xs text-gray-500 mb-1">Nome do Cliente</Label>
                  <Input 
                    id="client-name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="client-email" className="text-xs text-gray-500 mb-1">E-mail</Label>
                  <Input 
                    id="client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="client-phone" className="text-xs text-gray-500 mb-1">Telefone</Label>
                  <Input 
                    id="client-phone"
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="architect-name" className="text-xs text-gray-500 mb-1">Nome do Arquiteto (opcional)</Label>
                  <Input 
                    id="architect-name"
                    value={architectName}
                    onChange={(e) => setArchitectName(e.target.value)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="notes" className="text-xs text-gray-500 mb-1">Observações</Label>
                  <Textarea 
                    id="notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="mt-5 space-y-3">
                <Button 
                  className="w-full"
                  onClick={handleGenerateQuote}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      Gerando...
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" />
                      Gerar Orçamento em PDF
                    </>
                  )}
                </Button>
                
                <Button 
                  className="w-full bg-secondary-500 hover:bg-green-700"
                  variant="default"
                  onClick={handleGenerateMoodboard}
                  disabled={isMoodboardGenerating}
                >
                  {isMoodboardGenerating ? (
                    <>
                      <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      Gerando...
                    </>
                  ) : (
                    <>
                      <PaintBucket className="mr-2 h-4 w-4" />
                      Gerar Moodboard
                    </>
                  )}
                </Button>
                
                <Button 
                  className="w-full bg-gray-800 hover:bg-gray-900"
                  variant="default"
                  onClick={handleGenerateRender}
                  disabled={isRenderGenerating}
                >
                  {isRenderGenerating ? (
                    <>
                      <div className="animate-spin mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                      Gerando...
                    </>
                  ) : (
                    <>
                      <Image className="mr-2 h-4 w-4" />
                      Gerar Render com IA
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
