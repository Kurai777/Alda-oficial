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
  // Criar modelo base com dados do Firebase Auth
  const baseUser: User = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    companyName: firebaseUser.displayName || "Empresa",
    photoURL: firebaseUser.photoURL
  };
  
  // Tentar buscar dados adicionais do usuário no Firestore (sem bloquear em caso de erro)
  try {
    const userDocRef = doc(db, "users", firebaseUser.uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      // Adicionar dados do Firestore se existirem
      const userData = userDoc.data();
      if (userData.companyName) {
        baseUser.companyName = userData.companyName;
      }
    }
  } catch (error) {
    console.warn("Não foi possível acessar dados do Firestore:", error);
    // Continuar com os dados básicos do Firebase Auth
  }
  
  return baseUser;
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
          // Usuário autenticado - criar objeto de usuário apenas com informações do Auth
          const userData: User = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            companyName: firebaseUser.displayName || "Empresa",
            photoURL: firebaseUser.photoURL
          };
          
          // Definir usuário imediatamente para melhorar UX
          setUser(userData);
          
          // Tentar sincronizar com backend em background (sem bloquear a interface)
          setTimeout(() => {
            // Não precisa ser await porque estamos em um setTimeout
            apiRequest('POST', '/api/auth/firebase-sync', { 
              uid: userData.uid,
              email: userData.email,
              companyName: userData.companyName
            }).catch(syncError => {
              console.warn("Background sync error:", syncError);
              // Não mostrar erro ao usuário, pois isso acontece em background
            });
          }, 1000);
        } else {
          // Usuário não autenticado
          setUser(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
        // Não impedir a navegação em caso de erro
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
      const firebaseUser = result.user;
      
      // Construir modelo de usuário com base nos dados do Firebase Auth
      const userData: User = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        companyName: firebaseUser.displayName || "Empresa",
        photoURL: firebaseUser.photoURL
      };
      
      // Tentar obter ou criar documento no Firestore, mas não bloquear login se falhar
      try {
        // Verificar se é o primeiro login
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          // Tentar criar documento de usuário no Firestore para novos usuários
          try {
            await setDoc(userDocRef, {
              email: firebaseUser.email,
              companyName: firebaseUser.displayName || "Empresa",
              createdAt: new Date()
            });
            console.log("Documento do usuário criado no Firestore para login com Google");
          } catch (firestoreError) {
            console.warn("Não foi possível criar documento no Firestore para Google login:", firestoreError);
            // Continuar com o login mesmo sem documento no Firestore
          }
        } else {
          // Usar dados do Firestore se disponíveis
          const firestoreData = userDoc.data();
          userData.companyName = firestoreData.companyName || userData.companyName;
        }
      } catch (firestoreError) {
        console.warn("Erro ao acessar o Firestore durante login com Google:", firestoreError);
      }
      
      // Sincronizar com o backend
      try {
        await apiRequest('POST', '/api/auth/firebase-sync', { 
          uid: userData.uid,
          email: userData.email,
          companyName: userData.companyName
        });
      } catch (syncError) {
        console.warn("Erro na sincronização com backend para login Google:", syncError);
      }
      
      setUser(userData);
      
      // Limpar e atualizar cache de consultas
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      queryClient.invalidateQueries({ queryKey: ['/api/catalogs'] });
      
      toast({
        title: "Login com Google bem-sucedido",
        description: `Bem-vindo, ${userData.companyName}!`,
      });
      
      navigate("/");
    } catch (error: any) {
      console.error("Google login error:", error);
      
      let errorMessage = "Falha ao efetuar login com Google";
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = "Pop-up fechado antes de concluir o login";
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = "Pop-up bloqueado pelo navegador. Por favor, permita pop-ups para este site";
      } else if (error.code === 'permission-denied') {
        errorMessage = "Permissão negada. Por favor, entre em contato com o administrador.";
      }
      
      toast({
        title: "Erro no login com Google",
        description: errorMessage,
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
      
      // Construir modelo de usuário independente do Firestore
      const userData: User = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        companyName
      };
      
      // Tentar criar documento no Firestore, mas não impedir login se falhar
      try {
        // Criar documento de usuário no Firestore
        const userDocRef = doc(db, "users", firebaseUser.uid);
        await setDoc(userDocRef, {
          email,
          companyName,
          createdAt: new Date()
        });
        console.log("Documento do usuário criado no Firestore");
      } catch (firestoreError) {
        // Apenas log, não impede o fluxo de registro
        console.warn("Não foi possível criar documento no Firestore:", firestoreError);
        // Continuar com o registro mesmo sem documento no Firestore
      }
      
      // Sincronizar com o backend através da API
      try {
        await apiRequest('POST', '/api/auth/firebase-sync', { 
          uid: userData.uid,
          email: userData.email,
          companyName: userData.companyName
        });
      } catch (syncError) {
        console.warn("Erro na sincronização com backend:", syncError);
      }
      
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
      } else if (error.code === 'permission-denied') {
        errorMessage = "Permissão negada. Por favor, entre em contato com o administrador.";
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