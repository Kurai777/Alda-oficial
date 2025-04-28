/**
 * Rotas para gerenciamento de imagens de produtos
 * 
 * Este módulo implementa rotas para garantir que cada produto tenha sua
 * própria imagem exclusiva, evitando compartilhamento indesejado.
 */

import express from 'express';
import { verifyProductImage, createUniqueImageCopy, findImageFile } from '../excel-image-analyzer';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { storage } from '../storage';

const router = express.Router();
const readFileAsync = promisify(fs.readFile);

// Verifica se a imagem de um produto é única
router.get('/verify-product-image/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    
    if (isNaN(productId)) {
      return res.status(400).json({
        status: 'error',
        error: 'ID de produto inválido'
      });
    }
    
    const result = await verifyProductImage(productId);
    res.json(result);
    
  } catch (error) {
    console.error('Erro GERAL na rota /verify-product-image/:productId:', error);
    
    let errorMessage = 'Erro interno ao verificar imagem';
    // Log adicional para detalhes do erro
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('Tipo do Erro:', error.name);
      console.error('Mensagem do Erro:', error.message);
      console.error('Stack do Erro:', error.stack);
    } else {
      console.error('Erro capturado não é instância de Error:', error);
    }
    
    // Tenta enviar um JSON de erro mesmo assim, mas pode ser tarde demais
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        error: errorMessage
      });
    } else {
      console.error('Headers já enviados, não foi possível enviar JSON de erro para /verify-product-image.');
    }
  }
});

// Cria uma cópia exclusiva da imagem para um produto
router.post('/create-unique-image/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    
    if (isNaN(productId)) {
      return res.status(400).json({
        status: 'error',
        error: 'ID de produto inválido'
      });
    }
    
    // Buscar o produto
    const product = await storage.getProduct(productId);
    
    if (!product || !product.imageUrl) {
      return res.status(404).json({
        status: 'error',
        error: 'Produto não encontrado ou sem URL de imagem'
      });
    }
    
    // Extrair nome do arquivo da URL
    const matches = product.imageUrl.match(/\/([^\/]+)$/);
    if (!matches || !matches[1]) {
      return res.status(400).json({
        status: 'error',
        error: 'URL de imagem inválida'
      });
    }
    
    const filename = matches[1];
    
    // Localizar a imagem no sistema
    const imagePath = await findImageFile(filename);
    
    if (!imagePath) {
      return res.status(404).json({
        status: 'error',
        error: 'Imagem não encontrada no sistema'
      });
    }
    
    // Criar cópia exclusiva da imagem
    const result = await createUniqueImageCopy(productId, imagePath);
    
    res.json(result);
    
  } catch (error) {
    console.error('Erro ao criar imagem única:', error);
    res.status(500).json({
      status: 'error',
      error: error.message || 'Erro interno ao criar imagem única'
    });
  }
});

// Serve uma imagem de produto especifica
router.get('/product-image/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId);
    
    if (isNaN(productId)) {
      return res.status(400).send('ID de produto inválido');
    }
    
    // Buscar o produto
    const product = await storage.getProduct(productId);
    
    if (!product || !product.imageUrl) {
      return res.status(404).send('Produto não encontrado ou sem URL de imagem');
    }
    
    // Verificar se a imagem é única para este produto
    const imageVerification = await verifyProductImage(productId);
    
    // Se a imagem é compartilhada, criar cópia exclusiva
    if (imageVerification.isShared) {
      // Criar cópia exclusiva apenas se temos o caminho local da imagem
      if (imageVerification.localPath) {
        const uniqueImageResult = await createUniqueImageCopy(productId, imageVerification.localPath);
        
        if (uniqueImageResult.success) {
          // Atualizar a verificação com o novo resultado
          imageVerification.isShared = false;
          imageVerification.uniqueId = path.basename(uniqueImageResult.path);
          // A URL do produto já foi atualizada na função createUniqueImageCopy
        }
      }
    }
    
    // Extrair nome do arquivo da URL (potencialmente atualizada)
    const updatedProduct = await storage.getProduct(productId);
    const matches = updatedProduct.imageUrl.match(/\/([^\/]+)$/);
    
    if (!matches || !matches[1]) {
      return res.status(400).send('URL de imagem inválida');
    }
    
    const filename = matches[1];
    
    // Localizar a imagem no sistema de arquivos
    const imagePath = await findImageFile(filename);
    
    if (!imagePath) {
      return res.status(404).send('Imagem não encontrada no sistema');
    }
    
    // Determinar o tipo MIME baseado na extensão
    const ext = path.extname(imagePath).toLowerCase();
    let contentType = 'application/octet-stream';
    
    if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.gif') {
      contentType = 'image/gif';
    } else if (ext === '.svg') {
      contentType = 'image/svg+xml';
    }
    
    // Ler o arquivo e enviar como resposta
    const imageBuffer = await readFileAsync(imagePath);
    
    // Enviar a imagem com o tipo de conteúdo apropriado
    res.setHeader('Content-Type', contentType);
    res.send(imageBuffer);
    
  } catch (error) {
    console.error('Erro ao servir imagem de produto:', error);
    res.status(500).send('Erro interno ao buscar imagem');
  }
});

export default router;