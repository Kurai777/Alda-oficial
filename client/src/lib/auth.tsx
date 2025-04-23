import React, { createContext, useState, useEffect, useContext, ReactNode } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { 
  User as FirebaseUser, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { apiRequest, queryClient } from "./queryClient";

// Interface para o usuário da nossa aplicação
export interface User {
  uid: string;
  email: string | null;
  companyName: string;
  photoURL?: string | null;
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
  loginWithGoogle: () => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

// Criar o contexto de autenticação
const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: false,
  login: async () => {},
  loginWithGoogle: async () => {},
  register: async () => {},
  logout: async () => {}
});

// Função para transformar usuário do Firebase em nosso modelo de usuário
const transformFirebaseUser = async (firebaseUser: FirebaseUser): Promise<User> => {
  // Buscar dados adicionais do usuário no Firestore
  const userDocRef = doc(db, "users", firebaseUser.uid);
  const userDoc = await getDoc(userDocRef);
  
  if (userDoc.exists()) {
    // Usar dados do Firestore + Firebase Auth
    const userData = userDoc.data();
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      companyName: userData.companyName || "Empresa",
      photoURL: firebaseUser.photoURL
    };
  } else {
    // Caso o documento ainda não exista (improvável após registro, mas possível em outros cenários)
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      companyName: firebaseUser.displayName || "Empresa",
      photoURL: firebaseUser.photoURL
    };
  }
};

// Provider de autenticação
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Monitorar estado de autenticação
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      try {
        if (firebaseUser) {
          // Usuário autenticado
          const userData = await transformFirebaseUser(firebaseUser);
          setUser(userData);
          
          // Atualizar informações na API para manter compatibilidade com backend existente
          await apiRequest('POST', '/api/auth/firebase-sync', { 
            uid: userData.uid,
            email: userData.email,
            companyName: userData.companyName
          });
        } else {
          // Usuário não autenticado
          setUser(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
      } finally {
        setLoading(false);
      }
    });

    // Cleanup function
    return () => unsubscribe();
  }, []);

  // Login com email/senha
  const login = async (credentials: LoginCredentials) => {
    setLoading(true);
    try {
      const { email, password } = credentials;
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userData = await transformFirebaseUser(userCredential.user);
      
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      queryClient.invalidateQueries({ queryKey: ['/api/catalogs'] });
      
      toast({
        title: "Login bem-sucedido",
        description: `Bem-vindo, ${userData.companyName}!`,
      });
      
      navigate("/");
    } catch (error: any) {
      console.error("Login error:", error);
      
      let errorMessage = "Falha ao efetuar login";
      if (error.code === 'auth/invalid-credential') {
        errorMessage = "Email ou senha inválidos";
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = "Usuário não encontrado";
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = "Senha incorreta";
      }
      
      toast({
        title: "Erro de login",
        description: errorMessage,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Login com Google
  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      
      // Verificar se é o primeiro login
      const userDocRef = doc(db, "users", result.user.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        // Criar documento de usuário no Firestore para novos usuários
        await setDoc(userDocRef, {
          email: result.user.email,
          companyName: result.user.displayName || "Empresa",
          createdAt: new Date()
        });
      }
      
      const userData = await transformFirebaseUser(result.user);
      
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      queryClient.invalidateQueries({ queryKey: ['/api/catalogs'] });
      
      toast({
        title: "Login com Google bem-sucedido",
        description: `Bem-vindo, ${userData.companyName}!`,
      });
      
      navigate("/");
    } catch (error: any) {
      console.error("Google login error:", error);
      toast({
        title: "Erro no login com Google",
        description: error.message || "Falha ao efetuar login com Google",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Registro de novo usuário
  const register = async (credentials: RegisterCredentials) => {
    setLoading(true);
    try {
      const { email, password, companyName } = credentials;
      
      // Criar usuário no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;
      
      // Criar documento de usuário no Firestore
      const userDocRef = doc(db, "users", firebaseUser.uid);
      await setDoc(userDocRef, {
        email,
        companyName,
        createdAt: new Date()
      });
      
      // Transformar para nosso modelo de usuário
      const userData: User = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        companyName
      };
      
      setUser(userData);
      
      toast({
        title: "Registro bem-sucedido",
        description: `Bem-vindo, ${companyName}!`,
      });
      
      navigate("/");
    } catch (error: any) {
      console.error("Registration error:", error);
      
      let errorMessage = "Falha ao registrar";
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = "Email já está em uso";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "Email inválido";
      } else if (error.code === 'auth/weak-password') {
        errorMessage = "Senha muito fraca";
      }
      
      toast({
        title: "Erro de registro",
        description: errorMessage,
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
      await signOut(auth);
      setUser(null);
      
      // Limpar cache de consultas
      queryClient.clear();
      
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
    loginWithGoogle,
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