import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Variável para armazenar a instância do Firebase Admin
let firebaseApp: admin.app.App;

try {
  // Tentativa de obter a instância já inicializada
  firebaseApp = admin.app();
  console.log("Firebase Admin já inicializado");
} catch (error) {
  try {
    console.log("Inicializando Firebase Admin...");
    
    // Verificar se as credenciais mínimas estão disponíveis
    if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.log("Firebase Admin: credenciais incompletas. Usando modo simulado.");
      
      // Inicializar com configuração mínima
      const dummyApp = admin.initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || "dummy-project"
      });
      
      firebaseApp = dummyApp;
    } else {
      // Inicializar com as credenciais completas
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      
      const serviceAccount = {
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      };
      
      console.log("Credenciais Admin configuradas para:", serviceAccount.projectId);
      
      // Inicialização completa
      const configuredApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        databaseURL: `https://${process.env.VITE_FIREBASE_PROJECT_ID}.firebaseio.com`,
        storageBucket: `${process.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`
      });
      
      firebaseApp = configuredApp;
    }
  } catch (initError) {
    console.error("Erro ao inicializar Firebase Admin:", initError);
    
    // Último recurso - criar app dummy para evitar falhas catastróficas
    try {
      const fallbackApp = admin.initializeApp({ 
        projectId: "fallback-project" 
      }, "fallback-instance");
      
      firebaseApp = fallbackApp;
      console.log("Firebase Admin inicializado em modo de fallback");
    } catch (fallbackError) {
      console.error("Falha completa na inicialização do Firebase Admin:", fallbackError);
      throw new Error("Não foi possível inicializar o Firebase Admin");
    }
  }
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
        
        // Adicionar timestamp e limpar dados para evitar entidades aninhadas inválidas
        const { originalData, ...cleanProduct } = product; // Remover campo originalData que causa problemas
        
        // Remover qualquer propriedade que contenha objetos aninhados complexos
        const sanitizedProduct: any = {};
        for (const [key, value] of Object.entries(cleanProduct)) {
          // Incluir apenas valores simples (string, número, boolean, array simples)
          if (
            typeof value === 'string' || 
            typeof value === 'number' || 
            typeof value === 'boolean' ||
            (Array.isArray(value) && value.every(item => 
              typeof item === 'string' || typeof item === 'number'
            )) ||
            value === null
          ) {
            sanitizedProduct[key] = value;
          } else if (key === 'sizes' && Array.isArray(value)) {
            // Converter tamanhos complexos para formato simples
            sanitizedProduct[key] = value.map(size => {
              if (typeof size === 'object') {
                // Extrair apenas propriedades numéricas ou string
                const { width, height, depth, label } = size;
                return { 
                  width: typeof width === 'number' ? width : null,
                  height: typeof height === 'number' ? height : null, 
                  depth: typeof depth === 'number' ? depth : null,
                  label: typeof label === 'string' ? label : null
                };
              }
              return size;
            });
          }
        }
        
        const productWithTimestamp = {
          ...sanitizedProduct,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          firestoreId: productRef.id, // Armazenar ID do Firestore no próprio documento
          userId: typeof product.userId === 'string' || typeof product.userId === 'number' ? product.userId : null,
          catalogId: typeof product.catalogId === 'string' ? product.catalogId : null,
          imageProcessed: !!product.imageUrl // Marcar se tem imagem processada
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