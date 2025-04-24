const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Instalar dependências necessárias para o PaddleOCR
 */
function installPaddleDependencies() {
  console.log('Instalando dependências para o PaddleOCR...');
  
  // Verificar se Python está instalado
  const pythonProcess = spawn('python', ['--version']);
  
  pythonProcess.on('error', (err) => {
    console.error('Erro ao verificar instalação do Python:', err);
    console.error('Certifique-se de que o Python está instalado e no PATH');
    process.exit(1);
  });
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`Versão do Python: ${data}`);
  });
  
  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`Python não encontrado. Código de saída: ${code}`);
      process.exit(1);
    }
    
    console.log('Python encontrado, instalando dependências...');
    
    // Instalar dependências Python
    const pipProcess = spawn('pip', [
      'install',
      'paddlepaddle',
      'paddleocr',
      'pdf2image',
      'pillow'
    ]);
    
    pipProcess.stdout.on('data', (data) => {
      console.log(`${data}`);
    });
    
    pipProcess.stderr.on('data', (data) => {
      console.error(`${data}`);
    });
    
    pipProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Erro ao instalar dependências Python. Código de saída: ${code}`);
        console.log('Você pode precisar instalar manualmente:');
        console.log('pip install paddlepaddle paddleocr pdf2image pillow');
      } else {
        console.log('Dependências Python instaladas com sucesso!');
      }
      
      // Verificar se poppler está instalado (necessário para pdf2image)
      checkPoppler();
    });
  });
}

/**
 * Verificar se poppler está instalado
 */
function checkPoppler() {
  console.log('Verificando instalação do poppler...');
  
  const popplerProcess = spawn('pdftoppm', ['-v']);
  
  popplerProcess.on('error', () => {
    console.warn('poppler-utils não encontrado. pdf2image precisa do poppler para funcionar.');
    console.warn('No Ubuntu/Debian: sudo apt-get install poppler-utils');
    console.warn('No CentOS/RHEL: sudo yum install poppler-utils');
    console.warn('No Arch Linux: sudo pacman -S poppler');
    console.warn('No macOS: brew install poppler');
    console.warn('No Windows: poppler para Windows pode ser encontrado em https://github.com/oschwartz10612/poppler-windows/releases/');
  });
  
  popplerProcess.stdout.on('data', (data) => {
    console.log(`Versão do poppler: ${data}`);
  });
  
  popplerProcess.stderr.on('data', (data) => {
    console.log(`Versão do poppler: ${data}`);
  });
  
  popplerProcess.on('close', (code) => {
    if (code === 0) {
      console.log('poppler está instalado!');
    } else {
      console.warn('poppler pode não estar instalado corretamente.');
    }
    console.log('Configuração concluída!');
  });
}

// Verificar se o script está sendo executado diretamente
if (require.main === module) {
  installPaddleDependencies();
}

module.exports = {
  installPaddleDependencies
}; 