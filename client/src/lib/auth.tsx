import React, { createContext, useState, useEffect, useContext, ReactNode } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  email: string;
  companyName: string;
}

interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

interface RegisterCredentials {
  email: string;
  password: string;
  companyName: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

// Criar o contexto de autenticação
const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {}
});

// Provider de autenticação
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Verificar se o usuário está autenticado ao iniciar
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        // Tentar buscar o usuário atual
        const response = await apiRequest('GET', '/api/auth/me');
        
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch (error) {
        console.error("Error checking auth status:", error);
      } finally {
        setLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  // Função de login
  const login = async (credentials: LoginCredentials) => {
    setLoading(true);
    try {
      const response = await apiRequest('POST', '/api/auth/login', credentials);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao efetuar login');
      }
      
      const userData = await response.json();
      setUser(userData);
      
      toast({
        title: "Login bem-sucedido",
        description: `Bem-vindo, ${userData.companyName}!`,
      });
      
      navigate("/");
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Erro de login",
        description: error instanceof Error ? error.message : "Falha ao efetuar login",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Função de registro
  const register = async (credentials: RegisterCredentials) => {
    setLoading(true);
    try {
      const response = await apiRequest('POST', '/api/auth/register', credentials);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao registrar');
      }
      
      const userData = await response.json();
      setUser(userData);
      
      toast({
        title: "Registro bem-sucedido",
        description: `Bem-vindo, ${userData.companyName}!`,
      });
      
      navigate("/");
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Erro de registro",
        description: error instanceof Error ? error.message : "Falha ao registrar",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Função de logout
  const logout = async () => {
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/logout');
      setUser(null);
      
      toast({
        title: "Logout bem-sucedido",
        description: "Você saiu da sua conta com sucesso",
      });
      
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        title: "Erro ao sair",
        description: "Ocorreu um erro ao tentar sair da sua conta",
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
    logout
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