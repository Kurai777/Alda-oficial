import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializar o Firebase Admin com as credenciais do ambiente
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  client_id: process.env.FIREBASE_CLIENT_ID || "",
  auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
  token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || "",
};

// Inicializar o app do Firebase se ainda não foi inicializado
let firebaseApp: admin.app.App;

try {
  firebaseApp = admin.app();
} catch (error) {
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
  });
}

// Exportar a instância do Firestore
export const adminDb = getFirestore(firebaseApp);
export const auth = admin.auth(firebaseApp);
export const storage = admin.storage(firebaseApp);

// Função para salvar um catálogo no Firestore
export async function saveCatalogToFirestore(catalog: any, userId: string | number): Promise<string> {
  try {
    // Converter userId para string se for número
    const userIdStr = typeof userId === 'number' ? userId.toString() : userId;
    
    // Referência à coleção de catálogos do usuário
    const catalogsRef = adminDb.collection('users').doc(userIdStr).collection('catalogs');
    
    // Adicionar timestamp
    const catalogWithTimestamp = {
      ...catalog,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Adicionar o documento e obter referência
    const docRef = await catalogsRef.add(catalogWithTimestamp);
    console.log(`Catálogo salvo no Firestore com ID: ${docRef.id}`);
    
    return docRef.id;
  } catch (error) {
    console.error('Erro ao salvar catálogo no Firestore:', error);
    throw new Error('Falha ao salvar catálogo no Firestore');
  }
}

// Função para salvar produtos em lote no Firestore
export async function saveProductsToFirestore(products: any[], userId: string | number, catalogId: string): Promise<string[]> {
  try {
    // Converter userId para string se for número
    const userIdStr = typeof userId === 'number' ? userId.toString() : userId;
    
    // Referência à coleção de produtos do catálogo
    const productsRef = adminDb.collection('users').doc(userIdStr)
                              .collection('catalogs').doc(catalogId)
                              .collection('products');
    
    // Usar o lote do Firestore para operações em massa (até 500 operações por lote)
    const batch = adminDb.batch();
    const productIds: string[] = [];
    
    // Dividir os produtos em lotes de no máximo 450 para evitar limites do Firestore
    const MAX_BATCH_SIZE = 450;
    
    // Função para processar um lote de produtos
    const processBatch = async (productsBatch: any[]) => {
      const batchIds: string[] = [];
      const currentBatch = adminDb.batch();
      
      for (const product of productsBatch) {
        // Criar um novo ID de documento
        const productRef = productsRef.doc();
        batchIds.push(productRef.id);
        
        // Adicionar timestamp
        const productWithTimestamp = {
          ...product,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          firestoreId: productRef.id // Armazenar ID do Firestore no próprio documento
        };
        
        // Adicionar ao lote
        currentBatch.set(productRef, productWithTimestamp);
      }
      
      // Executar o lote
      await currentBatch.commit();
      
      return batchIds;
    };
    
    // Processar produtos em lotes
    if (products.length <= MAX_BATCH_SIZE) {
      // Se houver poucos produtos, processar em um único lote
      productIds.push(...await processBatch(products));
    } else {
      // Se houver muitos produtos, dividir em lotes menores
      const batches = [];
      for (let i = 0; i < products.length; i += MAX_BATCH_SIZE) {
        batches.push(products.slice(i, i + MAX_BATCH_SIZE));
      }
      
      // Processar cada lote sequencialmente (evitar sobrecarga)
      for (const batch of batches) {
        const batchIds = await processBatch(batch);
        productIds.push(...batchIds);
      }
    }
    
    console.log(`${products.length} produtos salvos no Firestore para o catálogo: ${catalogId}`);
    
    return productIds;
  } catch (error) {
    console.error('Erro ao salvar produtos no Firestore:', error);
    throw new Error('Falha ao salvar produtos no Firestore');
  }
}

// Função para atualizar o status de um catálogo no Firestore
export async function updateCatalogStatusInFirestore(
  userId: string | number, 
  catalogId: string, 
  status: string, 
  productCount?: number
): Promise<void> {
  try {
    // Converter userId para string se for número
    const userIdStr = typeof userId === 'number' ? userId.toString() : userId;
    
    // Referência ao documento do catálogo
    const catalogRef = adminDb.collection('users').doc(userIdStr)
                            .collection('catalogs').doc(catalogId);
    
    // Dados a atualizar
    const updateData: any = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Adicionar contagem de produtos se fornecida
    if (productCount !== undefined) {
      updateData.productCount = productCount;
    }
    
    // Atualizar o documento
    await catalogRef.update(updateData);
    
    console.log(`Status do catálogo ${catalogId} atualizado para: ${status}`);
  } catch (error) {
    console.error('Erro ao atualizar status do catálogo no Firestore:', error);
    throw new Error('Falha ao atualizar status do catálogo');
  }
}

export default {
  adminDb,
  auth,
  storage,
  saveCatalogToFirestore,
  saveProductsToFirestore,
  updateCatalogStatusInFirestore
};