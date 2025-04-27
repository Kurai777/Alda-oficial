/**
 * Script para limpar rapidamente a pasta attached_assets
 * Mantém apenas o arquivo .gitkeep
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ASSETS_DIR = path.join(__dirname, 'attached_assets');

// Função para calcular o tamanho total de um diretório
function getDirSize(dirPath) {
  let size = 0;
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stats.size;
    }
  }
  
  return size;
}

// Formatar tamanho em bytes para exibição amigável
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// Função principal
async function main() {
  console.log('===== LIMPEZA DE ARQUIVOS TEMPORÁRIOS =====');
  console.log('Este script irá remover todos os arquivos de attached_assets');
  console.log('exceto o arquivo .gitkeep');
  console.log('');
  
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`Diretório ${ASSETS_DIR} não encontrado!`);
    process.exit(1);
  }
  
  // Calcular estatísticas iniciais
  const initialSize = getDirSize(ASSETS_DIR);
  let fileCount = 0;
  
  try {
    // Contar arquivos a serem removidos
    const files = fs.readdirSync(ASSETS_DIR);
    for (const file of files) {
      if (file !== '.gitkeep') {
        fileCount++;
      }
    }
    
    console.log(`Diretório: ${ASSETS_DIR}`);
    console.log(`Total de arquivos a remover: ${fileCount}`);
    console.log(`Tamanho atual: ${formatBytes(initialSize)}`);
    console.log('');
    
    // Modo de uso automatizado
    if (process.argv.includes('--force')) {
      await deleteFiles();
      return;
    }
    
    // Pedir confirmação
    rl.question('Confirmar limpeza? (s/n): ', async (answer) => {
      if (answer.toLowerCase() === 's') {
        await deleteFiles();
      } else {
        console.log('Operação cancelada.');
      }
      rl.close();
    });
  } catch (error) {
    console.error('Erro durante a limpeza:', error);
    rl.close();
    process.exit(1);
  }
  
  // Função para deletar os arquivos
  async function deleteFiles() {
    console.log('Removendo arquivos...');
    
    const files = fs.readdirSync(ASSETS_DIR);
    let deletedCount = 0;
    
    for (const file of files) {
      if (file !== '.gitkeep') {
        const filePath = path.join(ASSETS_DIR, file);
        
        try {
          if (fs.statSync(filePath).isDirectory()) {
            // Remover diretório recursivamente
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            // Remover arquivo
            fs.unlinkSync(filePath);
          }
          deletedCount++;
        } catch (error) {
          console.error(`Erro ao remover ${filePath}:`, error);
        }
      }
    }
    
    // Calcular novo tamanho
    const newSize = getDirSize(ASSETS_DIR);
    const savedSize = initialSize - newSize;
    
    console.log('Limpeza concluída!');
    console.log(`Arquivos removidos: ${deletedCount}`);
    console.log(`Tamanho após limpeza: ${formatBytes(newSize)}`);
    console.log(`Espaço economizado: ${formatBytes(savedSize)}`);
    console.log('===== CONCLUÍDO =====');
  }
}

// Executar script
main();