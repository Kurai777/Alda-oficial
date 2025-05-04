import { useState, useEffect } from "react";
import { useAuth, User } from "@/lib/auth";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Save as SaveIcon, 
  User as UserIcon, 
  Building as BuildingIcon 
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

// Schema de validação Zod ATUALIZADO com todos os campos
const profileFormSchema = z.object({
  companyName: z.string().min(2, { message: "O nome da empresa deve ter pelo menos 2 caracteres." }).nullable().optional(),
  name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }).nullable().optional(),
  companyAddress: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  companyCnpj: z.string().nullable().optional(),
  quotePaymentTerms: z.string().nullable().optional(),
  // Zod trata números em inputs como string inicialmente, converter depois
  quoteValidityDays: z.string().nullable().optional(), 
  // logoUpload não entra no schema de dados a serem enviados diretamente
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function ProfilePage() {
  const { user, checkAuthStatus } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Manter apenas estados para upload/preview do logo
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);

  // Configurar react-hook-form
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: "",
      companyName: "",
      companyAddress: "",
      companyPhone: "",
      companyCnpj: "",
      quotePaymentTerms: "",
      quoteValidityDays: "",
    },
    mode: "onChange", // Validar ao mudar
  });

  // Atualizar formulário e preview do logo quando dados do usuário carregarem
  useEffect(() => {
    if (user) {
      form.reset({
        name: user.name || "",
        companyName: user.companyName || "",
        companyAddress: user.companyAddress || "",
        companyPhone: user.companyPhone || "",
        companyCnpj: user.companyCnpj || "",
        quotePaymentTerms: user.quotePaymentTerms || "",
        quoteValidityDays: user.quoteValidityDays?.toString() || "", // Converter número para string
      });
      setCompanyLogoPreview(user.companyLogoUrl || null);
    } else {
      // Limpar formulário se usuário deslogar
      form.reset();
      setCompanyLogoPreview(null);
    }
  }, [user, form.reset]);

  // Função para lidar com mudança de arquivo de logo
  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCompanyLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setCompanyLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setCompanyLogoFile(null);
      setCompanyLogoPreview(user?.companyLogoUrl || null);
    }
  };

  // Função chamada pelo react-hook-form no submit
  async function onSubmit(formData: ProfileFormValues) {
    console.log("onSubmit chamado com dados:", formData);
    await handleSaveChanges(formData);
  }

  // Função para salvar (agora recebe dados do form)
  const handleSaveChanges = async (formData: ProfileFormValues) => {
    if (!user) return;
    setIsLoading(true);

    let logoUrlToSave = user?.companyLogoUrl; // Começa com a URL existente ou null

    // 1. Se um NOVO arquivo de logo foi selecionado, faça o upload REAL
    if (companyLogoFile) {
      console.log("Fazendo upload do novo logo...");
      try {
        const logoFormData = new FormData();
        logoFormData.append('logoFile', companyLogoFile); 

        // MUDAR URL DA CHAMADA FETCH
        const uploadResponse = await fetch("/api/upload-logo", {
            method: "POST",
            body: logoFormData,
            credentials: "include" 
        });

        if (!uploadResponse.ok) {
            let errorMsg = `Erro ${uploadResponse.status} no upload do logo.`;
            try {
              const errorData = await uploadResponse.json();
              errorMsg = errorData.message || errorMsg;
            } catch (e) { /* Ignorar */ }
            throw new Error(errorMsg);
        }
        
        // Verificar Content-Type e pegar URL
        const contentType = uploadResponse.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const result = await uploadResponse.json();
            if (!result.logoUrl) { // Checar se a URL veio na resposta
                 console.error("API de upload retornou sucesso mas sem logoUrl", result);
                 throw new Error("Resposta inválida do servidor após upload do logo.");
            }
            logoUrlToSave = result.logoUrl; 
            console.log("Upload do logo concluído, URL:", logoUrlToSave);
            setCompanyLogoFile(null); // Limpa o estado do arquivo APENAS após upload BEM-SUCEDIDO
        } else {
            const responseBody = await uploadResponse.text();
            console.error("Erro: Resposta inesperada do servidor (não JSON) para upload do logo. Content-Type:", contentType, "Body:", responseBody);
            throw new Error("Resposta inesperada do servidor ao fazer upload do logo.");
        }
        
      } catch (uploadError: any) {
        console.error("Erro no upload do logo:", uploadError);
        toast({
          title: "Erro no Upload do Logo",
          description: uploadError.message || "Não foi possível enviar o logo.",
          variant: "destructive",
        });
        setIsLoading(false);
        return; // Abortar salvamento se upload falhar
      }
    } else if (companyLogoPreview === null && user?.companyLogoUrl) {
      // Se não há arquivo novo, mas o preview foi limpo, significa remover o logo
      console.log("Removendo logo existente...");
       // TODO: Adicionar chamada opcional à API para DELETAR logo antigo do S3
      logoUrlToSave = null;
    }
    // Se não houve arquivo novo e o preview não foi limpo, logoUrlToSave mantém o valor original

    // 2. Preparar dados finais para atualizar perfil
    const updateData = {
      name: formData.name || null,
      companyName: formData.companyName || null,
      companyAddress: formData.companyAddress || null,
      companyPhone: formData.companyPhone || null,
      companyCnpj: formData.companyCnpj || null,
      companyLogoUrl: logoUrlToSave, // <<< Usar a URL final (nova, antiga ou null)
      quotePaymentTerms: formData.quotePaymentTerms || null,
      quoteValidityDays: formData.quoteValidityDays ? Number(formData.quoteValidityDays) : null,
    };

    try {
      // 3. Chamar API para atualizar dados do perfil
      console.log("Enviando dados para atualização (PUT /api/auth/me):", updateData);
      await apiRequest("PUT", "/api/auth/me", updateData); 
      
      // 4. Recarregar dados do usuário
      await checkAuthStatus(); 
      
      toast({ 
        title: "Perfil atualizado",
        description: "Suas informações foram salvas com sucesso." 
      });

    } catch (error: any) {
      console.error("Erro ao salvar perfil:", error);
      toast({ title: "Erro ao salvar", /*...*/ variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <Card className="w-full max-w-3xl mx-auto">
        <CardHeader className="text-center">
          <CardTitle>Acesso Negado</CardTitle>
          <CardDescription>Você precisa estar autenticado para acessar esta página.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold mb-6">Perfil da Empresa</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Coluna 1: Informações de Perfil */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="w-5 h-5" />
                Informações do Perfil
              </CardTitle>
              <CardDescription>
                Atualize as informações do seu perfil e empresa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome da Empresa</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormDescription>
                          Este nome será exibido em todos os seus documentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome (Contato Principal)</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="companyAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endereço da Empresa</FormLabel>
                        <FormControl><Textarea {...field} value={field.value ?? ""} rows={3} /></FormControl>
                        <FormDescription>
                          Este endereço será exibido em todos os seus documentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="companyPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telefone da Empresa</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormDescription>
                          Este telefone será exibido em todos os seus documentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="companyCnpj"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CNPJ</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormDescription>
                          Este CNPJ será exibido em todos os seus documentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="quotePaymentTerms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Condições de Pagamento Padrão</FormLabel>
                        <FormControl><Textarea {...field} value={field.value ?? ""} rows={3} placeholder="Ex: 50% entrada..." /></FormControl>
                        <FormDescription>
                          Este termo será usado como padrão para novos orçamentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="quoteValidityDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Validade Padrão do Orçamento (dias)</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value ?? ""} placeholder="Ex: 7" min="1"/></FormControl>
                        <FormDescription>
                          Este período será usado como padrão para novos orçamentos.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="space-y-1">
                    <Label htmlFor="logoUpload">Logo da Empresa</Label>
                    <div className="flex items-center gap-4">
                      {companyLogoPreview ? (
                        <img src={companyLogoPreview} alt="Preview do Logo" className="h-16 w-16 object-contain border rounded" />
                      ) : (
                        <div className="h-16 w-16 border rounded bg-gray-50 flex items-center justify-center text-gray-400">Logo</div>
                      )}
                      <Input 
                        id="logoUpload" 
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        onChange={handleLogoChange}
                        className="flex-1"
                      />
                      {companyLogoPreview && (
                        <Button variant="outline" size="sm" onClick={() => { setCompanyLogoFile(null); setCompanyLogoPreview(null); }}>Remover</Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Envie o logo da sua empresa (PNG, JPG, WEBP).</p>
                  </div>
                  
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isLoading || !form.formState.isDirty}>
                      {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SaveIcon className="mr-2 h-4 w-4" />}
                      Salvar Alterações
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
        
        {/* Coluna 2: Informações da Conta */}
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BuildingIcon className="w-5 h-5" />
                Informações da Conta
              </CardTitle>
              <CardDescription>
                Detalhes da sua conta no sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Email</h3>
                  <p className="mt-1 text-sm">{user.email}</p>
                </div>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">ID da Conta</h3>
                  <p className="mt-1 text-sm">{user.id}</p>
                </div>
                 <Separator />
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Status da Conta</h3>
                  <div className="mt-1 flex items-center">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-2" />
                    <span className="text-sm">Ativo</span>
                  </div>
                </div>
                
                {/* MOSTRAR NOVOS DADOS SALVOS */}
                {user.companyAddress && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Endereço</h3>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{user.companyAddress}</p>
                    </div>
                  </>
                )}
                 {user.companyPhone && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Telefone</h3>
                      <p className="mt-1 text-sm">{user.companyPhone}</p>
                    </div>
                  </>
                )}
                 {user.companyCnpj && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">CNPJ</h3>
                      <p className="mt-1 text-sm">{user.companyCnpj}</p>
                    </div>
                  </>
                )}
                 {user.quotePaymentTerms && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Condições Pagto. Padrão</h3>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{user.quotePaymentTerms}</p>
                    </div>
                  </>
                )}
                 {user.quoteValidityDays !== null && user.quoteValidityDays !== undefined && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Validade Orçamento Padrão</h3>
                      <p className="mt-1 text-sm">{user.quoteValidityDays} dias</p>
                    </div>
                  </>
                )}
                
                {/* Logo Atual (mantido) */}
                {user.companyLogoUrl && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Logo Atual</h3>
                      {/* Usar companyLogoPreview aqui pode ser enganoso, usar user.companyLogoUrl que vem do banco */}
                      <img src={user.companyLogoUrl} alt="Logo da Empresa" className="mt-1 h-20 w-auto object-contain border rounded" />
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}