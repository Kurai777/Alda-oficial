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
  QueryDocumentSnapshot,
  orderBy
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

// Interface para produtos do Firestore
export interface FirestoreProduct {
  id?: string;
  firestoreId?: string;
  name: string;
  description?: string;
  code?: string;
  price: number;
  category?: string;
  colors?: string[];
  materials?: string[];
  sizes?: any[];
  imageUrl?: string;
  userId?: string | number;
  catalogId?: string | number;
  createdAt?: any;
  updatedAt?: any;
}

// Constantes para coleções
const COLLECTIONS = {
  USERS: 'users',
  CATALOGS: 'catalogs',
  PRODUCTS: 'products',
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

/**
 * Busca produtos de um catálogo específico no Firestore
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns Lista de produtos
 */
export async function getProductsByFirestoreCatalogId(userId: string, catalogId: string): Promise<FirestoreProduct[]> {
  try {
    console.log(`Buscando produtos no Firestore para userId=${userId} e catalogId=${catalogId}`);
    const userDocRef = doc(db, COLLECTIONS.USERS, userId);
    const catalogDocRef = doc(db, `${COLLECTIONS.USERS}/${userId}/${COLLECTIONS.CATALOGS}`, catalogId);
    const productsCollection = collection(db, `${COLLECTIONS.USERS}/${userId}/${COLLECTIONS.CATALOGS}/${catalogId}/${COLLECTIONS.PRODUCTS}`);
    
    const q = query(productsCollection, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.log("Nenhum produto encontrado no Firestore");
      return [];
    }
    
    const products: FirestoreProduct[] = [];
    querySnapshot.forEach((doc) => {
      const productData = doc.data() as FirestoreProduct;
      products.push({
        ...productData,
        firestoreId: doc.id
      });
    });
    
    console.log(`Encontrados ${products.length} produtos no Firestore`);
    return products;
  } catch (error) {
    console.error("Erro ao buscar produtos no Firestore:", error);
    return [];
  }
}

/**
 * Busca todos os catálogos de um usuário no Firestore
 * @param userId ID do usuário
 * @returns Lista de catálogos
 */
export async function getCatalogsByFirestoreUserId(userId: string): Promise<any[]> {
  try {
    const catalogsCollection = collection(db, `${COLLECTIONS.USERS}/${userId}/${COLLECTIONS.CATALOGS}`);
    
    const q = query(catalogsCollection, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return [];
    }
    
    const catalogs: any[] = [];
    querySnapshot.forEach((doc) => {
      catalogs.push({
        ...doc.data(),
        firestoreId: doc.id
      });
    });
    
    return catalogs;
  } catch (error) {
    console.error("Erro ao buscar catálogos no Firestore:", error);
    return [];
  }
}