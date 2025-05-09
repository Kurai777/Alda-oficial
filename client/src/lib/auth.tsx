import React, { createContext, useState, useEffect, useContext, ReactNode } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "./queryClient";

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
      const response = await fetch("/api/user", {
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
      const userData: User = await apiRequest("POST", "/api/login", credentials);
      setUser(userData);

      // Limpar queries pode ser necessário dependendo da sua lógica de cache
      // queryClient.invalidateQueries(); // Invalidar tudo ou queries específicas
      queryClient.invalidateQueries({ queryKey: ['/backend/catalogs'] });
      queryClient.invalidateQueries({ queryKey: ['/backend/products'] });

      toast({
        title: "Login bem-sucedido",
        description: `Bem-vindo de volta, ${userData.name || userData.email}!`,
      });
      navigate("/"); // Redirecionar para dashboard
    } catch (error: any) {
      console.error("Erro de login (API):", error);
      toast({
        title: "Erro de login",
        // Usar mensagem de erro da API se disponível, senão genérica
        description: error.message || "Email ou senha inválidos.",
        variant: "destructive",
      });
      // Não precisa lançar o erro novamente, já tratamos
    } finally {
      setLoading(false);
    }
  };

  // Registro de novo usuário (usando API)
  const register = async (credentials: RegisterCredentials) => {
    setLoading(true);
    try {
      const userData: User = await apiRequest("POST", "/api/register", credentials);
      setUser(userData);

      // Limpar queries
      queryClient.invalidateQueries({ queryKey: ['/backend/catalogs'] });
      queryClient.invalidateQueries({ queryKey: ['/backend/products'] });

      toast({
        title: "Registro bem-sucedido",
        description: `Bem-vindo, ${userData.name || userData.email}!`,
      });
      navigate("/"); // Redirecionar para dashboard
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
      await apiRequest("POST", "/api/logout");
      setUser(null);
      queryClient.clear(); // Limpar todo o cache ao sair

      toast({
        title: "Logout bem-sucedido",
        description: "Você saiu da sua conta.",
      });
      navigate("/login"); // Redirecionar para login
    } catch (error: any) {
      console.error("Erro de logout (API):", error);
      toast({
        title: "Erro ao sair",
        description: error.message || "Não foi possível encerrar a sessão.",
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