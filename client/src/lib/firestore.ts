import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  DocumentData,
  QueryDocumentSnapshot
} from "firebase/firestore";
import { db } from "./firebase";
import { User } from "./auth";

// Interface para dados completos do usuário (incluindo campos opcionais do Firestore)
export interface UserData extends User {
  // Campos adicionais do Firestore
  name?: string;
  phone?: string;
  address?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Constantes para coleções
const COLLECTIONS = {
  USERS: 'users',
};

/**
 * Obtém os dados completos do usuário de Firestore
 * @param userId ID do usuário no Firebase
 * @returns Dados completos do usuário ou null se não encontrado
 */
export async function getUserData(userId: string): Promise<UserData | null> {
  try {
    const userDocRef = doc(db, COLLECTIONS.USERS, userId);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      return userDoc.data() as UserData;
    }
    
    return null;
  } catch (error) {
    console.error("Erro ao buscar dados do usuário:", error);
    throw error;
  }
}

/**
 * Cria ou atualiza os dados do usuário no Firestore
 * @param userData Dados do usuário para salvar
 * @returns Promise void
 */
export async function saveUserData(userData: Partial<UserData> & { uid: string }): Promise<void> {
  try {
    const { uid, ...restData } = userData;
    const userDocRef = doc(db, COLLECTIONS.USERS, uid);
    const userDoc = await getDoc(userDocRef);
    
    const dataToSave = {
      ...restData,
      updatedAt: serverTimestamp(),
    };
    
    if (userDoc.exists()) {
      // Atualizar documento existente
      await updateDoc(userDocRef, dataToSave);
    } else {
      // Criar novo documento
      await setDoc(userDocRef, {
        ...dataToSave,
        uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error("Erro ao salvar dados do usuário:", error);
    throw error;
  }
}

/**
 * Busca um usuário pelo email
 * @param email Email do usuário
 * @returns Dados do usuário ou null se não encontrado
 */
export async function getUserByEmail(email: string): Promise<UserData | null> {
  try {
    const usersCollection = collection(db, COLLECTIONS.USERS);
    const q = query(usersCollection, where("email", "==", email));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return null;
    }
    
    // Retornar o primeiro documento que corresponde ao email
    const userDoc = querySnapshot.docs[0];
    return userDoc.data() as UserData;
  } catch (error) {
    console.error("Erro ao buscar usuário por email:", error);
    throw error;
  }
}