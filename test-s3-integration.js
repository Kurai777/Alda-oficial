/**
 * Script de teste para integração com Amazon S3
 * 
 * Este script verifica a configuração do S3, testa upload e download,
 * e analisa o funcionamento das URLs assinadas.
 */

import { 
  checkS3Configuration, 
  uploadBufferToS3, 
  fileExistsInS3,
  getSignedFileUrl,
  deleteFileFromS3,
  downloadFileFromS3
} from './server/s3-service.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// Obter diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Função para mostrar resultados formatados
function logResult(testName, status, message, details = null) {
  const statusEmoji = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : '❌';
  
  console.log(`\n${statusEmoji} ${testName}`);
  console.log(`   ${message}`);
  
  if (details) {
    console.log('   Details:', typeof details === 'string' ? details : JSON.stringify(details, null, 2));
  }
}

// Gerar um ID de teste único
const testId = `test-${Date.now()}`;

async function runTests() {
  console.log('=== INICIANDO TESTES DE INTEGRAÇÃO COM S3 ===');
  
  // TESTE 1: Verificar configuração do S3
  let s3Config;
  try {
    s3Config = await checkS3Configuration();
    
    if (s3Config.status === 'success') {
      logResult(
        'Configuração S3', 
        'success',
        `Conectado ao bucket ${s3Config.bucket} na região ${s3Config.region}`
      );
    } else {
      logResult(
        'Configuração S3', 
        'error',
        'Falha na conexão com S3',
        s3Config.message
      );
      // Se S3 não estiver disponível, abortar os testes
      return;
    }
  } catch (configError) {
    logResult(
      'Configuração S3', 
      'error',
      'Erro ao verificar configuração do S3',
      configError.message
    );
    return;
  }
  
  // TESTE 2: Fazer upload de uma imagem de teste
  let uploadedS3Key;
  try {
    // Criar uma imagem simples para testar
    const testImagePath = path.join(__dirname, 'test-image.png');
    
    // Se não existir, abortar
    if (!fs.existsSync(testImagePath)) {
      logResult(
        'Upload de imagem', 
        'error',
        'Imagem de teste não encontrada',
        testImagePath
      );
      return;
    }
    
    // Ler a imagem como buffer
    const imageBuffer = fs.readFileSync(testImagePath);
    
    // Fazer upload para o S3
    uploadedS3Key = await uploadBufferToS3(
      imageBuffer,
      `test-image-${testId}.png`,
      'test',
      'integration-tests',
      testId
    );
    
    logResult(
      'Upload de imagem', 
      'success',
      'Imagem enviada com sucesso para o S3',
      { s3Key: uploadedS3Key }
    );
  } catch (uploadError) {
    logResult(
      'Upload de imagem', 
      'error',
      'Erro ao fazer upload da imagem',
      uploadError.message
    );
    return;
  }
  
  // TESTE 3: Verificar se o arquivo existe no S3
  try {
    const fileExists = await fileExistsInS3(uploadedS3Key);
    
    if (fileExists) {
      logResult(
        'Verificação de arquivo', 
        'success',
        'Arquivo encontrado no S3'
      );
    } else {
      logResult(
        'Verificação de arquivo', 
        'error',
        'Arquivo não encontrado no S3',
        { s3Key: uploadedS3Key }
      );
      return;
    }
  } catch (existsError) {
    logResult(
      'Verificação de arquivo', 
      'error',
      'Erro ao verificar existência do arquivo',
      existsError.message
    );
    return;
  }
  
  // TESTE 4: Obter URL assinada e tentar acessar
  let signedUrl;
  try {
    signedUrl = await getSignedFileUrl(uploadedS3Key, 60); // 60 segundos de validade
    
    logResult(
      'URL Assinada', 
      'success',
      'URL assinada gerada com sucesso',
      { url: signedUrl }
    );
    
    // Tentar acessar a URL assinada
    const response = await fetch(signedUrl);
    
    if (response.ok) {
      logResult(
        'Acesso à URL assinada', 
        'success',
        `Status: ${response.status}`,
        { contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') }
      );
    } else {
      logResult(
        'Acesso à URL assinada', 
        'error',
        `Falha ao acessar URL (Status ${response.status})`,
        await response.text()
      );
    }
  } catch (urlError) {
    logResult(
      'URL Assinada', 
      'error',
      'Erro ao gerar ou acessar URL assinada',
      urlError.message
    );
  }
  
  // TESTE 5: Download do arquivo do S3
  try {
    const fileBuffer = await downloadFileFromS3(uploadedS3Key);
    
    if (fileBuffer && fileBuffer.length > 0) {
      logResult(
        'Download do arquivo', 
        'success',
        'Arquivo baixado com sucesso',
        { sizeBytes: fileBuffer.length }
      );
    } else {
      logResult(
        'Download do arquivo', 
        'error',
        'Arquivo vazio ou nulo'
      );
    }
  } catch (downloadError) {
    logResult(
      'Download do arquivo', 
      'error',
      'Erro ao baixar arquivo',
      downloadError.message
    );
  }
  
  // TESTE 6: Excluir arquivo de teste
  try {
    const deleteResult = await deleteFileFromS3(uploadedS3Key);
    
    logResult(
      'Exclusão do arquivo', 
      deleteResult ? 'success' : 'error',
      deleteResult ? 'Arquivo excluído com sucesso' : 'Falha ao excluir arquivo'
    );
    
    // Verificar se o arquivo realmente foi excluído
    const stillExists = await fileExistsInS3(uploadedS3Key);
    
    if (!stillExists) {
      logResult(
        'Verificação pós-exclusão', 
        'success',
        'Confirmação: arquivo não existe mais no S3'
      );
    } else {
      logResult(
        'Verificação pós-exclusão', 
        'error',
        'Arquivo ainda existe no S3 após exclusão'
      );
    }
  } catch (deleteError) {
    logResult(
      'Exclusão do arquivo', 
      'error',
      'Erro durante a exclusão do arquivo',
      deleteError.message
    );
  }
  
  console.log('\n=== TESTES DE INTEGRAÇÃO COM S3 CONCLUÍDOS ===');
}

// Executar todos os testes
runTests().catch(error => {
  console.error('Erro fatal nos testes:', error);
});