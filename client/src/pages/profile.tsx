import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
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
import { updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getUserData, saveUserData, UserData } from "@/lib/firestore";
import { 
  Save as SaveIcon, 
  User as UserIcon, 
  Building as BuildingIcon 
} from "lucide-react";

// Schema de validação
const profileFormSchema = z.object({
  companyName: z.string().min(2, {
    message: "O nome da empresa deve ter pelo menos 2 caracteres.",
  }),
  name: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);

  // Inicializar formulário
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      companyName: user?.companyName || "",
      name: "",
      phone: "",
      address: "",
    },
  });

  // Buscar dados adicionais do Firestore
  useEffect(() => {
    const fetchUserData = async () => {
      if (!user?.uid) return;
      
      setIsLoading(true);
      try {
        // Usar nossa função de utilidade para buscar dados do usuário
        const firestoreData = await getUserData(user.uid);
        setUserData(firestoreData);
        
        if (firestoreData) {
          // Atualizar valores do formulário com dados do Firestore
          form.reset({
            companyName: firestoreData.companyName || user.companyName || "",
            name: firestoreData.name || "",
            phone: firestoreData.phone || "",
            address: firestoreData.address || "",
          });
        } else {
          // Documento não existe, usar valores padrão do Auth
          form.reset({
            companyName: user.companyName || "",
            name: "",
            phone: "",
            address: "",
          });
        }
      } catch (error) {
        console.error("Erro ao buscar dados do usuário:", error);
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Não foi possível carregar seus dados. Tente novamente mais tarde.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [user?.uid, form]);

  // Salvar alterações
  async function onSubmit(data: ProfileFormValues) {
    if (!user?.uid) return;
    
    setIsLoading(true);
    try {
      // 1. Atualizar no Firebase Auth (apenas displayName)
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: data.companyName,
        });
      }
      
      // 2. Atualizar no Firestore usando nossa função de utilidade
      await saveUserData({
        uid: user.uid,
        email: user.email,
        companyName: data.companyName,
        name: data.name,
        phone: data.phone,
        address: data.address,
      });
      
      // 3. Sincronizar com o backend
      await fetch('/api/auth/firebase-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          companyName: data.companyName,
        }),
      });
      
      toast({
        title: "Perfil atualizado",
        description: "Suas informações foram atualizadas com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Não foi possível atualizar seu perfil. Tente novamente mais tarde.",
      });
    } finally {
      setIsLoading(false);
    }
  }

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
                        <FormControl>
                          <Input placeholder="Nome da sua empresa" {...field} />
                        </FormControl>
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
                        <FormLabel>Nome do Responsável</FormLabel>
                        <FormControl>
                          <Input placeholder="Seu nome completo" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Telefone</FormLabel>
                        <FormControl>
                          <Input placeholder="(00) 00000-0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endereço</FormLabel>
                        <FormControl>
                          <Input placeholder="Endereço da empresa" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button 
                    type="submit" 
                    className="w-full sm:w-auto" 
                    disabled={isLoading}
                  >
                    {isLoading ? "Salvando..." : "Salvar Alterações"}
                    {!isLoading && <SaveIcon className="ml-2 h-4 w-4" />}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
        
        {/* Coluna 2: Informações da Conta */}
        <div>
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
                  <p className="mt-1">{user.email}</p>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Perfil Firebase</h3>
                  <p className="mt-1 text-sm">ID: {user.uid}</p>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">Status da Conta</h3>
                  <div className="mt-1 flex items-center">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-2" />
                    <span className="text-sm">Ativo</span>
                  </div>
                </div>
                
                {user.photoURL && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Foto de Perfil</h3>
                      <div className="mt-2">
                        <img 
                          src={user.photoURL} 
                          alt={user.companyName || "Usuário"}
                          className="w-20 h-20 rounded-full object-cover"
                        />
                      </div>
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