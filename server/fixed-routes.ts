/*
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import * as fs from "fs";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { DecodedIdToken } from "firebase-admin/auth";
import { 
  processFixedExcel, 
  extractDataFromFixedExcel 
} from './fixed-excel-processor';

// Configuração do multer para upload de arquivos
const localStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: localStorage });

// Função que será chamada para processar a rota de upload de catálogos
async function processUpload(req: Request, res: Response) {
  try {
    console.log("Processando upload de catálogo...");
    
    if (!req.file) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }
    
    // Extrair informações do arquivo
    const file = req.file;
    const filePath = file.path;
    const fileName = file.originalname;
    const fileType = fileName.split('.').pop()?.toLowerCase() || '';
    
    console.log(`Arquivo recebido: ${fileName} (${fileType}), salvo em: ${filePath}`);
    
    // Verificar quem está fazendo o upload (obter o ID do usuário)
    const userId = req.params.userId || req.query.userId || req.body.userId || req.session.userId || 1;
    console.log(`Upload realizado pelo usuário: ${userId}`);
    
    // Criar um novo catálogo no banco de dados
    const catalog = await storage.createCatalog({
      userId: typeof userId === 'string' ? parseInt(userId) : userId,
      name: req.body.name || fileName,
      description: req.body.description || `Catálogo importado de ${fileName}`,
      createdAt: new Date(),
      status: "processing"
    });
    
    // ID do catálogo no banco relacional
    const catalogId = catalog.id;
    console.log(`Catálogo criado no banco de dados com ID: ${catalogId}`);
    
    // ID do catálogo no Firestore (pode ser o mesmo ou diferente)
    const firestoreCatalogId = req.body.firestoreCatalogId || catalogId;
    console.log(`ID do catálogo no Firestore: ${firestoreCatalogId}`);
    
    // Salvar o catálogo no Firestore também
    try {
      await storage.createFirestoreCatalog({
        name: req.body.name || fileName, 
        fileName, 
        filePath, 
        fileType,
        status: "processing",
        userId,
        localCatalogId: catalogId,
        createdAt: new Date()
      });
      console.log("Catálogo salvo no Firestore");
    } catch (firestoreError) {
      console.error("Erro ao salvar catálogo no Firestore:", firestoreError);
      // Continuar mesmo se não conseguir salvar no Firestore
    }
    
    // Processar o arquivo com base no tipo
    let productsData: any[] = [];
    let extractionInfo = "";
    
    try {
      // Processar o arquivo com base no tipo
      if (fileType === 'xlsx' || fileType === 'xls') {
        // Criar diretório para imagens extraídas se não existir
        await fs.promises.mkdir(`./uploads/extracted_images`, { recursive: true });
        
        // Detectar automaticamente o formato do Excel baseado no conteúdo
        let isPOEFormat = false;
        let isSofaHomeFormat = false;
        
        try {
          const { detectExcelFormat } = await import('./excel-format-detector');
          const formatInfo = await detectExcelFormat(filePath);
          
          isPOEFormat = formatInfo.isPOEFormat;
          isSofaHomeFormat = formatInfo.isSofaHomeFormat;
          
          console.log("Detecção automática de formato:", {
            isPOEFormat,
            isSofaHomeFormat,
            headerRow: formatInfo.headerRow,
            detectedColumns: formatInfo.detectedColumns
          });
        } catch (formatDetectionError) {
          console.error("Erro na detecção automática de formato:", formatDetectionError);
        }
        
        try {
          if (isPOEFormat) {
            console.log("DETECTADO FORMATO POE - usando processador especializado para POE");
            
            // Importar o processador específico para POE
            const poePorcessor = await import('./poe-excel-processor');
            
            try {
              console.log(`Iniciando processamento especializado para arquivo POE: ${filePath}`);
              console.log(`Usuário ID: ${userId}, Catálogo ID: ${firestoreCatalogId}`);
              
              // Processar o Excel com o processador especializado para POE
              productsData = await poePorcessor.processPOEExcelFile(filePath, userId, firestoreCatalogId);
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo POE (processador especializado).`;
              
              console.log(`Processamento POE concluído com sucesso: ${productsData.length} produtos`);
            } catch (poeError) {
              console.error("ERRO AO PROCESSAR ARQUIVO POE:", poeError);
              // Falhar para o método tradicional se o processador POE falhar
              console.log("Tentando métodos alternativos para o arquivo POE...");
            }
          } 
          else if (isSofaHomeFormat) {
            console.log("Detectado formato especial Sofá Home - usando processador com colunas fixas");
          }
          
          // Se não for POE ou o processador POE falhou, tentar com o processador de colunas fixas
          if (productsData.length === 0) {
            // Importar o processador de colunas fixas
            const { processExcelWithFixedColumns } = await import('./fixed-excel-processor');
            
            // Usar o processador com colunas fixas para extrair os dados do Excel
            console.log(`Iniciando processamento do arquivo Excel com colunas fixas: ${filePath}`);
            console.log(`Usuário ID: ${userId}, Catálogo ID: ${firestoreCatalogId}`);
            
            // Processar o Excel com o formato de colunas fixas
            try {
              productsData = await processExcelWithFixedColumns(filePath, userId, firestoreCatalogId);
              extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (colunas fixas).`;
            } catch (fixedError) {
              console.error("Erro no processador de colunas fixas:", fixedError);
              throw fixedError; // Propagar o erro para o catch externo
            }
          }
          
          // Verificar produtos com imagens
          let productsWithImages = 0;
          for (const product of productsData) {
            if (product.imageUrl) {
              productsWithImages++;
              console.log(`Produto ${product.codigo || product.nome || product.code || product.name} tem imagem: ${product.imageUrl}`);
            }
          }
          console.log(`${productsWithImages} produtos contêm imagens (${Math.round(productsWithImages/productsData.length*100)}%)`);
          
          console.log(`Processamento de produtos e imagens concluído: ${productsData.length} produtos.`);
          
        } catch (processingError) {
          console.error("Erro ao processar Excel com métodos especializados:", processingError);
          
          // Tentar método tradicional como fallback
          console.log("Tentando método tradicional de processamento Excel...");
          const { processExcelFile } = await import('./excel-processor');
          productsData = await processExcelFile(filePath, userId, firestoreCatalogId);
          extractionInfo = `Extraídos ${productsData.length} produtos do arquivo Excel (método tradicional).`;
          
          // Verificar produtos com imagens
          let productsWithImages = 0;
          for (const product of productsData) {
            if (product.imageUrl) {
              productsWithImages++;
              console.log(`Produto ${product.code || product.name} tem imagem: ${product.imageUrl}`);
            }
          }
          console.log(`${productsWithImages} produtos contêm imagens (${Math.round(productsWithImages/productsData.length*100)}%)`);
          
          console.log(`Processamento de produtos e imagens concluído: ${productsData.length} produtos.`);
        }
        
        // Salvar produtos no Firestore
        try {
          // Mapear produtos para o formato esperado pelo Firestore
          const productsForFirestore = productsData.map((p: any) => {
            // Se for do formato de colunas fixas
            if ('codigo' in p) {
              return {
                userId,
                catalogId: firestoreCatalogId,
                name: p.nome,
                description: p.descricao,
                code: p.codigo,
                price: parseFloat(p.preco.replace('R$', '').replace('.', '').replace(',', '.')) || 0,
                imageUrl: p.imageUrl,
                location: p.local,
                supplier: p.fornecedor,
                quantity: p.quantidade || 0,
                isEdited: false,
                createdAt: new Date(),
                updatedAt: new Date()
              };
            } else {
              // Formato tradicional
              return { ...p, userId, catalogId: firestoreCatalogId };
            }
          });
          
          const { saveProductsToFirestore } = await import('./firestore-service');
          const productIds = await saveProductsToFirestore(
            productsForFirestore, 
            userId, 
            firestoreCatalogId
          );
          console.log(`${productIds.length} produtos do Excel salvos no Firestore`);
          
          // Atualizar status do catálogo no Firestore
          const { updateCatalogStatusInFirestore } = await import('./firestore-service');
          await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "completed", productsData.length);
          
          // Salvar produtos no banco de dados relacional
          try {
            console.log("Salvando produtos no banco de dados relacional...");
            for (const product of productsData) {
              // Criar novo produto
              const parsedUserId = typeof userId === 'string' ? parseInt(userId) : userId;
              
              try {
                console.log(`Criando produto: ${product.name}, código: ${product.code}`);
                await storage.createProduct({
                  ...product,
                  userId: parsedUserId,
                  catalogId
                });
              } catch (productError) {
                console.error(`Erro ao criar produto ${product.code}:`, productError);
              }
            }
            console.log(`${productsData.length} produtos salvos no banco de dados.`);
          } catch (dbError) {
            console.error("Erro ao salvar produtos no banco de dados:", dbError);
          }
        } catch (firestoreError) {
          console.error("Erro ao salvar produtos do Excel no Firestore:", firestoreError);
          // Continuar mesmo se não conseguir salvar no Firestore
        }
      } else if (fileType === 'pdf') {
        // Código para processar PDF...
        // Omitido por brevidade
      } else {
        throw new Error(`Tipo de arquivo não suportado: ${fileType}`);
      }
      
      // Atualizar o status do catálogo no banco de dados
      await storage.updateCatalogStatus(catalogId, "completed");
      
      // Retornar resposta de sucesso
      return res.status(200).json({
        message: "Catálogo processado com sucesso",
        catalogId,
        firestoreCatalogId,
        productsCount: productsData.length,
        extractionInfo
      });
      
    } catch (error) {
      console.error("Erro ao processar arquivo:", error);
      
      // Atualizar o status do catálogo no banco de dados
      await storage.updateCatalogStatus(catalogId, "error");
      
      // Atualizar o status do catálogo no Firestore
      try {
        const { updateCatalogStatusInFirestore } = await import('./firestore-service');
        await updateCatalogStatusInFirestore(userId, firestoreCatalogId, "error", 0);
      } catch (firestoreError) {
        console.error("Erro ao atualizar status do catálogo no Firestore:", firestoreError);
      }
      
      return res.status(500).json({
        message: "Erro ao processar o arquivo",
        error: error.message
      });
    }
  } catch (error) {
    console.error("Erro geral no upload:", error);
    return res.status(500).json({
      message: "Erro no processamento do upload",
      error: error.message
    });
  }
}

// Função principal para registrar as rotas
export async function registerRoutes(app: Express): Promise<Server> {
  // Rota de upload (simplificada)
  app.post("/api/catalogs/upload", upload.single('file'), processUpload);

  app.post('/api/fixed/process-catalog/:catalogId', async (req: Request, res: Response) => {
    const catalogId = parseInt(req.params.catalogId);
    const userId = req.session?.userId || parseInt(req.body.userId as string);

    if (!userId || isNaN(catalogId)) {
      return res.status(400).json({ message: "IDs inválidos" });
    }

    try {
      const catalog = await storage.getCatalog(catalogId);
      if (!catalog || catalog.userId !== userId) {
        return res.status(404).json({ message: "Catálogo não encontrado" });
      }

      if (!catalog.s3Key) {
        return res.status(400).json({ message: "Catálogo sem arquivo S3 associado" });
      }

      // Marcar como processando no PG
      await storage.updateCatalogStatus(catalogId, 'processing');
      
      // Disparar processamento em background (sem await)
      processFixedExcel(userId, catalogId, catalog.s3Key).catch(err => {
        console.error(`Erro no processamento background do catálogo fixo ${catalogId}:`, err);
        // Tentar marcar como falha se o processamento background falhar
        storage.updateCatalogStatus(catalogId, 'failed')
          .catch(statusErr => console.error('Erro ao atualizar status para FAILED após erro no background:', statusErr));
      });

      res.status(202).json({ message: "Processamento iniciado" });

    } catch (error) {
      console.error("Erro na rota /process-catalog:", error);
      // Tentar marcar como falha
       try {
         await storage.updateCatalogStatus(catalogId, 'failed');
       } catch (statusError) { console.error("Erro ao atualizar status para FAILED no catch principal:", statusError); }
       return res.status(500).json({ message: "Erro ao iniciar processamento" });
    }
  });

  // Criar servidor HTTP
  const httpServer = createServer(app);

  return httpServer;
}
*/