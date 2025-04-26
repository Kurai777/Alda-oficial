/**
 * Rota de reprocessamento para catálogos específicos
 * 
 * Este módulo adiciona rotas especiais para reprocessar catálogos existentes
 * garantindo que a extração dos dados seja correta.
 */

import { Router } from 'express';
import { reprocessCatalog } from './test-app-reprocessor.js';
import { importFullCatalog } from './full-catalog-processor.js';
import { db } from './db.js';
import { catalogs } from '../shared/schema.js';
import { eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';

const reprocessRouter = Router();

// Rota para reprocessar um catálogo específico com dados padrão
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

// Rota para processar catálogo completo
reprocessRouter.post('/process-full-catalog/:catalogId', async (req, res) => {
  try {
    const { catalogId } = req.params;
    const userId = 1; // ID fixo para testes
    
    console.log(`Iniciando processamento completo do catálogo ${catalogId} para o usuário ${userId}`);
    
    // Buscar informações do catálogo no banco de dados
    const [catalog] = await db.select().from(catalogs).where(eq(catalogs.id, parseInt(catalogId)));
    
    if (!catalog) {
      return res.status(404).json({
        message: `Catálogo ${catalogId} não encontrado`
      });
    }
    
    console.log(`Catálogo encontrado: ${catalog.fileName}`);
    
    // Verificar se o arquivo existe localmente
    // No sistema atual, o URL do arquivo pode ser uma URL completa (Firebase) ou um caminho relativo
    let filePath;
    
    if (catalog.fileUrl.startsWith('/')) {
      // Caminho relativo no sistema de arquivos
      filePath = path.join(process.cwd(), catalog.fileUrl.replace(/^\//, ''));
    } else if (catalog.fileUrl.startsWith('http')) {
      // URL externa - precisamos baixar primeiro
      return res.status(400).json({
        message: `Não é possível processar catálogos armazenados externamente ainda.`,
        suggestion: "Faça upload novamente do arquivo Excel para processá-lo completamente."
      });
    } else {
      // Tenta encontrar na pasta uploads
      filePath = path.join(process.cwd(), 'uploads', String(userId), String(catalogId), catalog.fileName);
    }
    
    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        message: `Arquivo do catálogo não encontrado: ${filePath}`,
        suggestion: "Faça upload novamente do arquivo Excel para processá-lo completamente."
      });
    }
    
    // Processar o catálogo completo
    const result = await importFullCatalog(filePath, userId, parseInt(catalogId));
    
    if (result.success) {
      // Atualizar o status do catálogo
      await db.update(catalogs)
        .set({ processedStatus: 'completed' })
        .where(eq(catalogs.id, parseInt(catalogId)));
      
      return res.status(200).json({
        message: `Catálogo ${catalogId} processado completamente com sucesso`,
        productsCount: result.count
      });
    } else {
      return res.status(500).json({
        message: `Erro ao processar catálogo ${catalogId} completamente`,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Erro na rota de processamento completo:', error);
    return res.status(500).json({
      message: 'Erro ao processar catálogo completo',
      error: error.message
    });
  }
});

export { reprocessRouter };