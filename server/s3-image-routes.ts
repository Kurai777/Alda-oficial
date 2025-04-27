/**
 * Rotas para acesso a imagens armazenadas no S3
 * 
 * Este módulo implementa rotas para acessar imagens de produtos no Amazon S3,
 * com fallback para o sistema de arquivos local quando necessário.
 */

import { Express, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { 
  catalogFileExistsInS3, 
  getProductImageUrl, 
  getCatalogFileUrl,
  migrateExtractedImagesToS3,
  updateProductImagesWithS3Urls
} from './catalog-s3-manager.js';
import { checkS3Configuration } from './s3-service.js';

// Verificar se devemos usar S3
let useS3Storage = false;

/**
 * Inicializa o módulo verificando a configuração do S3
 */
async function initializeS3() {
  try {
    const s3Config = await checkS3Configuration();
    if (s3Config.status === 'success') {
      console.log(`✅ Amazon S3 disponível para imagens - Bucket: ${s3Config.bucket}`);
      useS3Storage = true;
    } else {
      console.log(`⚠️ Usando armazenamento local para imagens: ${s3Config.message}`);
    }
  } catch (error) {
    console.error('Erro ao verificar configuração do S3 para imagens:', error);
    console.log('⚠️ Usando armazenamento local para imagens');
  }
}

/**
 * Adiciona rotas para acesso a imagens no S3
 */
export async function addS3ImageRoutes(app: Express) {
  // Inicializar o módulo
  await initializeS3();
  
  // Rota para acessar imagens de produtos com S3
  app.get("/api/images/:userId/:catalogId/:filename", async (req: Request, res: Response) => {
    try {
      const { userId, catalogId, filename } = req.params;
      
      // Se o S3 estiver configurado, verificar se a imagem existe lá
      if (useS3Storage) {
        try {
          // Gerar a chave S3 para esse arquivo
          const s3Key = `${userId}/products/${catalogId}/${filename}`;
          
          // Verificar se o arquivo existe no S3
          const fileExists = await catalogFileExistsInS3(s3Key);
          
          if (fileExists) {
            // Obter URL assinada para o arquivo no S3
            const signedUrl = await getProductImageUrl(s3Key);
            console.log(`Redirecionando para URL assinada do S3: ${signedUrl}`);
            
            // Redirecionar para URL assinada temporária
            return res.redirect(signedUrl);
          } else {
            console.log(`Arquivo não encontrado no S3: ${s3Key}, tentando localmente...`);
          }
        } catch (s3Error) {
          console.error("Erro ao acessar imagem no S3:", s3Error);
          console.log("Fallback para armazenamento local...");
        }
      }
      
      // Fallback: buscar o arquivo localmente se não estiver no S3
      const filePath = path.join(process.cwd(), 'uploads', 'extracted_images', catalogId, filename);
      
      // Verificar se o arquivo existe localmente
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Imagem não encontrada" });
      }
      
      // Enviar o arquivo local como resposta
      res.sendFile(filePath);
    } catch (error) {
      console.error("Erro ao obter imagem:", error);
      return res.status(500).json({ message: "Erro ao obter imagem" });
    }
  });
  
  // API para verificar armazenamento de imagem
  app.get("/api/storage/image-status/:userId/:catalogId/:filename", async (req: Request, res: Response) => {
    try {
      const { userId, catalogId, filename } = req.params;
      
      // Resultado padrão
      const result = {
        exists: false,
        s3Available: useS3Storage,
        s3Exists: false,
        localExists: false,
        storageType: "none",
        accessUrl: null as string | null
      };
      
      // Verificar existência no S3
      if (useS3Storage) {
        try {
          const s3Key = `${userId}/products/${catalogId}/${filename}`;
          result.s3Exists = await catalogFileExistsInS3(s3Key);
          
          if (result.s3Exists) {
            result.exists = true;
            result.storageType = "s3";
            result.accessUrl = `/api/images/${userId}/${catalogId}/${filename}`;
          }
        } catch (s3Error) {
          console.error("Erro ao verificar imagem no S3:", s3Error);
        }
      }
      
      // Verificar existência local
      const filePath = path.join(process.cwd(), 'uploads', 'extracted_images', catalogId, filename);
      result.localExists = fs.existsSync(filePath);
      
      // Se não existe no S3 mas existe localmente
      if (!result.s3Exists && result.localExists) {
        result.exists = true;
        result.storageType = "local";
        result.accessUrl = `/api/images/${userId}/${catalogId}/${filename}`;
      }
      
      return res.status(200).json(result);
    } catch (error) {
      console.error("Erro ao verificar status de imagem:", error);
      return res.status(500).json({ message: "Erro ao verificar status de imagem" });
    }
  });
  
  // API para migrar imagens para S3
  app.post("/api/storage/migrate-images/:userId/:catalogId", async (req: Request, res: Response) => {
    try {
      const { userId, catalogId } = req.params;
      
      if (!useS3Storage) {
        return res.status(400).json({ 
          success: false, 
          message: "Amazon S3 não está configurado ou disponível"
        });
      }
      
      // Diretório de imagens extraídas para este catálogo
      const extractedImagesDir = path.join(process.cwd(), 'uploads', 'extracted_images', catalogId);
      
      // Verificar se o diretório existe
      if (!fs.existsSync(extractedImagesDir)) {
        return res.status(404).json({ 
          success: false, 
          message: "Diretório de imagens não encontrado para este catálogo"
        });
      }
      
      // Migrar imagens para S3
      const userIdNum = parseInt(userId);
      const catalogIdNum = parseInt(catalogId);
      
      const migrationResult = await migrateExtractedImagesToS3(
        extractedImagesDir, 
        userIdNum, 
        catalogIdNum
      );
      
      return res.status(200).json({
        success: migrationResult.success,
        message: migrationResult.message,
        uploaded: migrationResult.uploaded,
        failed: migrationResult.failed,
        fileMap: migrationResult.fileMap
      });
    } catch (error) {
      console.error("Erro ao migrar imagens para S3:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Erro ao migrar imagens para S3",
        error: (error as Error).message
      });
    }
  });
  
  // API para atualizar URLs de imagens nos produtos
  app.post("/api/storage/update-product-images/:userId/:catalogId", async (req: Request, res: Response) => {
    try {
      const { userId, catalogId } = req.params;
      const { fileMap } = req.body;
      
      if (!useS3Storage) {
        return res.status(400).json({ 
          success: false, 
          message: "Amazon S3 não está configurado ou disponível"
        });
      }
      
      if (!fileMap || typeof fileMap !== 'object') {
        return res.status(400).json({ 
          success: false, 
          message: "Mapeamento de arquivos não fornecido ou inválido"
        });
      }
      
      // Obter produtos do catálogo
      const userIdNum = parseInt(userId);
      const catalogIdNum = parseInt(catalogId);
      
      // Importar storage
      const { storage } = await import('./storage');
      const products = await storage.getProducts(userIdNum, catalogIdNum);
      
      if (!products || products.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Nenhum produto encontrado para este catálogo"
        });
      }
      
      // Atualizar URLs de imagens
      const updatedProducts = await updateProductImagesWithS3Urls(
        products, 
        fileMap, 
        userIdNum, 
        catalogIdNum
      );
      
      // Atualizar produtos no banco de dados
      const updateResults = [];
      for (const product of updatedProducts) {
        try {
          await storage.updateProduct(product.id, {
            imageUrl: product.imageUrl
          });
          updateResults.push({
            id: product.id,
            success: true,
            imageUrl: product.imageUrl
          });
        } catch (updateError) {
          console.error(`Erro ao atualizar produto ${product.id}:`, updateError);
          updateResults.push({
            id: product.id,
            success: false,
            error: (updateError as Error).message
          });
        }
      }
      
      return res.status(200).json({
        success: true,
        message: `${updatedProducts.length} produtos atualizados com URLs do S3`,
        productsUpdated: updatedProducts.length,
        updateResults
      });
    } catch (error) {
      console.error("Erro ao atualizar URLs de imagens:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Erro ao atualizar URLs de imagens",
        error: (error as Error).message
      });
    }
  });
  
  console.log('Rotas de imagem S3 adicionadas com sucesso');
}