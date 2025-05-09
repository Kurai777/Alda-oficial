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
        // Corrigindo problema com os headers sendo arrays ao invés de strings
        const metadata = {
          userId: String(req.body.userId || req.session?.userId || '0'),
          category: String(category || 'uncategorized')
        };
        cb(null, metadata);
      },
      key: function (req, file, cb) {
        const userId = req.body.userId || req.session?.userId || '0';
        const subId = req.body.subId || req.body.catalogId || req.body.quoteId || '';
        const s3Key = generateS3Key(userId, category, subId, file.originalname);
        console.log(`Gerando chave S3: ${s3Key} para arquivo ${file.originalname}`);
        cb(null, s3Key);
      }
    }),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB limite de tamanho
    },
    fileFilter: function (req, file, cb) {
      try {
        // Verificar se o tipo de arquivo é suportado
        const mimeType = file.mimetype;
        const fileExtension = path.extname(file.originalname).toLowerCase();
        
        const isSupported = Object.keys(SUPPORTED_FILE_TYPES).includes(mimeType) ||
                           Object.values(SUPPORTED_FILE_TYPES).flat().includes(fileExtension);
        
        if (isSupported) {
          cb(null, true);
        } else {
          console.warn(`Tipo de arquivo não suportado: ${mimeType} (${fileExtension})`);
          cb(new Error(`Tipo de arquivo não suportado: ${mimeType}`), false);
        }
      } catch (error) {
        console.error("Erro ao validar arquivo:", error);
        cb(error, false);
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
    
    // Sanitização de valores para evitar problemas de tipo
    const params = {
      Bucket: String(S3_BUCKET),
      Key: String(s3Key),
      Body: buffer,
      ContentType: String(contentType)
    };
    
    const command = new PutObjectCommand(params);
    
    console.log(`Enviando arquivo para S3: ${s3Key} (${formatBytes(buffer.length)})`);
    await s3Client.send(command);
    console.log(`Upload concluído para: ${s3Key}`);
    
    // Construir a URL pública completa
    const publicUrl = `https://${S3_BUCKET}.s3.${getNormalizedRegion()}.amazonaws.com/${s3Key}`;
    return publicUrl; // Retorna a URL completa
  } catch (error) {
    console.error('Erro ao fazer upload para S3:', error, error.stack);
    throw error;
  }
}

// Função auxiliar para formatar tamanho de arquivo
function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
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
    console.log(`[downloadFileFromS3] Tentando baixar ${s3Key}...`);
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key
    });
    
    const response = await s3Client.send(command);
    
    // Verificar se response.Body existe e é um stream legível
    if (!response.Body || typeof response.Body.pipe !== 'function') { 
        console.error(`[downloadFileFromS3] Corpo da resposta S3 inválido ou ausente para ${s3Key}.`);
        throw new Error(`Corpo da resposta S3 inválido para ${s3Key}`);
    }
    
    console.log(`[downloadFileFromS3] Stream recebido para ${s3Key}, convertendo para buffer...`);
    // Converter o stream para buffer
    const buffer = await streamToBuffer(response.Body);
    console.log(`[downloadFileFromS3] Buffer criado para ${s3Key} (Tamanho: ${buffer.length})`);
    return buffer; // Retornar o buffer diretamente

  } catch (error) {
    // Logar erro específico de S3 (ex: NoSuchKey)
    console.error(`[downloadFileFromS3] Erro ao baixar arquivo ${s3Key} do S3:`, error);
    // Lançar erro para ser pego pela função chamadora (getBase64ImageFromS3)
    throw error; 
  }
}

/**
 * Converte um stream para buffer
 * TRATAMENTO DE ERRO ADICIONADO
 */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk)));
      stream.on('error', (err) => {
          console.error("[streamToBuffer] Erro durante leitura do stream:", err);
          reject(err); // Rejeitar a promessa em caso de erro no stream
      });
      stream.on('end', () => {
          console.log("[streamToBuffer] Stream lido com sucesso.");
          resolve(Buffer.concat(chunks)); // Resolver com o buffer concatenado
      });
  });
}

/**
 * Obtém a imagem do S3 como string base64
 * 
 * @param {string} imageUrl URL ou chave S3 da imagem
 * @returns {Promise<string>} String base64 da imagem
 */
export async function getBase64ImageFromS3(imageUrl) {
  try {
    let s3Key;
    
    if (!imageUrl || typeof imageUrl !== 'string') {
        console.error('[getBase64] URL da imagem inválida ou nula:', imageUrl);
        return null;
    }

    if (imageUrl.startsWith('http')) {
      // URL Completa: Remover https://[bucket].[region].amazonaws.com/
      try {
          const url = new URL(imageUrl);
          // O pathname começa com /, então removemos ele e juntamos o resto
          s3Key = decodeURIComponent(url.pathname.substring(1)); 
          console.log(`[getBase64] Chave S3 extraída da URL (${imageUrl}): ${s3Key}`);
      } catch (urlError) {
          console.error(`[getBase64] Erro ao parsear URL ${imageUrl}:`, urlError);
          return null;
      }
    } else {
      // Assumir que já é a chave S3
      s3Key = imageUrl;
      console.log(`[getBase64] Usando URL como chave S3 direta: ${s3Key}`);
    }
    
    if (!s3Key) {
      console.error('[getBase64] Falha final ao determinar a chave S3.');
      return null;
    }
    
    console.log(`[getBase64] Obtendo imagem do S3 usando chave final: ${s3Key}`);
    
    // Baixar o arquivo do S3
    console.log(`[getBase64] Chamando downloadFileFromS3 para ${s3Key}...`);
    const buffer = await downloadFileFromS3(s3Key); 
    console.log(`[getBase64] downloadFileFromS3 retornou tipo: ${typeof buffer}, é Buffer? ${Buffer.isBuffer(buffer)}`);
    
    // <<< ADICIONAR CHECK ANTES DE USAR >>>
    if (!buffer || !Buffer.isBuffer(buffer)) {
      console.error(`[getBase64] Falha no download ou retorno inválido de downloadFileFromS3 para ${s3Key}. Recebido:`, buffer);
      return null;
    }
    
    // Converter para base64
    console.log(`[getBase64] Convertendo buffer para base64 para ${s3Key}...`);
    const base64String = buffer.toString('base64');
    console.log(`[getBase64] Conversão ok para ${s3Key}.`);
    // Determinar mime type para prefixo data:image
    let mimeType = 'image/jpeg'; 
    if (s3Key.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (s3Key.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
    else if (s3Key.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';
    
    return `data:${mimeType};base64,${base64String}`;

  } catch (error) {
    // <<< ADICIONAR LOG NO CATCH >>>
    console.error(`[getBase64] Erro GERAL ao obter/processar imagem do S3 (${imageUrl || 'URL Nula'}):`, error);
    return null;
  }
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