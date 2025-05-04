/**
 * PDF Routes Simplificado - Rotas para Geração de PDF de Orçamentos
 */
import { Router, Request, Response } from 'express';
import { storage } from './storage';
import { generateSimplePdf, QuoteDataInput } from './pdf-generator-simple';
import { User } from '@shared/schema';
import path from 'path';
import { uploadBufferToS3, downloadFileFromS3 } from './s3-service';
import fs from 'fs';

// Criar o router
const router = Router();

// Middleware para verificar autenticação
const requireAuth = (req: Request, res: Response, next: Function) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Não autorizado' });
  }
  next();
};

// Rota para gerar PDF do orçamento
router.post('/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    console.log('Recebida solicitação para gerar PDF de orçamento');
    const quoteData: QuoteDataInput = req.body;
    const userId = req.session.userId!;

    // Validar dados básicos
    if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
      return res.status(400).json({ message: 'Dados incompletos para gerar o orçamento' });
    }

    console.log(`Gerando PDF para usuário ${userId} - cliente: ${quoteData.clientName}`);

    // Obter dados do usuário/empresa
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Gerar o PDF usando nosso gerador simplificado
    const pdfBuffer = await generateSimplePdf(quoteData, user);

    // Nome do arquivo baseado no cliente e data
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `orcamento-${quoteData.clientName.replace(/\s+/g, '-')}-${dateStr}.pdf`;
    const s3Key = `users/${userId}/quotes/${filename}`;

    // Fazer upload do PDF para o S3
    const uploadResult = await uploadBufferToS3(pdfBuffer, s3Key, 'application/pdf');
    
    console.log(`PDF enviado para S3: ${s3Key}`);

    // Retornar URL do S3 para o cliente
    return res.status(200).json({
      message: 'Orçamento gerado com sucesso',
      filename,
      url: uploadResult.url,
      key: s3Key
    });
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    return res.status(500).json({ message: 'Erro ao gerar o orçamento', error: error.message });
  }
});

// Rota para download do PDF (para testes/debug locais)
router.get('/download/:filename', requireAuth, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const userId = req.session.userId!;
    
    const s3Key = `users/${userId}/quotes/${filename}`;
    const tempDir = path.join(process.cwd(), 'temp');
    
    // Criar diretório temporário se não existir
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, filename);
    
    // Fazer download do S3 (apenas para debug)
    try {
      await downloadFromS3(s3Key, tempFilePath);
      
      // Enviar o arquivo para o cliente
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);
      
      // Limpar o arquivo temporário após o download
      fileStream.on('end', () => {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (err) {
          console.error('Erro ao remover arquivo temporário:', err);
        }
      });
    } catch (downloadError) {
      console.error('Erro ao baixar arquivo do S3:', downloadError);
      return res.status(404).json({ message: 'Arquivo não encontrado no S3' });
    }
  } catch (error) {
    console.error('Erro na rota de download:', error);
    return res.status(500).json({ message: 'Erro ao baixar o orçamento', error: error.message });
  }
});

// Função auxiliar para download do S3 usando downloadFileFromS3
async function downloadFromS3(s3Key: string, localPath: string): Promise<void> {
  return downloadFileFromS3(s3Key, localPath);
}

export const pdfRouterSimple = router;