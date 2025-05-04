import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { X, FileText, PaintBucket, Image, Plus, Minus } from "lucide-react";
import { Product } from "@shared/schema";
import { useQueryClient } from "@tanstack/react-query";
import jsPDF from "jspdf";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";

interface QuoteItem {
  product: Product;
  color: string;
  size?: string;
  quantity: number; // Adicionando quantidade para permitir múltiplas unidades do mesmo produto
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
  
  // Estados para condições de pagamento
  const [paymentInstallments, setPaymentInstallments] = useState<string>("à vista");
  const [paymentMethod, setPaymentMethod] = useState<string>("boleto");
  const [applyCashDiscount, setApplyCashDiscount] = useState<boolean>(true);
  
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Update quote items when items prop changes
  useEffect(() => {
    // Garantir que todos os itens tenham uma quantidade definida
    const itemsWithQuantity = items.map(item => ({
      ...item,
      quantity: item.quantity || 1
    }));
    setQuoteItems(itemsWithQuantity);
  }, [items]);

  const handleRemoveItem = (index: number) => {
    const newItems = [...quoteItems];
    newItems.splice(index, 1);
    setQuoteItems(newItems);
  };
  
  const handleUpdateQuantity = (index: number, newQuantity: number) => {
    if (newQuantity < 1) return; // Não permitir quantidades menores que 1
    
    const newItems = [...quoteItems];
    newItems[index] = {
      ...newItems[index],
      quantity: newQuantity
    };
    setQuoteItems(newItems);
  };

  const getTotalPrice = () => {
    return quoteItems.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  };
  
  // Calcular valor final com desconto à vista (10%)
  const getFinalPrice = () => {
    const total = getTotalPrice();
    // Aplicar desconto de 10% se for pagamento à vista e o desconto estiver ativado
    if (paymentInstallments === "à vista" && applyCashDiscount) {
      return Math.round(total * 0.9); // 10% de desconto
    }
    return total;
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
          price: item.product.price,
          quantity: item.quantity || 1 // Garantir que sempre tem uma quantidade
        })),
        totalPrice: getTotalPrice(),
        finalPrice: getFinalPrice(),
        paymentInstallments,
        paymentMethod,
        applyCashDiscount,
        discountPercentage: (paymentInstallments === "à vista" && applyCashDiscount && user?.cashDiscountPercentage) 
                            ? user.cashDiscountPercentage 
                            : 0,
      };
      
      // --- MODIFICADO: Chamar API Backend para gerar PDF (versão simplificada) ---
      console.log("Enviando dados para API gerar PDF simples...");
      const response = await apiRequest("POST", "/api/pdf/generate", quoteData);
      
      // Verificar se a resposta é válida (não é mais um Blob, mas um JSON com URL)
      if (!response || !response.url) {
        throw new Error("Erro ao gerar PDF: Resposta inválida do servidor");
      }
      
      console.log("PDF gerado com sucesso, URL:", response.url);
      
      // Abrir o PDF em uma nova aba (link direto para o arquivo no S3)
      window.open(response.url, '_blank');
      
      console.log("PDF aberto em nova aba.");
      // --- FIM DA MODIFICAÇÃO ---
      
      // Manter lógica de salvar orçamento no banco (talvez fazer ANTES de gerar PDF?)
      await apiRequest("POST", "/api/quotes", quoteData);
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      
      toast({
        title: "Orçamento gerado com sucesso",
        description: "O orçamento foi criado e está sendo baixado.",
      });
      
      // Limpar formulário
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
        description: error instanceof Error ? error.message : "Ocorreu um erro ao gerar o orçamento.",
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
                        src={item.product.imageUrl || 'https://via.placeholder.com/64?text=Sem+Imagem'}
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
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs text-gray-500">Quantidade:</Label>
                            <div className="flex items-center border rounded-md">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleUpdateQuantity(index, Math.max(1, (item.quantity || 1) - 1))}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center text-sm">{item.quantity || 1}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleUpdateQuantity(index, (item.quantity || 1) + 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <span className="font-medium text-sm">
                            Total: {formatPrice(item.product.price * (item.quantity || 1))}
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
                
                <div className="mt-5 space-y-4">
                  <div>
                    <Label className="text-xs text-gray-500 mb-1">Condições de Pagamento</Label>
                    <Select
                      value={paymentInstallments}
                      onValueChange={setPaymentInstallments}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione a condição" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="à vista">À vista</SelectItem>
                        <SelectItem value="entrada + 1x">Entrada + 1x</SelectItem>
                        <SelectItem value="entrada + 2x">Entrada + 2x</SelectItem>
                        <SelectItem value="entrada + 3x">Entrada + 3x</SelectItem>
                        <SelectItem value="entrada + 4x">Entrada + 4x</SelectItem>
                        <SelectItem value="entrada + 5x">Entrada + 5x</SelectItem>
                        <SelectItem value="5x sem entrada">5x sem entrada</SelectItem>
                        <SelectItem value="10x sem entrada">10x sem entrada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-gray-500 mb-1">Método de Pagamento</Label>
                    <RadioGroup 
                      value={paymentMethod}
                      onValueChange={setPaymentMethod}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="boleto" id="boleto" />
                        <Label htmlFor="boleto">Boleto</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="cartao" id="cartao" />
                        <Label htmlFor="cartao">Cartão de Crédito</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="cheque" id="cheque" />
                        <Label htmlFor="cheque">Cheque</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  {paymentInstallments === "à vista" && (
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="cash-discount"
                        checked={applyCashDiscount}
                        onCheckedChange={(checked) => setApplyCashDiscount(checked as boolean)}
                      />
                      <Label htmlFor="cash-discount" className="text-sm">
                        Aplicar desconto de 10% para pagamento à vista
                      </Label>
                    </div>
                  )}
                  
                  {quoteItems.length > 0 && paymentInstallments === "à vista" && applyCashDiscount && (
                    <div className="p-2 bg-green-50 border border-green-100 rounded-md">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">Subtotal:</span>
                        <span className="text-sm font-medium">{formatPrice(getTotalPrice())}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-gray-700">Desconto (10%):</span>
                        <span className="text-sm font-medium text-green-600">-{formatPrice(getTotalPrice() * 0.1)}</span>
                      </div>
                      <div className="flex justify-between items-center mt-1 pt-1 border-t border-green-100">
                        <span className="text-sm font-medium text-gray-700">Total com desconto:</span>
                        <span className="text-sm font-bold">{formatPrice(getFinalPrice())}</span>
                      </div>
                    </div>
                  )}
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
