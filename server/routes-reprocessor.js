/**
 * Rota de reprocessamento para catálogos específicos
 * 
 * Este módulo adiciona uma rota especial para reprocessar catálogos existentes
 * garantindo que a extração dos dados seja correta.
 */

import { Router } from 'express';
import { reprocessCatalog } from './test-app-reprocessor.js';

const reprocessRouter = Router();

// Rota para reprocessar um catálogo específico
reprocessRouter.post('/reprocess-catalog/:catalogId', async (req, res) => {
  try {
    const { catalogId } = req.params;
    const userId = 1; // ID fixo para testes
    
    console.log(`Iniciando reprocessamento do catálogo ${catalogId} para o usuário ${userId}`);
    
    // Executar o reprocessamento
    const result = await reprocessCatalog(userId, parseInt(catalogId));
    
    if (result.success) {
      return res.status(200).json({
        message: `Catálogo ${catalogId} reprocessado com sucesso`,
        productsCount: result.count
      });
    } else {
      return res.status(500).json({
        message: `Erro ao reprocessar catálogo ${catalogId}`,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Erro na rota de reprocessamento:', error);
    return res.status(500).json({
      message: 'Erro ao reprocessar catálogo',
      error: error.message
    });
  }
});

export { reprocessRouter };