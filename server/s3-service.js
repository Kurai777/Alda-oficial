/**
 * Serviço AWS S3 para armazenamento escalável em nuvem
 * 
 * Este serviço gerencia todo o armazenamento de arquivos na nuvem usando Amazon S3,
 * com estrutura hierárquica de pastas e gerenciamento eficiente para milhões de usuários.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import multerS3 from 'multer-s3';
import crypto from 'crypto';
import path from 'path';
import mime from 'mime-types';
import fs from 'fs';
import { Readable } from 'stream';

// Mapeamento de regiões comuns (caso o usuário tenha digitado um nome amigável)
const regionMap = {
  'eua-leste-1': 'us-east-1',
  'eua-leste-2': 'us-east-2',
  'eua-oeste-1': 'us-west-1',
  'eua-oeste-2': 'us-west-2',
  'brasil': 'sa-east-1',
  'sao-paulo': 'sa-east-1',
  'europa': 'eu-west-1',
  'london': 'eu-west-2'
};

// Obter região normalizada
function getNormalizedRegion() {
  const configuredRegion = process.env.AWS_REGION;
  
  if (!configuredRegion) {
    console.error('AWS_REGION não está definida');
    return 'us-east-1'; // Região padrão
  }
  
  // Limpar a região (remover espaços e converter para minúsculas)
  const cleanRegion = configuredRegion.trim().toLowerCase();
  
  // Verificar se é um nome amigável e converter
  if (regionMap[cleanRegion]) {
    return regionMap[cleanRegion];
  }
  
  // Verificar se é um código válido de região da AWS (usando um padrão básico)
  const validRegionPattern = /^[a-z]{2}-[a-z]+-\d+$/;
  if (validRegionPattern.test(cleanRegion)) {
    return cleanRegion;
  }
  
  console.warn(`Região AWS '${configuredRegion}' não reconhecida, usando us-east-1 como padrão`);
  return 'us-east-1'; // Região padrão
}

// Inicializar o cliente S3
const s3Client = new S3Client({
  region: getNormalizedRegion(),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME;

// Tipos de arquivos suportados
const SUPPORTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/zip': ['.zip'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif']
};

/**
 * Gera um nome de arquivo único para evitar colisões no S3
 * 
 * @param {string} filename Nome original do arquivo
 * @returns {string} Nome de arquivo único com timestamp
 */
function generateUniqueFilename(filename) {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename);
  const basename = path.basename(filename, ext);
  
  return `${basename}-${timestamp}-${randomString}${ext}`;
}

/**
 * Cria o caminho completo do arquivo no bucket S3 organizado hierarquicamente
 * 
 * @param {string|number} userId ID do usuário
 * @param {string} category Categoria do arquivo (catalogs, products, quotes, etc.)
 * @param {string|number} subId ID opcional (catalogId, productId, etc.)
 * @param {string} filename Nome do arquivo
 * @returns {string} Caminho completo do arquivo no S3
 */
function generateS3Key(userId, category, subId, filename) {
  const userFolder = `users/${userId}`;
  const categoryFolder = category ? `/${category}` : '';
  const subFolder = subId ? `/${subId}` : '';
  const uniqueFilename = generateUniqueFilename(filename);
  
  return `${userFolder}${categoryFolder}${subFolder}/${uniqueFilename}`;
}

/**
 * Configuração do Multer para upload direto para S3
 * 
 * @param {string} category Categoria do arquivo (catalogs, products, quotes, etc.)
 * @returns {Object} Configuração do Multer para upload
 */
export function getS3UploadMiddleware(category) {
  return multer({
    storage: multerS3({
      s3: s3Client,
      bucket: S3_BUCKET,
      acl: 'private', // Acesso privado por padrão
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: function (req, file, cb) {
        cb(null, {
          userId: req.body.userId || req.session?.userId || '0',
          category: category
        });
      },
      key: function (req, file, cb) {
        const userId = req.body.userId || req.session?.userId || '0';
        const subId = req.body.subId || req.body.catalogId || req.body.quoteId || '';
        const s3Key = generateS3Key(userId, category, subId, file.originalname);
        cb(null, s3Key);
      }
    }),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB limite de tamanho
    },
    fileFilter: function (req, file, cb) {
      // Verificar se o tipo de arquivo é suportado
      const mime = file.mimetype;
      const isSupported = Object.keys(SUPPORTED_FILE_TYPES).includes(mime) ||
                           Object.values(SUPPORTED_FILE_TYPES).flat().includes(path.extname(file.originalname));
      
      if (isSupported) {
        cb(null, true);
      } else {
        cb(new Error(`Tipo de arquivo não suportado: ${mime}`), false);
      }
    }
  });
}

/**
 * Upload de um buffer para o S3
 * 
 * @param {Buffer} buffer Buffer do arquivo
 * @param {string} filename Nome do arquivo
 * @param {string|number} userId ID do usuário
 * @param {string} category Categoria do arquivo
 * @param {string|number} subId ID opcional (catalogId, productId, etc.)
 * @returns {Promise<string>} URL do arquivo no S3
 */
export async function uploadBufferToS3(buffer, filename, userId, category, subId) {
  try {
    const s3Key = generateS3Key(userId, category, subId, filename);
    const contentType = mime.lookup(filename) || 'application/octet-stream';
    
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'private'
    });
    
    await s3Client.send(command);
    
    return s3Key;
  } catch (error) {
    console.error('Erro ao fazer upload para S3:', error);
    throw error;
  }
}

/**
 * Upload de um arquivo local para o S3
 * 
 * @param {string} filePath Caminho do arquivo local
 * @param {string|number} userId ID do usuário
 * @param {string} category Categoria do arquivo
 * @param {string|number} subId ID opcional (catalogId, productId, etc.)
 * @returns {Promise<string>} URL do arquivo no S3
 */
export async function uploadFileToS3(filePath, userId, category, subId) {
  try {
    const filename = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    
    return await uploadBufferToS3(fileBuffer, filename, userId, category, subId);
  } catch (error) {
    console.error('Erro ao fazer upload de arquivo para S3:', error);
    throw error;
  }
}

/**
 * Migra arquivos de um diretório local para o S3
 * 
 * @param {string} localDir Diretório local
 * @param {string|number} userId ID do usuário
 * @param {string} category Categoria do arquivo
 * @param {string|number} subId ID opcional (catalogId, productId, etc.)
 * @returns {Promise<Object>} Resultado da migração com contadores
 */
export async function migrateDirectoryToS3(localDir, userId, category, subId) {
  try {
    if (!fs.existsSync(localDir)) {
      return { success: false, message: 'Diretório local não encontrado', uploaded: 0, failed: 0 };
    }
    
    const files = fs.readdirSync(localDir);
    const results = {
      success: true,
      uploaded: 0,
      failed: 0,
      fileMap: {} // Mapear nome de arquivo local para chave S3
    };
    
    for (const file of files) {
      try {
        const filePath = path.join(localDir, file);
        const s3Key = await uploadFileToS3(filePath, userId, category, subId);
        
        results.uploaded++;
        results.fileMap[file] = s3Key;
      } catch (error) {
        console.error(`Erro ao migrar arquivo ${file}:`, error);
        results.failed++;
      }
    }
    
    return results;
  } catch (error) {
    console.error('Erro ao migrar diretório para S3:', error);
    throw error;
  }
}

/**
 * Gera URL assinada para acesso temporário a um arquivo
 * 
 * @param {string} s3Key Chave do arquivo no S3
 * @param {number} expiresIn Tempo de expiração em segundos (padrão: 3600s = 1h)
 * @returns {Promise<string>} URL assinada para acesso ao arquivo
 */
export async function getSignedFileUrl(s3Key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Erro ao gerar URL assinada:', error);
    throw error;
  }
}

/**
 * Exclui um arquivo do S3
 * 
 * @param {string} s3Key Chave do arquivo no S3
 * @returns {Promise<boolean>} Sucesso da operação
 */
export async function deleteFileFromS3(s3Key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });
    
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Erro ao excluir arquivo do S3:', error);
    throw error;
  }
}

/**
 * Verifica se um arquivo existe no S3
 * 
 * @param {string} s3Key Chave do arquivo no S3
 * @returns {Promise<boolean>} Verdadeiro se o arquivo existe
 */
export async function fileExistsInS3(s3Key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });
    
    await s3Client.send(command);
    return true;
  } catch (error) {
    // 404 significa que o arquivo não existe
    if (error.name === 'NotFound') {
      return false;
    }
    
    // Qualquer outro erro é um problema na verificação
    console.error('Erro ao verificar arquivo no S3:', error);
    throw error;
  }
}

/**
 * Baixa um arquivo do S3 como um buffer
 * 
 * @param {string} s3Key Chave do arquivo no S3
 * @returns {Promise<Buffer>} Buffer do arquivo
 */
export async function downloadFileFromS3(s3Key) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });
    
    const response = await s3Client.send(command);
    
    // Converter o stream para buffer
    return await streamToBuffer(response.Body);
  } catch (error) {
    console.error('Erro ao baixar arquivo do S3:', error);
    throw error;
  }
}

/**
 * Converte um stream para buffer
 * 
 * @param {ReadableStream} stream Stream para converter
 * @returns {Promise<Buffer>} Buffer resultante
 */
async function streamToBuffer(stream) {
  const chunks = [];
  
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  
  return Buffer.concat(chunks);
}

/**
 * Verifica a integridade da configuração do S3
 * 
 * @returns {Promise<Object>} Status da configuração
 */
export async function checkS3Configuration() {
  try {
    // Verificar se todas as variáveis de ambiente necessárias estão presentes
    const requiredEnvVars = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'AWS_S3_BUCKET_NAME'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      return {
        status: 'error',
        message: `Variáveis de ambiente ausentes: ${missingVars.join(', ')}`,
        missingVars
      };
    }
    
    // Tentar listar o bucket para verificar a conexão
    const TEST_KEY = `test-${Date.now()}.txt`;
    const TEST_CONTENT = 'Teste de conexão com S3';
    
    // Upload de teste
    await uploadBufferToS3(
      Buffer.from(TEST_CONTENT),
      TEST_KEY,
      'system',
      'tests',
      'config-check'
    );
    
    // Excluir arquivo de teste
    await deleteFileFromS3(`system/tests/config-check/${TEST_KEY}`);
    
    return {
      status: 'success',
      message: 'Configuração do S3 validada com sucesso',
      bucket: S3_BUCKET,
      region: process.env.AWS_REGION
    };
  } catch (error) {
    console.error('Erro ao verificar configuração do S3:', error);
    
    return {
      status: 'error',
      message: `Erro de conexão com S3: ${error.message}`,
      error: error.code || error.name
    };
  }
}