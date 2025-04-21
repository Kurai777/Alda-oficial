import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Quote } from "@shared/schema";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Eye,
  Trash2,
  Loader2,
  List,
  Mail,
  Phone,
  User,
  Calendar,
  Tag,
} from "lucide-react";
import QuoteGenerator from "@/components/quotes/quote-generator";

export default function Quotes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<number | null>(null);

  // Fetch quotes
  const { data: quotes, isLoading } = useQuery({
    queryKey: ["/api/quotes", { userId: user?.id }],
    enabled: !!user?.id,
  });

  // Mutation to delete quote
  const deleteMutation = useMutation({
    mutationFn: async (quoteId: number) => {
      await apiRequest("DELETE", `/api/quotes/${quoteId}`, undefined);
      return quoteId;
    },
    onSuccess: (quoteId) => {
      queryClient.setQueryData(
        ["/api/quotes", { userId: user?.id }],
        (oldData: Quote[] | undefined) => {
          if (!oldData) return [];
          return oldData.filter((quote) => quote.id !== quoteId);
        }
      );
      toast({
        title: "Orçamento excluído",
        description: "O orçamento foi excluído com sucesso.",
      });
      setQuoteToDelete(null);
    },
    onError: (error) => {
      console.error("Delete failed:", error);
      toast({
        title: "Falha na exclusão",
        description: "Ocorreu um erro ao excluir o orçamento.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteQuote = (quoteId: number) => {
    setQuoteToDelete(null);
    deleteMutation.mutate(quoteId);
  };

  // Format date utility
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Format price utility
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(price / 100);
  };

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Orçamentos</h1>
        <Button>
          <FileText className="mr-2 h-4 w-4" />
          Novo Orçamento
        </Button>
      </div>

      {/* Quote Generator */}
      <div className="mb-8">
        <QuoteGenerator />
      </div>

      {/* Quotes List */}
      <Card>
        <CardHeader>
          <CardTitle>Orçamentos Gerados</CardTitle>
          <CardDescription>
            Visualize e gerencie todos os orçamentos gerados para seus clientes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="h-16 bg-gray-100 rounded-md"></div>
              ))}
            </div>
          ) : !quotes || quotes.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2 text-gray-500">
                Nenhum orçamento gerado. Crie seu primeiro orçamento agora.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote: Quote) => (
                  <TableRow key={quote.id}>
                    <TableCell className="font-medium">{quote.clientName}</TableCell>
                    <TableCell>{formatDate(quote.createdAt.toString())}</TableCell>
                    <TableCell>{quote.items.length} produto(s)</TableCell>
                    <TableCell>{formatPrice(quote.totalPrice)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedQuote(quote)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Detalhes
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl">
                            <DialogHeader>
                              <DialogTitle>Detalhes do Orçamento</DialogTitle>
                              <DialogDescription>
                                Visualize os detalhes completos do orçamento.
                              </DialogDescription>
                            </DialogHeader>
                            {selectedQuote && (
                              <div className="mt-4">
                                <div className="flex flex-col md:flex-row justify-between mb-4">
                                  <div>
                                    <h3 className="font-bold text-lg">{selectedQuote.clientName}</h3>
                                    <div className="flex items-center text-gray-500 text-sm mt-1">
                                      <Calendar className="h-4 w-4 mr-1" />
                                      {formatDate(selectedQuote.createdAt.toString())}
                                    </div>
                                    {selectedQuote.clientEmail && (
                                      <div className="flex items-center text-gray-500 text-sm mt-1">
                                        <Mail className="h-4 w-4 mr-1" />
                                        {selectedQuote.clientEmail}
                                      </div>
                                    )}
                                    {selectedQuote.clientPhone && (
                                      <div className="flex items-center text-gray-500 text-sm mt-1">
                                        <Phone className="h-4 w-4 mr-1" />
                                        {selectedQuote.clientPhone}
                                      </div>
                                    )}
                                  </div>
                                  
                                  {selectedQuote.architectName && (
                                    <div className="mt-4 md:mt-0">
                                      <div className="flex items-center text-gray-700">
                                        <User className="h-4 w-4 mr-1" />
                                        <span className="font-medium">Arquiteto:</span>
                                      </div>
                                      <p className="text-gray-700 ml-5">
                                        {selectedQuote.architectName}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                
                                <Separator className="my-4" />
                                
                                <div>
                                  <h4 className="font-medium flex items-center mb-2">
                                    <List className="h-4 w-4 mr-1" />
                                    Itens do Orçamento
                                  </h4>
                                  <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
                                    {selectedQuote.items.map((item, index) => (
                                      <div key={index} className="border rounded-md p-3">
                                        <div className="flex justify-between items-start">
                                          <div>
                                            <p className="font-medium">{item.productName}</p>
                                            <div className="flex items-center text-xs text-gray-500 mt-1">
                                              <Tag className="h-3 w-3 mr-1" />
                                              {item.productCode}
                                            </div>
                                          </div>
                                          <p className="font-semibold">{formatPrice(item.price)}</p>
                                        </div>
                                        <div className="flex mt-2 text-sm">
                                          <span className="text-gray-500 mr-2">Cor:</span>
                                          <Badge variant="outline" className="px-2 py-0 h-5">
                                            {item.color}
                                          </Badge>
                                          {item.size && (
                                            <>
                                              <span className="text-gray-500 mx-2">Tamanho:</span>
                                              <Badge variant="outline" className="px-2 py-0 h-5">
                                                {item.size}
                                              </Badge>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  
                                  <div className="flex justify-between items-center font-medium text-lg mt-4 pt-4 border-t">
                                    <span>Total:</span>
                                    <span>{formatPrice(selectedQuote.totalPrice)}</span>
                                  </div>
                                </div>
                                
                                {selectedQuote.notes && (
                                  <div className="mt-4 pt-4 border-t">
                                    <h4 className="font-medium mb-2">Observações</h4>
                                    <p className="text-gray-700 text-sm bg-gray-50 p-3 rounded-md">
                                      {selectedQuote.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            <DialogFooter>
                              <Button>
                                <Download className="mr-2 h-4 w-4" />
                                Download PDF
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-1" />
                          PDF
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir o orçamento do cliente "
                                {quote.clientName}"? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteQuote(quote.id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                {deleteMutation.isPending && quoteToDelete === quote.id ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  "Excluir"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardFooter className="flex justify-between text-sm text-gray-500">
          <div>
            {quotes?.length || 0} orçamento(s) gerado(s)
          </div>
          <div>
            Última atualização: {new Date().toLocaleTimeString()}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
