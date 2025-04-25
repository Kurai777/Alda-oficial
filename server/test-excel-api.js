/**
 * API de teste para extração de imagens do Excel
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { processExcelFile } from './excel-processor.js';
import { hasExcelImages as jsHasImages, extractImagesFromExcel as jsExtractImages } from './robust-excel-image-extractor.js';
import { hasExcelImagesWithPython as pythonHasImages, extractImagesWithPythonBridge as pythonExtractImages } from './python-excel-bridge.js';

// Obter diretório atual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar upload
const upload = multer({
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

/**
 * Obter uma amostra de produtos para exibição
 * @param {Array} products Lista de produtos
 * @param {number} count Quantidade de produtos na amostra
 * @returns Array de produtos simplificados
 */
function getSampleProducts(products, count = 3) {
  // Pegar uma amostra aleatória de produtos
  const sample = products.length <= count 
    ? products 
    : products
        .sort(() => 0.5 - Math.random())
        .slice(0, count);
  
  // Simplificar os produtos para exibição
  return sample.map(product => {
    const { name, code, price, imageUrl } = product;
    return { name, code, price, imageUrl };
  });
}

/**
 * Adiciona rotas de API de teste à aplicação Express
 * @param {import('express').Express} app Aplicação Express
 */
export function addTestApiRoutes(app) {
  // Rota para testar extração de imagens do Excel
  app.post('/api/test/excel-images', upload.single('file'), async (req, res) => {
    try {
      // Verificar se foi enviado um arquivo
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;

      console.log(`Processando arquivo para teste: ${fileName}`);
      console.log(`Caminho temporário: ${filePath}`);

      // Resultados do teste
      const results = {
        fileName,
        products: {
          count: 0,
          sample: []
        },
        jsCheck: {
          hasImages: false,
          method: 'JavaScript'
        },
        pythonCheck: {
          hasImages: false,
          method: 'Python'
        },
        extraction: null // Será preenchido se houver imagens
      };

      // Extrair produtos para verificar associação
      try {
        console.log('Extraindo produtos do arquivo...');
        const products = await processExcelFile(filePath);
        
        results.products.count = products.length;
        results.products.sample = getSampleProducts(products);
        
        console.log(`Extraídos ${products.length} produtos do arquivo Excel`);

        // Tentar detectar imagens com JavaScript
        const jsCheck = await jsHasImages(filePath).catch(err => {
          console.error('Erro ao verificar imagens com JavaScript:', err);
          return false;
        });
        
        results.jsCheck.hasImages = jsCheck;
        console.log(`Verificação JS: ${jsCheck ? 'Contém imagens' : 'Não contém imagens'}`);

        // Tentar detectar imagens com Python
        const pyCheck = await pythonHasImages(filePath).catch(err => {
          console.error('Erro ao verificar imagens com Python:', err);
          return false;
        });
        
        results.pythonCheck.hasImages = pyCheck;
        console.log(`Verificação Python: ${pyCheck ? 'Contém imagens' : 'Não contém imagens'}`);

        // Se foi detectada imagem em qualquer método, tentar extrair
        if (jsCheck || pyCheck) {
          results.extraction = {
            js: null,
            python: null
          };
          
          // Tentar extrair com JavaScript
          if (jsCheck) {
            try {
              console.log('Extraindo imagens com JavaScript...');
              const jsProducts = await jsExtractImages(filePath, products, '1', 'test');
              
              // Contar produtos com imagem
              const productsWithImages = jsProducts.filter(p => p.imageUrl);
              
              // Coletar URLs de amostra
              const sampleUrls = productsWithImages
                .slice(0, 3)
                .map(p => p.imageUrl)
                .filter(Boolean);
              
              results.extraction.js = {
                success: true,
                extractedCount: productsWithImages.length,
                sampleUrls
              };
              
              console.log(`JavaScript extraiu ${productsWithImages.length} imagens`);
            } catch (error) {
              console.error('Erro ao extrair imagens com JavaScript:', error);
              results.extraction.js = {
                success: false,
                error: error.message || 'Erro na extração JavaScript'
              };
            }
          }
          
          // Tentar extrair com Python
          if (pyCheck) {
            try {
              console.log('Extraindo imagens com Python...');
              const pyProducts = await pythonExtractImages(filePath, products, '1', 'test');
              
              // Contar produtos com imagem
              const productsWithImages = pyProducts.filter(p => p.imageUrl);
              
              // Coletar URLs de amostra
              const sampleUrls = productsWithImages
                .slice(0, 3)
                .map(p => p.imageUrl)
                .filter(Boolean);
              
              results.extraction.python = {
                success: true,
                extractedCount: productsWithImages.length,
                sampleUrls
              };
              
              console.log(`Python extraiu ${productsWithImages.length} imagens`);
            } catch (error) {
              console.error('Erro ao extrair imagens com Python:', error);
              results.extraction.python = {
                success: false,
                error: error.message || 'Erro na extração Python'
              };
            }
          }
        }

      } catch (error) {
        console.error('Erro ao processar produtos do Excel:', error);
        return res.status(500).json({ 
          error: 'Falha ao processar produtos do arquivo Excel',
          details: error.message
        });
      }

      return res.status(200).json({ 
        message: 'Arquivo processado com sucesso',
        results
      });
    } catch (error) {
      console.error('Erro na rota de teste:', error);
      return res.status(500).json({ 
        error: 'Falha no servidor',
        details: error.message
      });
    }
  });

  console.log('API de teste adicionada:');
  console.log('- POST /api/test/excel-images - API para testar extração de imagens do Excel');
}