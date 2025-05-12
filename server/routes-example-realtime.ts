/**
 * Exemplo de implementação de rotas com atualizações em tempo real
 * 
 * Este arquivo demonstra como integrar o serviço de notificação WebSocket
 * com as rotas da API para fornecer atualizações em tempo real aos clientes.
 */

import express from 'express';
import { notificationService } from './websocket-notifier';
import { storage } from './storage';

const realtimeRouter = express.Router();

/**
 * Obter todos os produtos do usuário
 */
realtimeRouter.get('/products', async (req, res) => {
  try {
    const userId = req.user?.id;
    const catalogId = req.query.catalogId ? Number(req.query.catalogId) : undefined;
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    // Buscar produtos do storage
    const products = await storage.getProducts(userId, catalogId);
    
    res.json(products);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * Criar novo produto
 */
realtimeRouter.post('/products', async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    const productData = {
      ...req.body,
      userId
    };
    
    // Criar produto no storage
    const product = await storage.createProduct(productData);
    
    // Notificar clientes sobre a criação do produto via WebSocket
    notificationService.notifyProductCreated(product, userId);
    
    res.status(201).json(product);
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * Atualizar produto existente
 */
realtimeRouter.put('/products/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const productId = Number(req.params.id);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    // Verificar se o produto existe e pertence ao usuário
    const existingProduct = await storage.getProduct(productId);
    
    if (!existingProduct) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    if (existingProduct.userId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const productData = {
      ...req.body,
      id: productId,
      userId
    };
    
    // Atualizar produto no storage
    const updatedProduct = await storage.updateProduct(productData);
    
    // Notificar clientes sobre a atualização do produto via WebSocket
    notificationService.notifyProductUpdated(updatedProduct, userId);
    
    res.json(updatedProduct);
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * Excluir produto
 */
realtimeRouter.delete('/products/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const productId = Number(req.params.id);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    // Verificar se o produto existe e pertence ao usuário
    const existingProduct = await storage.getProduct(productId);
    
    if (!existingProduct) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    if (existingProduct.userId !== userId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    // Extrair catalogId antes de excluir (para a notificação)
    const catalogId = existingProduct.catalogId;
    
    // Excluir produto do storage
    await storage.deleteProduct(productId);
    
    // Notificar clientes sobre a exclusão do produto via WebSocket
    notificationService.notifyProductDeleted(productId, catalogId, userId);
    
    res.sendStatus(204);
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * Exemplo de como integrar o serviço de notificação com as rotas existentes
 */
export function addRealtimeRoutes(app: express.Application) {
  app.use('/api', realtimeRouter);
  console.log('Rotas com suporte a tempo real adicionadas');
}