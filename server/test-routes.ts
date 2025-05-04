/**
 * Rotas de teste para processamento de catálogos
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { storage } from './storage'; // Assuming storage is correctly imported
import { getS3UploadMiddleware, uploadBufferToS3 } from './s3-service.js';
import { convertPdfToImages } from './pdf-ai-pipeline';
import { processImageWithOpenAI, processFileWithAdvancedAI } from './advanced-ai-extractor';
import { generateImagesFromPdf, extractProductImagesFromPdf, associateImagesToProducts } from './alternative-pdf-processor';

// Para utilizar __dirname em módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const mkdir = promisify(fs.mkdir);

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = './uploads';
    try {
      await mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as any, uploadDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  }
});

// Configurar armazenamento para testes
const mockFirebaseStorage = path.join(__dirname, '../temp/mock-firebase');

// Endpoint para testar o processamento de PDF com IA
router.post('/process-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    
    // Extrair userId e catalogId dos parâmetros ou usar valores de teste
    const mockUserId = 'test-user';
    const mockCatalogId = 'test-catalog';
    
    console.log(`Processando arquivo ${fileName} com pipeline de IA...`);
    
    // Processar o PDF com o pipeline completo
    const products = await processFileWithAdvancedAI(
      filePath,
      fileName,
      mockUserId,
      mockCatalogId
    );
    
    res.json({
      success: true,
      productsCount: products.length,
      sampleProducts: products.slice(0, 5)
    });
    
  } catch (error: any) {
    console.error('Erro ao processar PDF:', error);
    res.status(500).json({ 
      error: 'Erro ao processar o arquivo PDF',
      message: error.message 
    });
  }
});

// Endpoint para testar somente a extração de imagens do PDF
router.post('/extract-pdf-images', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    
    // Extrair userId e catalogId dos parâmetros ou usar valores de teste
    const mockUserId = 'test-user';
    const mockCatalogId = 'test-catalog';
    
    console.log(`Extraindo imagens do arquivo ${fileName}...`);
    
    // Gerar imagens das páginas do PDF
    const pageImages = await generateImagesFromPdf(filePath, {
      dpi: 200,
      pagesToProcess: [], // Processar todas as páginas
      outputDir: './temp/pdf-images'
    });
    
    // Extrair imagens específicas dos produtos
    const productImagesMap = await extractProductImagesFromPdf(filePath, mockUserId, mockCatalogId);
    
    // Criar URLs para visualização nas respostas
    const pageImageUrls = pageImages.map((page, index) => {
      const tempPath = `./temp/pdf-images/page_${page.pageNumber}.png`;
      fs.writeFileSync(tempPath, page.buffer);
      return {
        pageNumber: page.pageNumber,
        url: `/temp/pdf-images/page_${page.pageNumber}.png`
      };
    });
    
    res.json({
      success: true,
      totalPages: pageImages.length,
      pageImageUrls: pageImageUrls.slice(0, 3), // Mostrar apenas algumas imagens
      productImagesCount: Object.keys(productImagesMap).length,
      productImagesMap: Object.fromEntries(
        Object.entries(productImagesMap).slice(0, 5)
      )
    });
    
  } catch (error: any) {
    console.error('Erro ao extrair imagens:', error);
    res.status(500).json({ 
      error: 'Erro ao extrair imagens do PDF',
      message: error.message 
    });
  }
});

// Endpoint para testar somente a extração de produtos com IA
router.post('/extract-products', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const mockUserId = 'test-user';
    const mockCatalogId = 'test-catalog';
    
    // Escolher o processador com base no parâmetro
    const processor = req.body.processor?.toLowerCase() === 'claude' ? 'claude' : 'openai';
    
    console.log(`Processando imagem ${fileName} com ${processor}...`);
    
    // Ler a imagem
    const imageBuffer = fs.readFileSync(filePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    let products = [];
    
    // Processar com o processador selecionado
    if (processor === 'claude') {
      products = await processImageWithClaude(imageBuffer, fileName, mockUserId, mockCatalogId);
    } else {
      products = await processImageWithOpenAI(imageBase64, fileName);
      
      // Adicionar metadados
      products = products.map(product => ({
        ...product,
        userId: mockUserId,
        catalogId: mockCatalogId
      }));
    }
    
    // Salvar a imagem para referência
    const tempPath = `./temp/${Date.now()}-${path.basename(fileName)}`;
    fs.writeFileSync(tempPath, imageBuffer);
    
    res.json({
      success: true,
      processor,
      productsCount: products.length,
      imagePath: tempPath,
      products
    });
    
  } catch (error: any) {
    console.error('Erro ao extrair produtos:', error);
    res.status(500).json({ 
      error: 'Erro ao extrair produtos da imagem',
      message: error.message 
    });
  }
});

// Página HTML para testar o upload e processamento
router.get('/test-page', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Teste de Processamento de Catálogos</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        h1 {
          color: #333;
          border-bottom: 2px solid #f0f0f0;
          padding-bottom: 10px;
        }
        .section {
          margin-bottom: 30px;
          padding: 20px;
          border-radius: 8px;
          background-color: #f9f9f9;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        label {
          font-weight: bold;
        }
        input, select {
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        button {
          padding: 12px 20px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        }
        button:hover {
          background-color: #45a049;
        }
        #results {
          white-space: pre-wrap;
          font-family: monospace;
          padding: 15px;
          background-color: #f0f0f0;
          border-radius: 4px;
          overflow-x: auto;
          max-height: 400px;
          overflow-y: auto;
        }
        .loading {
          display: none;
          text-align: center;
          margin: 20px 0;
        }
        .product-preview {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-top: 20px;
        }
        .product-card {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 15px;
          width: 300px;
          background-color: white;
        }
        .product-card img {
          width: 100%;
          height: 200px;
          object-fit: contain;
          border-radius: 4px;
          background-color: #f5f5f5;
        }
      </style>
    </head>
    <body>
      <h1>Teste de Processamento de Catálogos</h1>
      
      <div class="section">
        <h2>Upload de Arquivo</h2>
        <form id="uploadForm" enctype="multipart/form-data">
          <div>
            <label for="fileInput">Selecione um arquivo (PDF ou imagem):</label>
            <input type="file" id="fileInput" name="file" accept=".pdf,.jpg,.jpeg,.png">
          </div>
          
          <div>
            <label for="processorType">Tipo de processamento:</label>
            <select id="processorType" name="processor">
              <option value="pdf-pipeline">PDF - Pipeline Completo</option>
              <option value="pdf-images">PDF - Apenas Extração de Imagens</option>
              <option value="image-openai">Imagem - OpenAI</option>
              <option value="image-claude">Imagem - Claude</option>
            </select>
          </div>
          
          <button type="submit">Processar</button>
        </form>
        
        <div id="loading" class="loading">
          <p>Processando... Por favor, aguarde.</p>
          <p>(Isso pode levar alguns minutos dependendo do tamanho do arquivo)</p>
        </div>
        
        <h3>Resultados:</h3>
        <div id="results"></div>
      </div>
      
      <script>
        document.getElementById('uploadForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          
          const fileInput = document.getElementById('fileInput');
          const processorType = document.getElementById('processorType').value;
          const loadingDiv = document.getElementById('loading');
          const resultsDiv = document.getElementById('results');
          
          if (!fileInput.files || fileInput.files.length === 0) {
            resultsDiv.innerText = 'Por favor, selecione um arquivo.';
            return;
          }
          
          const file = fileInput.files[0];
          const formData = new FormData();
          
          // Determinar o endpoint e parâmetros com base no tipo de processamento
          let endpoint = '';
          if (processorType === 'pdf-pipeline') {
            endpoint = '/api/test/process-pdf';
            formData.append('pdf', file);
          } else if (processorType === 'pdf-images') {
            endpoint = '/api/test/extract-pdf-images';
            formData.append('pdf', file);
          } else if (processorType === 'image-openai' || processorType === 'image-claude') {
            endpoint = '/api/test/extract-products';
            formData.append('image', file);
            formData.append('processor', processorType === 'image-claude' ? 'claude' : 'openai');
          }
          
          loadingDiv.style.display = 'block';
          resultsDiv.innerText = 'Iniciando processamento...';
          
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            loadingDiv.style.display = 'none';
            
            if (result.success) {
              resultsDiv.innerText = JSON.stringify(result, null, 2);
            } else {
              resultsDiv.innerText = 'Erro: ' + JSON.stringify(result, null, 2);
            }
          } catch (error) {
            loadingDiv.style.display = 'none';
            resultsDiv.innerText = 'Erro ao processar o arquivo: ' + error.message;
          }
        });
      </script>
    </body>
    </html>
  `);
});

export default router;