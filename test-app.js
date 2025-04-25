/**
 * Aplicação stand-alone para testar extração de imagens do Excel
 * 
 * Esta aplicação roda de forma independente, sem depender do Vite/React
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';

// Configurar o Express
const app = express();
const port = 3333;

// Configurar o multer para upload de arquivos
const upload = multer({ 
  dest: 'uploads/temp',
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB limit
});

// Servir arquivos estáticos
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// HTML simples para interface
const htmlTemplate = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Teste de Processamento de Catálogos</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2 { margin-top: 2rem; color: #333; }
    .card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
      background: #f9f9f9;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .product {
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 15px;
      background: white;
    }
    .product img {
      max-width: 100%;
      height: auto;
      max-height: 200px;
      object-fit: contain;
      margin-bottom: 10px;
      display: block;
    }
    code {
      background: #f0f0f0;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    form {
      margin: 2rem 0;
      padding: 1.5rem;
      background: #f5f5f5;
      border-radius: 8px;
    }
    button {
      background: #2563eb;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background: #1d4ed8;
    }
    pre {
      background: #f0f0f0;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    .info {
      background: #e7f3ff;
      border-left: 4px solid #2563eb;
      padding: 10px 15px;
      margin: 15px 0;
    }
    .error {
      background: #fee2e2;
      border-left: 4px solid #dc2626;
      padding: 10px 15px;
      margin: 15px 0;  
    }
  </style>
</head>
<body>
  <h1>Teste de Processamento de Catálogos</h1>
  
  <div class="info">
    Esta é uma aplicação de teste para processamento de catálogos. 
    Você pode fazer upload de arquivos PDF ou Excel para ver como o sistema processa os dados.
  </div>
  
  <form action="/upload" method="post" enctype="multipart/form-data">
    <h2>Upload de Arquivo</h2>
    <p>Selecione um arquivo PDF ou Excel (.xlsx, .xls)</p>
    <input type="file" name="catalog" accept=".pdf,.xlsx,.xls">
    <p>
      <button type="submit">Processar Arquivo</button>
    </p>
  </form>

  <div id="results"></div>

  <script>
    // Script para processar formulário com AJAX no futuro, se necessário
  </script>
</body>
</html>
`;

// Visualizar os resultados
const renderResults = (results) => {
  const productsHtml = results.products && results.products.length > 0
    ? `
      <h2>Produtos Encontrados (${results.products.length})</h2>
      <div class="product-grid">
        ${results.products.map(product => `
          <div class="product">
            ${product.imagem ? `<img src="${product.imagem}" alt="Imagem do produto">` : '<p>Sem imagem</p>'}
            <h3>${product.nome || 'Sem nome'}</h3>
            <p><strong>Código:</strong> ${product.codigo || 'N/A'}</p>
            <p><strong>Preço:</strong> ${product.preco || 'N/A'}</p>
            <p>${product.descricao || 'Sem descrição'}</p>
          </div>
        `).join('')}
      </div>
    `
    : '<div class="error">Nenhum produto encontrado no arquivo.</div>';

  const debug = `
    <h2>Detalhes Técnicos</h2>
    <div class="card">
      <p><strong>Arquivo:</strong> ${results.fileName}</p>
      <p><strong>Tipo:</strong> ${results.fileType}</p>
      ${results.pageCount ? `<p><strong>Páginas:</strong> ${results.pageCount}</p>` : ''}
      ${results.imageCount ? `<p><strong>Imagens encontradas:</strong> ${results.imageCount}</p>` : ''}
      <p><strong>Tempo de processamento:</strong> ${results.processingTime}ms</p>
    </div>
    
    <h3>Dados Brutos</h3>
    <pre>${JSON.stringify(results, null, 2)}</pre>
  `;

  return `
    <h2>Resultados do Processamento</h2>
    ${results.error ? `<div class="error">${results.error}</div>` : ''}
    ${productsHtml}
    ${debug}
  `;
};

/**
 * Obter uma amostra de produtos para exibição
 * @param {Array} products Lista de produtos
 * @param {number} count Quantidade de produtos na amostra
 * @returns Array de produtos simplificados
 */
function getSampleProducts(products, count = 3) {
  // Se não temos produtos, retorne um array vazio
  if (!products || !Array.isArray(products) || products.length === 0) {
    return [];
  }

  // Se temos poucos produtos, retorne todos
  if (products.length <= count) {
    return products;
  }

  // Caso contrário, pegue alguns do início, meio e fim
  const result = [];
  result.push(products[0]); // Primeiro
  
  if (count >= 2) {
    const middle = Math.floor(products.length / 2);
    result.push(products[middle]); // Meio
  }
  
  if (count >= 3) {
    result.push(products[products.length - 1]); // Último
  }
  
  return result;
}

// Rota para a página inicial
app.get('/', (req, res) => {
  res.send(htmlTemplate);
});

// Rota para upload e processamento de arquivos
app.post('/upload', upload.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.send(htmlTemplate + renderResults({
        error: 'Nenhum arquivo enviado',
        products: [],
        fileName: 'N/A',
        fileType: 'N/A',
        processingTime: 0
      }));
    }
    
    // Dados básicos
    const startTime = Date.now();
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Verificar o tipo de arquivo
    if (fileExt === '.pdf') {
      // Processar PDF
      try {
        const pdfData = await fs.promises.readFile(filePath);
        const pdfDoc = await PDFDocument.load(pdfData);
        
        const pageCount = pdfDoc.getPageCount();
        const metadata = {
          title: pdfDoc.getTitle() || 'Sem título',
          author: pdfDoc.getAuthor() || 'Desconhecido',
          pageCount
        };
        
        // Para fins de teste, vamos criar alguns produtos fictícios
        // Na versão real, você usaria sua extração baseada em IA
        const processingTime = Date.now() - startTime;
        
        res.send(htmlTemplate + renderResults({
          fileName,
          fileType: 'PDF',
          pageCount,
          metadata,
          processingTime,
          products: [] // Sem produtos ainda
        }));
      } catch (error) {
        console.error('Erro ao processar PDF:', error);
        
        res.send(htmlTemplate + renderResults({
          error: `Erro ao processar PDF: ${error.message}`,
          fileName,
          fileType: 'PDF',
          processingTime: Date.now() - startTime
        }));
      }
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      // Processar Excel
      res.send(htmlTemplate + renderResults({
        fileName,
        fileType: fileExt === '.xlsx' ? 'Excel (XLSX)' : 'Excel (XLS)',
        processingTime: Date.now() - startTime,
        products: [] // Sem produtos ainda
      }));
    } else {
      res.send(htmlTemplate + renderResults({
        error: 'Tipo de arquivo não suportado. Use PDF, XLSX ou XLS.',
        fileName,
        fileType: fileExt,
        processingTime: Date.now() - startTime
      }));
    }
  } catch (error) {
    console.error('Erro no upload:', error);
    
    res.send(htmlTemplate + renderResults({
      error: `Erro no processamento: ${error.message}`,
      fileName: req.file ? req.file.originalname : 'Desconhecido',
      fileType: 'Desconhecido',
      processingTime: 0
    }));
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor de teste rodando em http://localhost:${port}`);
});