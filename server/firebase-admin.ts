import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializar o Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
      // A private key precisa substituir '\n' por newlines reais
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    databaseURL: `https://${process.env.VITE_FIREBASE_PROJECT_ID}.firebaseio.com`
  });
}

// Exportar instâncias
export const firebaseAdmin = admin;
export const auth = admin.auth();
export const adminDb = getFirestore();

// Helpers
export async function verifyIdToken(token: string) {
  try {
    return await auth.verifyIdToken(token);
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return null;
  }
}