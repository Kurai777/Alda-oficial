import React, { createContext, useState, useEffect, useContext, ReactNode } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Interface para o usuário da nossa aplicação (ajustada - sem photoURL por padrão)
export interface User {
  id: number; // Usar ID do nosso banco
  email: string;
  name: string | null;
  companyName: string | null;
  createdAt?: Date | string | null; // Opcional no frontend?
  updatedAt?: Date | string | null; // Opcional no frontend?
  companyLogoUrl?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyCnpj?: string | null;
  quotePaymentTerms?: string | null;
  quoteValidityDays?: number | null;
  cashDiscountPercentage?: number | null;
}

// Interfaces ajustadas (sem rememberMe por padrão, sem companyName no login)
interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterCredentials {
  email: string;
  password: string;
  name: string;
  companyName?: string; // Tornar opcional?
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<void>; // Adicionar função para verificar status
}

// Criar o contexto de autenticação
const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true, // Começar como true até verificar status inicial
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  checkAuthStatus: async () => {},
});

// Provider de autenticação
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Começa carregando
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Função para verificar o status da autenticação no backend
  const checkAuthStatus = async () => {
    console.log("Verificando status de autenticação...");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include", // Enviar cookies de sessão
      });
      if (response.ok) {
        const userData: User = await response.json();
        console.log("Sessão válida, usuário:", userData);
        setUser(userData);
      } else {
        console.log("Nenhuma sessão ativa encontrada.");
        setUser(null);
        // Se não for 401 (Não autenticado), pode ser outro erro
        if (response.status !== 401) {
          console.error(`Erro inesperado ao verificar autenticação: ${response.status}`);
        }
      }
    } catch (error) {
      console.error("Erro de rede ao verificar autenticação:", error);
      setUser(null); // Assumir não logado em caso de erro de rede
    } finally {
      setLoading(false);
    }
  };

  // Verificar status ao montar o provider
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Login com email/senha (usando API)
  const login = async (credentials: LoginCredentials) => {
    setLoading(true);
    try {
      const userData: User = await apiRequest("POST", "/api/auth/login", credentials);
      setUser(userData);

      // ATUALIZAR queryKeys para /api/
      queryClient.invalidateQueries({ queryKey: ['/api/catalogs'] }); 
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      // Se houver outras queries dependentes de dados de usuário, invalidá-las também.
      // Ex: queryClient.invalidateQueries({ queryKey: ['/api/user'] }); // Para forçar recarregar dados do usuário se necessário
      // queryClient.invalidateQueries({ queryKey: ['userProjects'] }); // Se houver query para projetos do usuário
      queryClient.invalidateQueries({ queryKey: ['moodboards'] }); // Invalidar moodboards também

      toast({
        title: "Login bem-sucedido",
        description: `Bem-vindo de volta, ${userData.name || userData.email}!`,
      });
      navigate("/"); 
    } catch (error: any) {
      console.error("Erro de login (API):", error);
      toast({
        title: "Erro de login",
        description: error.message || "Email ou senha inválidos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Registro de novo usuário (usando API)
  const register = async (credentials: RegisterCredentials) => {
    setLoading(true);
    try {
      // Supondo que a rota de registro também foi movida para /api/register
      const userData: User = await apiRequest("POST", "/api/auth/register", credentials);
      setUser(userData);
      toast({
        title: "Registro bem-sucedido",
        description: "Sua conta foi criada com sucesso!",
      });
      navigate("/"); // Redirecionar para dashboard após registro
    } catch (error: any) {
      console.error("Erro de registro (API):", error);
      toast({
        title: "Erro de registro",
        description: error.message || "Não foi possível criar sua conta.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Função de logout (usando API)
  const logout = async () => {
    setLoading(true);
    try {
      // Supondo que a rota de logout também foi movida para /api/logout ou /api/auth/logout
      await apiRequest("POST", "/api/auth/logout", {}); 
      setUser(null);
      // Limpar todas as queries ao fazer logout para evitar dados antigos
      queryClient.clear(); 
      navigate("/login");
      toast({
        title: "Logout realizado",
        description: "Você foi desconectado com sucesso.",
      });
    } catch (error: any) {
      console.error("Erro de logout (API):", error);
      toast({
        title: "Erro de logout",
        description: error.message || "Não foi possível realizar o logout.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const authValue: AuthContextType = {
    user,
    loading,
    login,
    register,
    logout,
    checkAuthStatus,
  };

  return (
    <AuthContext.Provider value={authValue}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook para usar o contexto de autenticação
export function useAuth() {
  return useContext(AuthContext);
}