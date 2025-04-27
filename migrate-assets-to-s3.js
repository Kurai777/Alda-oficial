/**
 * Script para migrar arquivos da pasta attached_assets para o Amazon S3
 * 
 * Este script é otimizado especificamente para a pasta de assets anexados,
 * processando-os adequadamente e enviando para o S3.
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

// Diretório de assets
const ASSETS_DIR = path.join(__dirname, 'attached_assets');
const DELETE_AFTER_UPLOAD = process.argv.includes('--delete');
const IGNORE_EXTENSIONS = ['.txt'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Cache para evitar duplicação de uploads
let processedFiles = {};
let stats = {
  success: 0,
  skipped: 0,
  tooLarge: 0,
  ignored: 0,
  failed: 0,
  total: 0,
  totalSize: 0,
  uploadedSize: 0
};

/**
 * Formata tamanho em bytes para exibição amigável
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

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
      etag: result.ETag,
      size: fileSize
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
  let subDir = 'assets';
  
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) {
    subDir = 'images';
  } else if (extension === '.pdf') {
    subDir = 'pdfs';
  } else if (['.xlsx', '.xls'].includes(extension)) {
    subDir = 'spreadsheets';
  }
  
  return `users/${userId}/assets/${subDir}/${fileName}`;
}

/**
 * Deve ignorar um arquivo com base em seu tipo ou outros critérios
 */
function shouldIgnoreFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return IGNORE_EXTENSIONS.includes(extension);
}

/**
 * Processa um único arquivo
 */
async function processFile(filePath) {
  stats.total++;
  
  try {
    // Verificar tamanho do arquivo
    const fileStats = fs.statSync(filePath);
    stats.totalSize += fileStats.size;
    
    if (shouldIgnoreFile(filePath)) {
      console.log(`  → Ignorando (extensão): ${filePath}`);
      stats.ignored++;
      return;
    }
    
    if (fileStats.size > MAX_FILE_SIZE) {
      console.log(`  → Arquivos muito grande (${formatBytes(fileStats.size)}): ${filePath}`);
      stats.tooLarge++;
      return;
    }
    
    // Calcular hash do arquivo para verificar duplicação
    const fileHash = await calculateMD5(filePath);
    
    // Verificar se já processamos um arquivo idêntico
    if (processedFiles[fileHash]) {
      console.log(`  → Arquivo duplicado, já processado anteriormente como ${processedFiles[fileHash]}`);
      stats.skipped++;
      return;
    }
    
    // Gerar chave S3
    const s3Key = generateS3Key(filePath, USER_ID, fileHash);
    processedFiles[fileHash] = s3Key;
    
    // Verificar se já existe no S3
    const exists = await fileExistsInS3(s3Key);
    if (exists) {
      console.log(`  → Arquivo já existe no S3 como ${s3Key}`);
      stats.skipped++;
      return;
    }
    
    // Enviar para o S3
    const contentType = getContentType(filePath);
    const uploadResult = await uploadFileToS3(filePath, s3Key, contentType);
    
    if (uploadResult.success) {
      console.log(`  → Enviado para S3: ${s3Key} (${formatBytes(fileStats.size)})`);
      stats.success++;
      stats.uploadedSize += fileStats.size;
      
      // Remover arquivo original se a opção estiver habilitada
      if (DELETE_AFTER_UPLOAD) {
        fs.unlinkSync(filePath);
        console.log(`  → Arquivo local removido`);
      }
    } else {
      console.error(`  → Falha no upload: ${uploadResult.error}`);
      stats.failed++;
    }
  } catch (error) {
    console.error(`  → Erro ao processar ${filePath}:`, error);
    stats.failed++;
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('=== INICIANDO MIGRAÇÃO DE ASSETS PARA O S3 ===');
  console.log(`Diretório de origem: ${ASSETS_DIR}`);
  console.log(`Bucket S3 de destino: ${BUCKET_NAME}`);
  console.log(`Região AWS: ${REGION}`);
  console.log(`Excluir após upload: ${DELETE_AFTER_UPLOAD ? 'SIM' : 'NÃO'}`);
  console.log('=============================================');
  
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`O diretório de assets ${ASSETS_DIR} não existe!`);
    process.exit(1);
  }
  
  try {
    const startTime = Date.now();

    // Obter lista de todos os arquivos
    const files = fs.readdirSync(ASSETS_DIR)
      .filter(file => !fs.statSync(path.join(ASSETS_DIR, file)).isDirectory())
      .sort(); // Ordenar para melhor legibilidade nos logs
    
    console.log(`Encontrados ${files.length} arquivos para processamento`);
    
    // Processar cada arquivo
    let count = 0;
    for (const file of files) {
      count++;
      const filePath = path.join(ASSETS_DIR, file);
      console.log(`Processando (${count}/${files.length}): ${file}`);
      await processFile(filePath);
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log('=============================================');
    console.log('=== MIGRAÇÃO CONCLUÍDA ===');
    console.log(`Total de arquivos processados: ${stats.total}`);
    console.log(`Arquivos enviados com sucesso: ${stats.success}`);
    console.log(`Arquivos ignorados (extensão): ${stats.ignored}`);
    console.log(`Arquivos muito grandes (>10MB): ${stats.tooLarge}`);
    console.log(`Arquivos duplicados/já existentes: ${stats.skipped}`);
    console.log(`Arquivos com falha: ${stats.failed}`);
    console.log(`Tamanho total processado: ${formatBytes(stats.totalSize)}`);
    console.log(`Tamanho total enviado: ${formatBytes(stats.uploadedSize)}`);
    console.log(`Tempo total: ${duration.toFixed(2)} segundos`);
    console.log('=============================================');
  } catch (error) {
    console.error('Erro durante a migração:', error);
    process.exit(1);
  }
}

// Executar script
main();