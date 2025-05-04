import { Request, Response, Router, NextFunction } from "express";
import { storage } from "./storage";

// Criar router independente para PDF
const pdfRouter = Router();

// Middleware de autenticação simplificado
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Não autorizado. Faça login para continuar." });
  }
  next();
}

// Rota especializada para geração de PDF extremamente simples
pdfRouter.post("/generate-simple-pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(403).json({ message: "Usuário não encontrado ou não autorizado." });
    }

    const quoteData = req.body; 
    if (!quoteData || !quoteData.clientName || !quoteData.items || quoteData.items.length === 0) {
      return res.status(400).json({ message: "Dados do orçamento inválidos ou incompletos." });
    }
    
    console.log("🔍 Gerando PDF básico em rota alternativa...");
    
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      
      // Criar documento PDF
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const margin = 50;
      
      // Fontes
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Título
      page.drawText('ORÇAMENTO', {
        x: margin,
        y: height - margin,
        size: 24,
        font: helveticaBoldFont,
      });
      
      // Empresa
      page.drawText(`Empresa: ${user.companyName || 'Não definido'}`, {
        x: margin,
        y: height - margin - 40,
        size: 12,
        font: helveticaFont,
      });
      
      // Data
      const today = new Date().toLocaleDateString('pt-BR');
      page.drawText(`Data: ${today}`, {
        x: margin,
        y: height - margin - 60,
        size: 12,
        font: helveticaFont,
      });
      
      // Cliente
      page.drawText('DADOS DO CLIENTE', {
        x: margin,
        y: height - margin - 100,
        size: 14,
        font: helveticaBoldFont,
      });
      
      page.drawText(`Nome: ${quoteData.clientName}`, {
        x: margin,
        y: height - margin - 120,
        size: 12,
        font: helveticaFont,
      });
      
      if (quoteData.clientEmail) {
        page.drawText(`Email: ${quoteData.clientEmail}`, {
          x: margin,
          y: height - margin - 140,
          size: 12,
          font: helveticaFont,
        });
      }
      
      if (quoteData.clientPhone) {
        page.drawText(`Telefone: ${quoteData.clientPhone}`, {
          x: margin,
          y: height - margin - 160,
          size: 12,
          font: helveticaFont,
        });
      }
      
      // Produtos
      page.drawText('PRODUTOS', {
        x: margin,
        y: height - margin - 200,
        size: 14,
        font: helveticaBoldFont,
      });
      
      let y = height - margin - 230;
      
      for (const item of quoteData.items) {
        const quantity = item.quantity || 1;
        const subtotal = item.price * quantity;
        
        // Formatação de preço em reais
        const formattedPrice = (item.price / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        const formattedSubtotal = (subtotal / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        page.drawText(`${item.productName}`, {
          x: margin,
          y,
          size: 12,
          font: helveticaFont,
        });
        
        y -= 20;
        
        page.drawText(`${formattedPrice} x ${quantity} = ${formattedSubtotal}`, {
          x: margin + 20,
          y,
          size: 12,
          font: helveticaFont,
        });
        
        y -= 30;
        
        // Se atingir o final da página, criar nova página
        if (y < 100) {
          const newPage = pdfDoc.addPage();
          y = height - margin;
        }
      }
      
      // Total
      const total = quoteData.items.reduce((sum: number, item: any) => 
        sum + (item.price * (item.quantity || 1)), 0);
      
      const formattedTotal = (total / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      
      y -= 20;
      
      page.drawText(`TOTAL: ${formattedTotal}`, {
        x: margin,
        y,
        size: 14,
        font: helveticaBoldFont,
      });
      
      // Finalizar PDF
      const pdfBytes = await pdfDoc.save();
      
      // Enviar para o cliente
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}.pdf"`);
      res.send(Buffer.from(pdfBytes));
      
      console.log("✅ PDF gerado com sucesso na rota alternativa!");
      return;
      
    } catch (err) {
      console.error("Erro ao gerar PDF na rota alternativa:", err);
      return res.status(500).json({ message: "Erro ao gerar PDF" });
    }
  } catch (error) {
    console.error("Erro ao processar solicitação de PDF na rota alternativa:", error);
    return res.status(500).json({ message: "Erro interno ao processar solicitação" });
  }
});

export { pdfRouter };