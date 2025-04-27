#!/bin/bash
# Script para limpar rapidamente a pasta attached_assets
# Preserva apenas o arquivo .gitkeep

echo "===== LIMPEZA DE ARQUIVOS TEMPORÁRIOS ====="
echo "Este script irá remover todos os arquivos de attached_assets"
echo "exceto o arquivo .gitkeep"
echo ""

# Contador de arquivos e tamanho
ASSETS_DIR="./attached_assets"
TOTAL_FILES=$(find $ASSETS_DIR -type f | grep -v ".gitkeep" | wc -l)
TOTAL_SIZE=$(du -sh $ASSETS_DIR | cut -f1)

echo "Diretório: $ASSETS_DIR"
echo "Total de arquivos a remover: $TOTAL_FILES"
echo "Tamanho atual: $TOTAL_SIZE"
echo ""

read -p "Confirmar limpeza? (s/n): " CONFIRM

if [ "$CONFIRM" != "s" ]; then
  echo "Operação cancelada."
  exit 0
fi

echo "Removendo arquivos..."
find $ASSETS_DIR -type f -not -name ".gitkeep" -delete
echo "Limpeza concluída!"

# Mostrar novo tamanho
NEW_SIZE=$(du -sh $ASSETS_DIR | cut -f1)
echo ""
echo "Tamanho após limpeza: $NEW_SIZE"
echo "===== CONCLUÍDO ====="