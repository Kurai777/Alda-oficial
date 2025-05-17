#!/bin/bash

echo "Atualizando código a partir do GitHub..."
git pull origin main

echo "Iniciando a aplicação..."
npm run dev