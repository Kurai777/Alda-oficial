/**
 * Script para limpeza de assets não utilizados
 * 
 * Este script remove arquivos temporários da pasta attached_assets que não são 
 * necessários para o funcionamento da aplicação, reduzindo o tamanho do projeto.
 */

const fs = require('fs');
const path = require('path');

// Diretório de assets
const ASSETS_DIR = path.join(__dirname, 'attached_assets');

// Execução em modo de teste (não deleta arquivos) por padrão
const DRY_RUN = !process.argv.includes('--force');

// Formato para exibição de tamanho em bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// Função principal
async function main() {
  console.log('=== LIMPEZA DE ASSETS INICIADA ===');
  console.log(`Diretório: ${ASSETS_DIR}`);
  console.log(`Modo: ${DRY_RUN ? 'Simulação (não deleta arquivos)' : 'DELETANDO ARQUIVOS'}`);
  console.log('Para executar a limpeza real, use: node clean-assets.js --force');
  console.log('=============================================');

  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`O diretório ${ASSETS_DIR} não existe!`);
    process.exit(1);
  }

  try {
    const files = fs.readdirSync(ASSETS_DIR);
    
    let totalFiles = 0;
    let totalSize = 0;
    let deletedFiles = 0;
    let deletedSize = 0;
    let keptFiles = 0;
    let keptSize = 0;

    // Lista de arquivos ou padrões para manter
    // Você pode personalizar esta lista com os arquivos que deseja manter
    const KEEP_PATTERNS = [
      '.gitkeep', // Manter este arquivo para preservar a pasta no git
      // Adicione outros padrões de arquivo que deseja manter
    ];

    // Função para verificar se um arquivo deve ser mantido
    function shouldKeepFile(filename) {
      // Se houver um padrão que corresponda ao nome do arquivo, mantê-lo
      return KEEP_PATTERNS.some(pattern => {
        if (pattern.includes('*')) {
          // Lógica para padrões com curinga
          const regexPattern = pattern.replace('*', '.*');
          return new RegExp(regexPattern).test(filename);
        } else {
          // Correspondência exata
          return filename === pattern;
        }
      });
    }

    for (const file of files) {
      const filePath = path.join(ASSETS_DIR, file);
      
      // Ignorar diretórios
      if (fs.statSync(filePath).isDirectory()) {
        console.log(`Ignorando diretório: ${file}`);
        continue;
      }
      
      const fileSize = fs.statSync(filePath).size;
      totalFiles++;
      totalSize += fileSize;
      
      // Verificar se o arquivo deve ser mantido
      const keep = shouldKeepFile(file);
      
      if (keep) {
        console.log(`Mantendo: ${file} (${formatBytes(fileSize)})`);
        keptFiles++;
        keptSize += fileSize;
      } else {
        console.log(`${DRY_RUN ? 'Simulando remoção' : 'Removendo'}: ${file} (${formatBytes(fileSize)})`);
        deletedFiles++;
        deletedSize += fileSize;
        
        // Deletar o arquivo apenas se não estiver em modo de simulação
        if (!DRY_RUN) {
          fs.unlinkSync(filePath);
        }
      }
    }
    
    console.log('=============================================');
    console.log('=== RESUMO DA LIMPEZA ===');
    console.log(`Total de arquivos processados: ${totalFiles} (${formatBytes(totalSize)})`);
    console.log(`Arquivos mantidos: ${keptFiles} (${formatBytes(keptSize)})`);
    console.log(`Arquivos ${DRY_RUN ? 'marcados para remoção' : 'removidos'}: ${deletedFiles} (${formatBytes(deletedSize)})`);
    console.log(`Espaço economizado: ${formatBytes(deletedSize)}`);
    
    if (DRY_RUN) {
      console.log('\nEste foi apenas um teste. Para remover os arquivos realmente, execute:');
      console.log('node clean-assets.js --force');
    }
    
    console.log('=============================================');
  } catch (error) {
    console.error('Erro durante a limpeza:', error);
    process.exit(1);
  }
}

// Executar script
main();