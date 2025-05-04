import { Request, Response, Router, NextFunction } from "express";
import { storage } from "./storage";
import * as session from "express-session";
import { getBase64ImageFromS3 } from './s3-service';

// Adicionar extensão para permitir o userId na sessão
declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

// Criar router independente para PDF
const pdfRouter = Router();

// Middleware de autenticação aprimorado
function requireAuth(req: Request, res: Response, next: NextFunction) {
  console.log("Verificando autenticação na rota PDF:", req.session);
  // Verificação segura - req.session pode ser undefined
  if (!req.session || req.session.userId === undefined) {
    return res.status(401).json({ message: "Não autorizado. Faça login para continuar." });
  }
  next();
}

// Rota especializada para geração de PDF básica
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
    
    console.log("🔍 Gerando PDF simples (versão estável)...");
    
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      
      // Criar documento PDF
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 842]); // Tamanho A4
      const { width, height } = page.getSize();
      const margin = 50;
      
      // Fontes
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Título
      page.drawText('ORÇAMENTO', {
        x: margin,
        y: height - margin,
        size: 18,
        font: helveticaBoldFont,
      });
      
      // Empresa e data
      page.drawText(`Empresa: ${user.companyName || 'Não definido'}`, {
        x: margin,
        y: height - margin - 30,
        size: 10,
        font: helveticaFont,
      });
      
      const today = new Date().toLocaleDateString('pt-BR');
      page.drawText(`Data: ${today}`, {
        x: margin,
        y: height - margin - 45,
        size: 10,
        font: helveticaFont,
      });
      
      // Dados do cliente
      page.drawText('DADOS DO CLIENTE', {
        x: margin,
        y: height - margin - 75,
        size: 12,
        font: helveticaBoldFont,
      });
      
      page.drawText(`Nome: ${quoteData.clientName}`, {
        x: margin,
        y: height - margin - 95,
        size: 10,
        font: helveticaFont,
      });
      
      if (quoteData.clientEmail) {
        page.drawText(`Email: ${quoteData.clientEmail}`, {
          x: margin,
          y: height - margin - 110,
          size: 10,
          font: helveticaFont,
        });
      }
      
      if (quoteData.clientPhone) {
        page.drawText(`Telefone: ${quoteData.clientPhone}`, {
          x: margin,
          y: height - margin - 125,
          size: 10,
          font: helveticaFont,
        });
      }
      
      // Condições de pagamento
      page.drawText('CONDIÇÕES DE PAGAMENTO', {
        x: margin,
        y: height - margin - 155,
        size: 12,
        font: helveticaBoldFont,
      });
      
      page.drawText(`Forma de Pagamento: ${quoteData.paymentCondition || 'À vista'}`, {
        x: margin,
        y: height - margin - 175,
        size: 10,
        font: helveticaFont,
      });
      
      page.drawText(`Método: ${quoteData.paymentMethod || 'Boleto'}`, {
        x: margin,
        y: height - margin - 190,
        size: 10,
        font: helveticaFont,
      });
      
      // Produtos
      page.drawText('PRODUTOS', {
        x: margin,
        y: height - margin - 220,
        size: 12,
        font: helveticaBoldFont,
      });
      
      // Início da tabela de produtos
      let y = height - margin - 245;
      const lineHeight = 20;
      
      // Produtos
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
        
        // Nome do produto
        page.drawText(item.productName, {
          x: margin,
          y,
          size: 10,
          font: helveticaBoldFont,
        });
        
        y -= lineHeight;
        
        // Preço e quantidade
        page.drawText(`${formattedPrice} x ${quantity} = ${formattedSubtotal}`, {
          x: margin + 20,
          y,
          size: 10,
          font: helveticaFont,
        });
        
        y -= lineHeight * 1.2;
        
        // Se estiver ficando sem espaço, criar nova página
        if (y < 100) {
          const newPage = pdfDoc.addPage([595, 842]);
          y = height - margin;
        }
      }
      
      // Total
      const total = quoteData.items.reduce((sum: number, item: any) => 
        sum + (item.price * (item.quantity || 1)), 0);
      
      // Aplicar desconto para pagamento à vista
      const discountPercentage = 10; // 10% de desconto
      const isAvista = quoteData.paymentCondition === 'À vista' || quoteData.paymentCondition === 'A vista';
      const discount = isAvista ? (total * (discountPercentage / 100)) : 0;
      const finalTotal = total - discount;
      
      // Subtotal
      page.drawText('Subtotal:', {
        x: margin,
        y: y - 10,
        size: 10,
        font: helveticaFont,
      });
      
      const formattedTotal = (total / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      
      page.drawText(formattedTotal, {
        x: margin + 100,
        y: y - 10,
        size: 10,
        font: helveticaFont,
      });
      
      // Desconto (se aplicável)
      if (isAvista) {
        y -= lineHeight;
        
        page.drawText(`Desconto (${discountPercentage}%):`, {
          x: margin,
          y,
          size: 10,
          font: helveticaFont,
        });
        
        const formattedDiscount = (discount / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        page.drawText(formattedDiscount, {
          x: margin + 100,
          y,
          size: 10,
          font: helveticaFont,
        });
      }
      
      // Total final
      y -= lineHeight * 1.5;
      
      page.drawText('TOTAL:', {
        x: margin,
        y,
        size: 12,
        font: helveticaBoldFont,
      });
      
      const formattedFinalTotal = (finalTotal / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      
      page.drawText(formattedFinalTotal, {
        x: margin + 100,
        y,
        size: 12,
        font: helveticaBoldFont,
      });
      
      // Observações
      if (quoteData.notes) {
        y -= lineHeight * 2;
        
        page.drawText('OBSERVAÇÕES:', {
          x: margin,
          y,
          size: 10,
          font: helveticaBoldFont,
        });
        
        y -= lineHeight;
        
        // Dividir observações em linhas de 60 caracteres
        const words = quoteData.notes.split(' ');
        let line = '';
        
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          
          if (testLine.length <= 60) {
            line = testLine;
          } else {
            page.drawText(line, {
              x: margin,
              y,
              size: 10,
              font: helveticaFont,
            });
            
            y -= lineHeight;
            line = word;
            
            // Se estiver ficando sem espaço, criar nova página
            if (y < 100) {
              const newPage = pdfDoc.addPage([595, 842]);
              y = height - margin;
            }
          }
        }
        
        // Última linha
        if (line) {
          page.drawText(line, {
            x: margin,
            y,
            size: 10,
            font: helveticaFont,
          });
        }
      }
      
      // Finalizar PDF
      const pdfBytes = await pdfDoc.save();
      
      // Enviar para o cliente
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${quoteData.clientName.replace(/\s+/g, '_')}.pdf"`);
      res.send(Buffer.from(pdfBytes));
      
      console.log("✅ PDF gerado com sucesso!");
      return;
      
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      return res.status(500).json({ message: "Erro ao gerar PDF" });
    }
  } catch (error) {
    console.error("Erro ao processar solicitação de PDF:", error);
    return res.status(500).json({ message: "Erro interno ao processar solicitação" });
  }
});

export { pdfRouter };