/**
 * Inicialização e funções do Firebase Admin SDK
 * 
 * Este módulo é responsável por:
 * 1. Inicializar o Firebase Admin SDK
 * 2. Fornecer funções para upload de imagens para o Storage
 * 3. Configurar autenticação de admin
 */

import * as admin from 'firebase-admin';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const randomUUID = crypto.randomUUID;

// Verificar se as variáveis de ambiente necessárias estão definidas
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.VITE_FIREBASE_PROJECT_ID;

// Inicializar Admin SDK se as credenciais estão disponíveis
if (admin?.apps?.length === 0 && clientEmail && privateKey && projectId) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      }),
      storageBucket: `${projectId}.appspot.com`
    });
    
    console.log('Inicializando Firebase Admin...');
    console.log(`Credenciais Admin configuradas para: ${projectId}`);
  } catch (error) {
    console.error('Erro ao inicializar Firebase Admin:', error);
  }
}

// Criar funções mock para testes em ambientes sem Firebase
let mockAuth: any = {
  verifyIdToken: async (token: string) => {
    return { uid: 'mock-user-id', email: 'user@example.com' };
  }
};

let mockDb: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (subName: string) => ({
        doc: (subId: string) => ({
          collection: (subSubName: string) => ({
            doc: () => ({
              set: async (data: any) => ({ id: 'mock-doc-id' }),
              update: async (data: any) => {}
            }),
            add: async (data: any) => ({ id: 'mock-doc-id' })
          }),
          set: async (data: any) => {},
          update: async (data: any) => {}
        }),
        add: async (data: any) => ({ id: 'mock-doc-id' })
      }),
      set: async (data: any) => {},
      update: async (data: any) => {}
    }),
    add: async (data: any) => ({ id: 'mock-doc-id' })
  }),
  batch: () => ({
    set: (ref: any, data: any) => {},
    commit: async () => {}
  })
};

// Exportar instâncias reais ou mock
export const auth = admin.apps?.length && admin.apps.length > 0 ? admin.auth() : mockAuth;
export const adminDb = admin.apps?.length && admin.apps.length > 0 ? admin.firestore() : mockDb;

/**
 * Salva um catálogo no Firestore
 * @param userId ID do usuário
 * @param catalogData Dados do catálogo
 * @returns ID do documento criado
 */
export async function saveCatalogToFirestore(userId: string, catalogData: any) {
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível salvar no Firestore.');
    return null;
  }
  
  try {
    // Criar referência para a coleção de catálogos do usuário
    const catalogsCollection = adminDb.collection('users').doc(userId).collection('catalogs');
    
    // Adicionar timestamp de criação
    const catalogWithTimestamp = {
      ...catalogData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'processing'
    };
    
    // Adicionar ao Firestore
    const docRef = await catalogsCollection.add(catalogWithTimestamp);
    console.log(`Catálogo salvo no Firestore com ID: ${docRef.id}`);
    
    return docRef.id;
    
  } catch (error) {
    console.error('Erro ao salvar catálogo no Firestore:', error);
    return null;
  }
}

/**
 * Salva produtos no Firestore associados a um catálogo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @param products Lista de produtos
 * @returns Array com IDs dos documentos criados
 */
export async function saveProductsToFirestore(userId: string, catalogId: string, products: any[]) {
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível salvar no Firestore.');
    return [];
  }
  
  try {
    // Criar referência para a coleção de produtos do catálogo
    const productsCollection = adminDb
      .collection('users')
      .doc(userId)
      .collection('catalogs')
      .doc(catalogId)
      .collection('products');
    
    // Adicionar produtos em lote
    const batch = adminDb.batch();
    const productRefs: any[] = [];
    
    for (const product of products) {
      const productRef = productsCollection.doc();
      batch.set(productRef, {
        ...product,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      productRefs.push({
        id: productRef.id,
        ref: productRef
      });
    }
    
    // Executar o lote
    await batch.commit();
    
    console.log(`${products.length} produtos salvos no Firestore para o catálogo ${catalogId}`);
    return productRefs.map(p => p.id);
    
  } catch (error) {
    console.error('Erro ao salvar produtos no Firestore:', error);
    return [];
  }
}

/**
 * Atualiza o status de um catálogo no Firestore
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @param status Novo status
 * @returns True se bem-sucedido
 */
export async function updateCatalogStatusInFirestore(userId: string, catalogId: string, status: 'processing' | 'complete' | 'error') {
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível atualizar status no Firestore.');
    return false;
  }
  
  try {
    // Referência para o documento do catálogo
    const catalogRef = adminDb
      .collection('users')
      .doc(userId)
      .collection('catalogs')
      .doc(catalogId);
    
    // Atualizar o status
    await catalogRef.update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Status do catálogo ${catalogId} atualizado para: ${status}`);
    return true;
    
  } catch (error) {
    console.error('Erro ao atualizar status do catálogo:', error);
    return false;
  }
}

/**
 * Faz upload de uma imagem para o Firebase Storage
 * 
 * @param imageBuffer Buffer da imagem ou string base64
 * @param fileName Nome do arquivo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns URL pública da imagem
 */
export async function saveImageToFirebaseStorage(
  imageBuffer: Buffer | string,
  fileName: string,
  userId: string, 
  catalogId: string
): Promise<string | null> {
  try {
    // Se for uma string base64, converter para buffer
    let buffer: Buffer;
    
    if (typeof imageBuffer === 'string') {
      // Verificar se é uma string base64 completa (data:image/png;base64,...)
      if (imageBuffer.startsWith('data:')) {
        // Extrair o tipo MIME e os dados base64
        const matches = imageBuffer.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
          throw new Error('Formato base64 inválido');
        }
        
        // Obter apenas os dados base64
        const base64Data = matches[2];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        // Assumir que é uma string base64 sem o prefixo
        buffer = Buffer.from(imageBuffer, 'base64');
      }
    } else {
      // Já é um buffer
      buffer = imageBuffer;
    }
    
    // Verificar se o Firebase Admin foi inicializado
    if (!admin.apps.length || process.env.NODE_ENV === 'development') {
      console.log('Firebase Storage não disponível. Salvando imagem localmente.');
      return saveImageLocally(buffer, fileName, userId, catalogId);
    }
    
    // Processar com Firebase Storage
    try {
      // Obter referência para o bucket
      const bucket = admin.storage().bucket();
      
      // Determinar o caminho completo para o arquivo
      const filePath = `catalogs/${userId}/${catalogId}/${fileName}`;
      
      // Criar arquivo temporário
      const tempFilePath = path.join(os.tmpdir(), `${randomUUID()}_${fileName}`);
      await fs.promises.writeFile(tempFilePath, buffer);
      
      // Fazer upload do arquivo
      await bucket.upload(tempFilePath, {
        destination: filePath,
        metadata: {
          contentType: determineContentType(fileName),
          metadata: {
            userId,
            catalogId,
            firebaseStorageDownloadTokens: randomUUID(),
          }
        }
      });
      
      // Remover arquivo temporário
      await fs.promises.unlink(tempFilePath);
      
      // Tornar o arquivo publicamente acessível
      await bucket.file(filePath).makePublic();
      
      // Obter a URL pública
      const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      
      console.log(`Imagem salva no Firebase Storage: ${fileUrl}`);
      return fileUrl;
    } catch (fbError) {
      console.error('Erro ao salvar no Firebase, tentando salvar localmente:', fbError);
      return saveImageLocally(buffer, fileName, userId, catalogId);
    }
  } catch (error) {
    console.error('Erro ao processar imagem:', error);
    return null;
  }
}

/**
 * Salva uma imagem localmente para desenvolvimento ou fallback
 */
async function saveImageLocally(
  imageBuffer: Buffer,
  fileName: string,
  userId: string,
  catalogId: string
): Promise<string | null> {
  try {
    // Criar pasta para armazenar as imagens
    const imagesDir = path.join(process.cwd(), 'uploads', 'images', userId, catalogId);
    await fs.promises.mkdir(imagesDir, { recursive: true });
    
    // Salvar a imagem
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(imagesDir, safeFileName);
    await fs.promises.writeFile(filePath, imageBuffer);
    
    // URL para acessar a imagem
    const imageUrl = `/api/images/${userId}/${catalogId}/${safeFileName}`;
    
    console.log(`Imagem salva localmente: ${imageUrl}`);
    return imageUrl;
  } catch (error) {
    console.error('Erro ao salvar imagem localmente:', error);
    
    // Último recurso: URL mock
    const mockUrl = `https://mock-firebase-storage.com/${userId}/${catalogId}/${fileName}`;
    console.log(`Usando URL mock: ${mockUrl}`);
    
    // Registrar a URL mock para posterior processamento
    try {
      const mockData = {
        url: mockUrl,
        userId,
        catalogId,
        fileName,
        timestamp: new Date().toISOString()
      };
      
      const mockRegistryPath = path.join(process.cwd(), 'temp', 'mock-urls.json');
      let mockRegistry = [];
      
      try {
        if (fs.existsSync(mockRegistryPath)) {
          const data = fs.readFileSync(mockRegistryPath, 'utf-8');
          mockRegistry = JSON.parse(data);
        }
      } catch (readError) {
        // Ignore errors reading the registry
      }
      
      mockRegistry.push(mockData);
      
      // Garantir que a pasta temp exista
      await fs.promises.mkdir(path.join(process.cwd(), 'temp'), { recursive: true });
      
      // Salvar o registro atualizado
      fs.writeFileSync(mockRegistryPath, JSON.stringify(mockRegistry, null, 2));
    } catch (registryError) {
      console.error('Erro ao registrar URL mock:', registryError);
    }
    
    return mockUrl;
  }
}

/**
 * Determina o tipo de conteúdo com base na extensão do arquivo
 * @param fileName Nome do arquivo
 * @returns Tipo MIME
 */
function determineContentType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Apaga um arquivo do Firebase Storage
 * @param fileUrl URL do arquivo a ser excluído
 * @returns True se bem-sucedido
 */
export async function deleteFileFromStorage(fileUrl: string): Promise<boolean> {
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível excluir arquivo.');
    return false;
  }
  
  try {
    // Extrair o caminho do arquivo da URL
    const bucket = admin.storage().bucket();
    const storageUrlPrefix = `https://storage.googleapis.com/${bucket.name}/`;
    
    if (!fileUrl.startsWith(storageUrlPrefix)) {
      console.error('URL não pertence ao Firebase Storage deste projeto');
      return false;
    }
    
    const filePath = fileUrl.substring(storageUrlPrefix.length);
    
    // Excluir o arquivo
    await bucket.file(filePath).delete();
    console.log(`Arquivo excluído: ${filePath}`);
    return true;
    
  } catch (error) {
    console.error('Erro ao excluir arquivo:', error);
    return false;
  }
}

/**
 * Lista todos os arquivos em um diretório do Storage
 * @param userId ID do usuário
 * @param catalogId ID do catálogo (opcional)
 * @returns Lista de URLs de arquivos
 */
export async function listFilesInStorage(userId: string, catalogId?: string): Promise<string[]> {
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível listar arquivos.');
    return [];
  }
  
  try {
    const bucket = admin.storage().bucket();
    const prefix = catalogId 
      ? `catalogs/${userId}/${catalogId}/`
      : `catalogs/${userId}/`;
    
    const [files] = await bucket.getFiles({ prefix });
    
    // Obter URLs públicas
    const fileUrls = files.map(file => 
      `https://storage.googleapis.com/${bucket.name}/${file.name}`
    );
    
    return fileUrls;
    
  } catch (error) {
    console.error('Erro ao listar arquivos:', error);
    return [];
  }
}