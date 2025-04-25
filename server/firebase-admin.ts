/**
 * Inicialização e funções do Firebase Admin SDK
 * 
 * Este módulo é responsável por:
 * 1. Inicializar o Firebase Admin SDK
 * 2. Fornecer funções para upload de imagens para o Storage
 * 3. Configurar autenticação de admin
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Verificar se as variáveis de ambiente necessárias estão definidas
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.VITE_FIREBASE_PROJECT_ID;

// Inicializar Admin SDK se as credenciais estão disponíveis
if (!admin.apps.length && clientEmail && privateKey && projectId) {
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
  // Verificar se o Firebase Admin foi inicializado
  if (!admin.apps.length) {
    console.error('Firebase Admin não inicializado. Impossível fazer upload.');
    return null;
  }
  
  try {
    // Obter referência para o bucket
    const bucket = admin.storage().bucket();
    
    // Determinar o caminho completo para o arquivo
    const filePath = `catalogs/${userId}/${catalogId}/${fileName}`;
    
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
    
  } catch (error) {
    console.error('Erro ao salvar imagem no Firebase Storage:', error);
    return null;
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