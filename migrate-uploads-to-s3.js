/**
 * Script para migrar arquivos da pasta uploads para o Amazon S3
 * 
 * Este script analisa todos os arquivos da pasta uploads,
 * envia-os para o Amazon S3 e opcionalmente remove os originais.
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { createReadStream } = require('fs');
const crypto = require('crypto');

// Configuração AWS
const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'catalogos-ald-a';
const USER_ID = process.env.MIGRATION_USER_ID || 'system';

// Cliente S3
const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

// Diretório de uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DELETE_AFTER_UPLOAD = process.argv.includes('--delete');

// Cache para evitar duplicação de uploads
let processedFiles = {};

/**
 * Calcula um hash MD5 para um arquivo
 */
async function calculateMD5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', error => reject(error));
  });
}

/**
 * Verifica se um arquivo já existe no S3
 */
async function fileExistsInS3(s3Key) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Envia um arquivo para o S3
 */
async function uploadFileToS3(filePath, s3Key, contentType) {
  const fileStream = createReadStream(filePath);
  const fileSize = fs.statSync(filePath).size;
  
  const uploadParams = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileStream,
    ContentType: contentType,
    ContentLength: fileSize
  };

  try {
    const result = await s3Client.send(new PutObjectCommand(uploadParams));
    return {
      success: true,
      key: s3Key,
      etag: result.ETag
    };
  } catch (error) {
    console.error(`Erro ao enviar ${filePath} para o S3:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Obtém o tipo de conteúdo (MIME) com base na extensão do arquivo
 */
function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.json': 'application/json',
    '.txt': 'text/plain'
  };
  return contentTypes[extension] || 'application/octet-stream';
}

/**
 * Gera uma chave S3 para o arquivo
 */
function generateS3Key(filePath, userId, fileHash) {
  const fileName = path.basename(filePath);
  const timestamp = Date.now();
  const randomPart = fileHash.substring(0, 16);
  
  // Determinar subdiretório baseado no tipo de arquivo
  const extension = path.extname(filePath).toLowerCase();
  let subDir = 'other';
  
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) {
    subDir = 'images';
  } else if (extension === '.pdf') {
    subDir = 'pdfs';
  } else if (['.xlsx', '.xls'].includes(extension)) {
    subDir = 'spreadsheets';
  }
  
  return `users/${userId}/uploads/${subDir}/${timestamp}/${fileName}`;
}

/**
 * Processa recursivamente um diretório
 */
async function processDirectory(dirPath, results = { success: 0, skipped: 0, failed: 0, total: 0 }) {
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      await processDirectory(filePath, results);
    } else {
      results.total++;
      console.log(`Processando (${results.total}): ${filePath}`);
      
      try {
        // Calcular hash do arquivo para verificar duplicação
        const fileHash = await calculateMD5(filePath);
        
        // Verificar se já processamos um arquivo idêntico
        if (processedFiles[fileHash]) {
          console.log(`  → Arquivo duplicado, já processado anteriormente como ${processedFiles[fileHash]}`);
          results.skipped++;
          continue;
        }
        
        // Gerar chave S3
        const s3Key = generateS3Key(filePath, USER_ID, fileHash);
        processedFiles[fileHash] = s3Key;
        
        // Verificar se já existe no S3
        const exists = await fileExistsInS3(s3Key);
        if (exists) {
          console.log(`  → Arquivo já existe no S3 como ${s3Key}`);
          results.skipped++;
          continue;
        }
        
        // Enviar para o S3
        const contentType = getContentType(filePath);
        const uploadResult = await uploadFileToS3(filePath, s3Key, contentType);
        
        if (uploadResult.success) {
          console.log(`  → Enviado para S3: ${s3Key}`);
          results.success++;
          
          // Remover arquivo original se a opção estiver habilitada
          if (DELETE_AFTER_UPLOAD) {
            fs.unlinkSync(filePath);
            console.log(`  → Arquivo local removido`);
          }
        } else {
          console.error(`  → Falha no upload: ${uploadResult.error}`);
          results.failed++;
        }
      } catch (error) {
        console.error(`  → Erro ao processar ${filePath}:`, error);
        results.failed++;
      }
    }
  }
  
  // Remover diretórios vazios se a opção estiver habilitada
  if (DELETE_AFTER_UPLOAD) {
    try {
      const remainingFiles = fs.readdirSync(dirPath);
      if (remainingFiles.length === 0 && dirPath !== UPLOADS_DIR) {
        fs.rmdirSync(dirPath);
        console.log(`Diretório vazio removido: ${dirPath}`);
      }
    } catch (error) {
      console.error(`Erro ao verificar/remover diretório ${dirPath}:`, error);
    }
  }
  
  return results;
}

/**
 * Função principal
 */
async function main() {
  console.log('=== INICIANDO MIGRAÇÃO DE ARQUIVOS PARA O S3 ===');
  console.log(`Diretório de origem: ${UPLOADS_DIR}`);
  console.log(`Bucket S3 de destino: ${BUCKET_NAME}`);
  console.log(`Região AWS: ${REGION}`);
  console.log(`Excluir após upload: ${DELETE_AFTER_UPLOAD ? 'SIM' : 'NÃO'}`);
  console.log('=============================================');
  
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.error(`O diretório de uploads ${UPLOADS_DIR} não existe!`);
    process.exit(1);
  }
  
  try {
    const startTime = Date.now();
    const results = await processDirectory(UPLOADS_DIR);
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('=============================================');
    console.log('=== MIGRAÇÃO CONCLUÍDA ===');
    console.log(`Total de arquivos processados: ${results.total}`);
    console.log(`Arquivos enviados com sucesso: ${results.success}`);
    console.log(`Arquivos ignorados (já existem): ${results.skipped}`);
    console.log(`Arquivos com falha: ${results.failed}`);
    console.log(`Tempo total: ${duration.toFixed(2)} segundos`);
    console.log('=============================================');
  } catch (error) {
    console.error('Erro durante a migração:', error);
    process.exit(1);
  }
}

// Executar script
main();