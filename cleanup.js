/**
 * Script de limpeza de arquivos temporários e de upload
 * 
 * Este script limpa arquivos temporários e de upload para
 * reduzir o tamanho do projeto, mantendo apenas a estrutura básica.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

// Obter o diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurações
const DIRS_TO_CLEAN = [
  { path: path.join(__dirname, 'attached_assets'), keep: ['.gitkeep'] },
  { path: path.join(__dirname, 'uploads'), keep: ['.gitkeep'] },
  { path: path.join(__dirname, 'temp'), keep: ['.gitkeep'] }
];

// Configurações da interface de linha de comando
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Função para calcular o tamanho total de um diretório
function getDirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      
      try {
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          size += getDirSize(filePath);
        } else {
          size += stats.size;
        }
      } catch (err) {
        console.error(`Erro ao acessar ${filePath}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`Erro ao ler diretório ${dirPath}:`, err.message);
  }
  
  return size;
}

// Formatar tamanho em bytes para exibição amigável
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// Limpar um diretório específico
async function cleanDirectory(dirConfig) {
  const { path: dirPath, keep } = dirConfig;
  
  console.log(`\nLimpando diretório: ${dirPath}`);
  
  // Verificar se o diretório existe
  if (!fs.existsSync(dirPath)) {
    console.log(`  Diretório não encontrado, criando...`);
    fs.mkdirSync(dirPath, { recursive: true });
    
    // Criar arquivos .gitkeep se necessário
    if (keep.includes('.gitkeep')) {
      const gitkeepPath = path.join(dirPath, '.gitkeep');
      fs.writeFileSync(gitkeepPath, '# Este diretório é necessário para a aplicação');
      console.log(`  Arquivo .gitkeep criado`);
    }
    return { files: 0, size: 0 };
  }
  
  // Calcular tamanho inicial
  const initialSize = getDirSize(dirPath);
  
  // Obter lista de arquivos
  const files = fs.readdirSync(dirPath);
  let deleteCount = 0;
  
  for (const file of files) {
    // Pular arquivos que devem ser mantidos
    if (keep.includes(file)) continue;
    
    const filePath = path.join(dirPath, file);
    
    try {
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Remover diretório e seu conteúdo
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        // Remover arquivo
        fs.unlinkSync(filePath);
      }
      
      deleteCount++;
    } catch (err) {
      console.error(`  Erro ao remover ${filePath}:`, err.message);
    }
  }
  
  // Verificar se diretório existe após a limpeza
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  
  // Garantir que .gitkeep exista (se necessário)
  if (keep.includes('.gitkeep') && !fs.existsSync(path.join(dirPath, '.gitkeep'))) {
    fs.writeFileSync(path.join(dirPath, '.gitkeep'), '# Este diretório é necessário para a aplicação');
  }
  
  // Calcular tamanho final
  const finalSize = getDirSize(dirPath);
  const savedSize = initialSize - finalSize;
  
  console.log(`  Arquivos removidos: ${deleteCount}`);
  console.log(`  Espaço liberado: ${formatBytes(savedSize)}`);
  
  return { files: deleteCount, size: savedSize };
}

// Função principal
async function main() {
  console.log('===== LIMPEZA DE ARQUIVOS TEMPORÁRIOS E UPLOADS =====');
  
  // Calcular tamanho total inicial
  let totalInitialSize = 0;
  for (const dir of DIRS_TO_CLEAN) {
    const dirSize = getDirSize(dir.path);
    totalInitialSize += dirSize;
    console.log(`Diretório: ${dir.path}`);
    console.log(`Tamanho atual: ${formatBytes(dirSize)}`);
  }
  
  console.log(`\nTamanho total a ser processado: ${formatBytes(totalInitialSize)}`);
  
  // Confirmar operação
  if (!process.argv.includes('--force')) {
    rl.question('\nEsta operação irá remover arquivos permanentemente. Continuar? (s/n): ', async (answer) => {
      if (answer.toLowerCase() === 's') {
        await performCleanup();
      } else {
        console.log('Operação cancelada.');
      }
      rl.close();
    });
  } else {
    await performCleanup();
  }
}

// Realizar a limpeza real
async function performCleanup() {
  console.log('\nIniciando limpeza...');
  
  let totalFilesRemoved = 0;
  let totalSizeSaved = 0;
  
  for (const dir of DIRS_TO_CLEAN) {
    const result = await cleanDirectory(dir);
    totalFilesRemoved += result.files;
    totalSizeSaved += result.size;
  }
  
  console.log('\n===== RESUMO DA LIMPEZA =====');
  console.log(`Total de arquivos removidos: ${totalFilesRemoved}`);
  console.log(`Espaço total liberado: ${formatBytes(totalSizeSaved)}`);
  console.log('===============================');
}

// Executar script
main();