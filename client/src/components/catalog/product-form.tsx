import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Product } from "@shared/schema";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Categorias comuns de móveis para seleção
const productCategories = [
  "Mesa",
  "Cadeira",
  "Sofá",
  "Poltrona",
  "Armário",
  "Estante",
  "Cama",
  "Banco",
  "Cabeceira",
  "Criado-mudo",
  "Escrivaninha",
  "Cômoda",
  "Rack",
  "Painel",
  "Buffet",
  "Aparador",
  "Outro",
];

// Cores comuns para seleção
const commonColors = [
  "Branco",
  "Preto",
  "Bege",
  "Cinza",
  "Marrom",
  "Mogno",
  "Carvalho",
  "Natural",
  "Azul",
  "Verde",
  "Vermelho",
  "Amarelo",
  "Laranja",
  "Rosa",
  "Roxo",
];

// Materiais comuns para seleção
const commonMaterials = [
  "Madeira maciça",
  "MDF",
  "MDP",
  "Compensado",
  "Laminado",
  "Metal",
  "Alumínio",
  "Aço inox",
  "Aço carbono",
  "Vidro",
  "Tecido",
  "Couro",
  "Couro sintético",
  "Plástico",
  "Vime",
  "Junco",
  "Rattan",
  "Palhinha",
  "Laca",
  "Mármore",
  "Granito",
  "Pedra",
];

// Schema para validação do formulário
const productFormSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  code: z.string().min(2, "Código deve ter pelo menos 2 caracteres"),
  description: z.string().optional(),
  category: z.string().min(1, "Categoria é obrigatória"),
  price: z.coerce
    .number()
    .min(0, "Preço não pode ser negativo")
    .transform((val) => val * 100), // Converte para centavos
  height: z.coerce.number().optional(),
  width: z.coerce.number().optional(),
  depth: z.coerce.number().optional(),
  weight: z.coerce.number().optional(),
  colors: z.array(z.string()).min(1, "Adicione pelo menos uma cor"),
  materials: z.array(z.string()).optional(),
  imageUrl: z.string().url("URL da imagem inválida").optional(),
  catalogId: z.number().int().positive(),
  userId: z.number().int().positive(),
});

type ProductFormValues = z.input<typeof productFormSchema>;

interface ProductFormProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product;
  userId: number;
  catalogId: number;
}

export default function ProductForm({
  isOpen,
  onClose,
  product,
  userId,
  catalogId,
}: ProductFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedColors, setSelectedColors] = useState<string[]>(
    product?.colors || []
  );
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>(
    product?.materials || []
  );

  // Preparar valor inicial para o preço (converter de centavos para reais)
  const initialPrice = product ? product.price / 100 : undefined;

  // Inicializar o formulário
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: product?.name || "",
      code: product?.code || "",
      description: product?.description || "",
      category: product?.category || "",
      price: initialPrice,
      height: product?.height || undefined,
      width: product?.width || undefined,
      depth: product?.depth || undefined,
      weight: product?.weight || undefined,
      colors: product?.colors || [],
      materials: product?.materials || [],
      imageUrl: product?.imageUrl || "",
      catalogId: catalogId,
      userId: userId,
    },
  });

  // Mutação para criar ou atualizar produto
  const mutation = useMutation({
    mutationFn: async (data: ProductFormValues) => {
      // Se tiver ID, é uma atualização, senão, é uma criação
      if (product?.id) {
        const response = await apiRequest(
          "PUT",
          `/api/products/${product.id}`,
          data
        );
        return response.json();
      } else {
        const response = await apiRequest("POST", "/api/products", data);
        return response.json();
      }
    },
    onSuccess: () => {
      // Invalidar consultas para recarregar os produtos
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: product ? "Produto atualizado" : "Produto criado",
        description: product
          ? "O produto foi atualizado com sucesso."
          : "O produto foi criado com sucesso.",
      });
      onClose();
    },
    onError: (error) => {
      console.error("Erro:", error);
      toast({
        title: "Erro",
        description: "Ocorreu um erro ao salvar o produto.",
        variant: "destructive",
      });
    },
  });

  // Handler para adicionar/remover cores
  const handleColorToggle = (color: string) => {
    if (selectedColors.includes(color)) {
      setSelectedColors(selectedColors.filter((c) => c !== color));
    } else {
      setSelectedColors([...selectedColors, color]);
    }
    form.setValue("colors", selectedColors.includes(color) 
      ? selectedColors.filter(c => c !== color)
      : [...selectedColors, color], 
      { shouldValidate: true }
    );
  };

  // Handler para adicionar/remover materiais
  const handleMaterialToggle = (material: string) => {
    if (selectedMaterials.includes(material)) {
      setSelectedMaterials(selectedMaterials.filter((m) => m !== material));
    } else {
      setSelectedMaterials([...selectedMaterials, material]);
    }
    form.setValue("materials", selectedMaterials.includes(material)
      ? selectedMaterials.filter(m => m !== material)
      : [...selectedMaterials, material]
    );
  };

  // Enviar formulário
  const onSubmit = (data: ProductFormValues) => {
    data.colors = selectedColors;
    data.materials = selectedMaterials;
    mutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {product ? "Editar Produto" : "Adicionar Novo Produto"}
          </DialogTitle>
          <DialogDescription>
            Preencha os detalhes do produto abaixo.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nome do produto */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Produto*</FormLabel>
                    <FormControl>
                      <Input placeholder="Mesa de Jantar" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Código do produto */}
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código*</FormLabel>
                    <FormControl>
                      <Input placeholder="MJ-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Categoria */}
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria*</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {productCategories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Preço */}
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preço (R$)*</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="1299.99"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Descrição */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o produto..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Dimensões */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="height"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Altura (cm)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="75" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="width"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Largura (cm)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="120" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="depth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Profundidade (cm)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="80" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Peso (kg)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* URL da imagem */}
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL da Imagem</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://exemplo.com/imagem.jpg"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Cores */}
            <div>
              <FormLabel className="block mb-2">Cores*</FormLabel>
              <div className="flex flex-wrap gap-2">
                {commonColors.map((color) => (
                  <Button
                    key={color}
                    type="button"
                    variant={selectedColors.includes(color) ? "default" : "outline"}
                    className="text-xs"
                    onClick={() => handleColorToggle(color)}
                  >
                    {color}
                  </Button>
                ))}
              </div>
              {form.formState.errors.colors && (
                <p className="text-sm font-medium text-destructive mt-2">
                  {form.formState.errors.colors.message as string}
                </p>
              )}
            </div>

            {/* Materiais */}
            <div>
              <FormLabel className="block mb-2">Materiais</FormLabel>
              <div className="flex flex-wrap gap-2">
                {commonMaterials.map((material) => (
                  <Button
                    key={material}
                    type="button"
                    variant={selectedMaterials.includes(material) ? "default" : "outline"}
                    className="text-xs"
                    onClick={() => handleMaterialToggle(material)}
                  >
                    {material}
                  </Button>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                className="mr-2"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={mutation.isPending}
              >
                {mutation.isPending ? (
                  <>
                    <span className="animate-spin mr-2">&#9696;</span>
                    Salvando...
                  </>
                ) : product ? (
                  "Atualizar Produto"
                ) : (
                  "Adicionar Produto"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}