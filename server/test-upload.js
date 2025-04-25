/**
 * Script para servir a página de teste de upload de Excel e imagens
 * 
 * Este script configura um middleware para Express que serve a página HTML de teste
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Obter o diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminho para a página de teste
const testHtmlPath = path.join(__dirname, '..', 'test-excel-images.html');

/**
 * Adiciona a rota de teste à aplicação Express
 * @param {express.Express} app Aplicação Express
 */
export function addTestRoutes(app) {
  // Servir a página de teste como a rota /test/excel-images
  app.get('/test/excel-images', (req, res) => {
    res.sendFile(testHtmlPath);
  });
  
  console.log('Rotas de teste adicionadas:');
  console.log('- GET /test/excel-images - Página de teste de extração de imagens do Excel');
}