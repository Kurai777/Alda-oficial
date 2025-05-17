#!/bin/bash

echo "==== Iniciando sincronização e reinicialização do servidor ===="

# Limpar módulos compilados que podem estar em cache
echo "Limpando caches..."
find . -name "*.js.map" -type f -delete
find . -name "*.js" -type f -path "./server/*" -delete
find ./node_modules -name "*.cache" -type d -exec rm -rf {} +

# Reiniciar completamente o servidor
echo "Reiniciando o servidor com arquivos atualizados..."
pkill -f "tsx server/index.ts" || true
pkill -f "node" || true

sleep 2

# Iniciar o servidor com os arquivos atualizados
NODE_ENV=development tsx server/index.ts