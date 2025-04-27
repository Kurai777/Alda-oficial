/**
 * Configuração do S3 otimizada para ambiente Vercel
 * 
 * Este arquivo contém configurações específicas para usar o Amazon S3
 * em ambiente serverless da Vercel.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { isVercelEnvironment } from './vercel-adapter.js';

// Configuração do cliente S3 com maior timeout para ambiente serverless
export const getS3Client = () => {
  const region = process.env.AWS_REGION || 'us-east-1';
  
  const clientConfig = {
    region,
    // Aumenta o timeout para serverless functions
    requestTimeout: isVercelEnvironment() ? 30000 : 10000,
  };
  
  // Adiciona configurações específicas para a Vercel
  if (isVercelEnvironment()) {
    clientConfig.maxAttempts = 5; // Aumenta o número de tentativas em caso de falha
  }
  
  return new S3Client(clientConfig);
};

// Função para gerar URLs assinadas com tempo de expiração adequado
export const generatePresignedUrl = async (key, operation = 'get', expiresIn = 3600) => {
  const s3Client = getS3Client();
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  
  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME não está definido');
  }
  
  // Verifica se estamos na Vercel para ajustar o tempo de expiração
  if (isVercelEnvironment()) {
    // Na Vercel, usamos um tempo maior para URLs assinadas
    expiresIn = 7200; // 2 horas
  }
  
  let command;
  if (operation === 'get') {
    command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
  } else if (operation === 'put') {
    command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: 'application/octet-stream',
    });
  } else {
    throw new Error(`Operação não suportada: ${operation}`);
  }
  
  try {
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error(`Erro ao gerar URL assinada para ${key}:`, error);
    throw error;
  }
};

// Função para verificar a saúde da conexão com S3
export const checkS3Health = async () => {
  try {
    const testKey = `system/health-check-${Date.now()}.txt`;
    await generatePresignedUrl(testKey, 'put');
    return { status: 'healthy' };
  } catch (error) {
    console.error('Erro na verificação de saúde do S3:', error);
    return { 
      status: 'unhealthy',
      error: error.message 
    };
  }
};