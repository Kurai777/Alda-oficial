/**
 * Script de Teste para Correção de Imagens
 * 
 * Este script testa a funcionalidade de correção de imagens em um catálogo,
 * garantindo que cada produto tenha sua própria imagem única.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// Obter o diretório atual usando ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurações
const CATALOG_ID = 4; // ID do catálogo a ser testado
const BASE_URL = 'http://localhost:5000';

async function runTest() {
  try {
    console.log(`Iniciando teste de correção de imagens para catálogo ${CATALOG_ID}...`);
    
    // Verificar diretórios de imagens
    const uploadsDir = path.join(__dirname, 'uploads');
    const extractedDir = path.join(uploadsDir, 'extracted_images');
    const uniqueImagesDir = path.join(uploadsDir, 'unique-product-images', `catalog-${CATALOG_ID}`);
    
    console.log('Verificando diretórios...');
    
    if (!fs.existsSync(uploadsDir)) {
      console.log(`Diretório uploads não encontrado: ${uploadsDir}`);
      return;
    }
    
    if (!fs.existsSync(extractedDir)) {
      console.log(`Diretório de imagens extraídas não encontrado: ${extractedDir}`);
      // Tentar localizar outros diretórios com imagens
      const possibleDirs = [
        path.join(uploadsDir, 'users', '1', 'catalogs', String(CATALOG_ID), 'extracted_images'),
        path.join(uploadsDir, 'excel-images'),
        path.join(uploadsDir, 'temp-excel-images')
      ];
      
      let found = false;
      for (const dir of possibleDirs) {
        if (fs.existsSync(dir)) {
          console.log(`Encontrado diretório alternativo: ${dir}`);
          found = true;
          break;
        }
      }
      
      if (!found) {
        console.log('Nenhum diretório com imagens extraídas encontrado.');
      }
    } else {
      console.log(`Diretório de imagens extraídas encontrado: ${extractedDir}`);
      // Contar imagens
      const extractedImages = fs.readdirSync(extractedDir)
        .filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file));
      console.log(`Encontradas ${extractedImages.length} imagens extraídas.`);
    }
    
    // Verificar diretório de destino para imagens únicas
    if (fs.existsSync(uniqueImagesDir)) {
      console.log(`Diretório de imagens únicas encontrado: ${uniqueImagesDir}`);
      // Contar imagens antes da correção
      const uniqueImages = fs.readdirSync(uniqueImagesDir)
        .filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file));
      console.log(`Já existem ${uniqueImages.length} imagens únicas.`);
    } else {
      console.log(`Diretório de imagens únicas não encontrado: ${uniqueImagesDir}`);
      console.log('Será criado durante o processo de correção.');
    }
    
    // Buscar produtos do catálogo para verificação
    console.log('Buscando produtos do catálogo...');
    const productsResponse = await fetch(`${BASE_URL}/api/products?catalogId=${CATALOG_ID}`);
    
    if (!productsResponse.ok) {
      console.error(`Erro ao buscar produtos: ${productsResponse.status} ${productsResponse.statusText}`);
      return;
    }
    
    const products = await productsResponse.json();
    console.log(`Encontrados ${products.length} produtos no catálogo.`);
    
    // Verificar URLs de imagem antes da correção
    console.log('Verificando URLs de imagem antes da correção...');
    const urlsAntes = products.map(p => p.imageUrl);
    const urlsUnicas = new Set(urlsAntes.filter(Boolean));
    console.log(`URLs únicas antes da correção: ${urlsUnicas.size} (de ${urlsAntes.filter(Boolean).length} produtos com imagem)`);
    
    // Iniciar correção de imagens
    console.log('Iniciando processo de correção de imagens...');
    const fixResponse = await fetch(`${BASE_URL}/api/fix-catalog-images/${CATALOG_ID}`, {
      method: 'POST'
    });
    
    if (!fixResponse.ok) {
      console.error(`Erro na correção de imagens: ${fixResponse.status} ${fixResponse.statusText}`);
      const errorText = await fixResponse.text();
      console.error(`Detalhes: ${errorText}`);
      return;
    }
    
    const fixResult = await fixResponse.json();
    console.log('Resultado da correção:');
    console.log(JSON.stringify(fixResult, null, 2));
    
    // Verificar produtos após correção
    console.log('Buscando produtos após a correção...');
    const updatedProductsResponse = await fetch(`${BASE_URL}/api/products?catalogId=${CATALOG_ID}`);
    
    if (!updatedProductsResponse.ok) {
      console.error(`Erro ao buscar produtos atualizados: ${updatedProductsResponse.status}`);
      return;
    }
    
    const updatedProducts = await updatedProductsResponse.json();
    
    // Verificar URLs de imagem após correção
    console.log('Verificando URLs de imagem após a correção...');
    const urlsDepois = updatedProducts.map(p => p.imageUrl && p.imageUrl.split('?')[0]); // Remover parâmetros de query
    const urlsUnicasDepois = new Set(urlsDepois.filter(Boolean));
    console.log(`URLs únicas depois da correção: ${urlsUnicasDepois.size} (de ${urlsDepois.filter(Boolean).length} produtos com imagem)`);
    
    // Verificar se imagens únicas foram criadas
    if (fs.existsSync(uniqueImagesDir)) {
      const uniqueImagesAfter = fs.readdirSync(uniqueImagesDir)
        .filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file));
      console.log(`Agora existem ${uniqueImagesAfter.length} imagens únicas no diretório.`);
    }
    
    console.log('Teste concluído!');
  } catch (error) {
    console.error('Erro durante o teste:', error);
  }
}

runTest();