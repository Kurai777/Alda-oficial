import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Verificar se as variáveis de ambiente estão disponíveis
const hasFirebaseConfig = 
  typeof import.meta.env !== 'undefined' && 
  import.meta.env.VITE_FIREBASE_API_KEY && 
  import.meta.env.VITE_FIREBASE_PROJECT_ID &&
  import.meta.env.VITE_FIREBASE_APP_ID;

// Configuração do Firebase com fallback para desenvolvimento
const firebaseConfig = hasFirebaseConfig ? {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
} : {
  // Configuração temporária para desenvolvimento - não conecta a nenhum projeto real
  apiKey: "dev-temp-key",
  authDomain: "dev-project.firebaseapp.com",
  projectId: "dev-project-id",
  storageBucket: "dev-project-id.appspot.com",
  appId: "dev-app-id",
};

console.log("Firebase Configurado:", hasFirebaseConfig ? "Com credenciais reais" : "Com valores temporários para desenvolvimento");

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Exportar instâncias para uso em toda a aplicação
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

export default app;