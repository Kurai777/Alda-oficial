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

// Rota especializada para geração de PDF melhorada
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
    
    console.log("🔍 Gerando PDF melhorado em rota alternativa...");
    
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
      const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      
      // Definir cores
      const darkBlue = rgb(0.1, 0.1, 0.4);
      const lightGray = rgb(0.9, 0.9, 0.9);
      
      // Desenhar retângulo de cabeçalho
      page.drawRectangle({
        x: margin,
        y: height - margin - 50,
        width: width - 2 * margin,
        height: 50,
        color: lightGray,
        borderColor: darkBlue,
        borderWidth: 1,
        opacity: 0.5,
      });
      
      // Título
      page.drawText('ORÇAMENTO', {
        x: margin + 10,
        y: height - margin - 35,
        size: 24,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Empresa e data
      page.drawText(`Empresa: ${user.companyName || 'Não definido'}`, {
        x: margin,
        y: height - margin - 70,
        size: 12,
        font: helveticaBoldFont,
      });
      
      const today = new Date().toLocaleDateString('pt-BR');
      page.drawText(`Data: ${today}`, {
        x: margin,
        y: height - margin - 90,
        size: 12,
        font: helveticaFont,
      });
      
      // Dados do cliente - em caixa
      page.drawRectangle({
        x: margin,
        y: height - margin - 200,
        width: width - 2 * margin,
        height: 100,
        borderColor: darkBlue,
        borderWidth: 0.5,
      });
      
      page.drawText('DADOS DO CLIENTE', {
        x: margin + 10,
        y: height - margin - 120,
        size: 14,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      page.drawText(`Nome: ${quoteData.clientName}`, {
        x: margin + 10,
        y: height - margin - 145,
        size: 12,
        font: helveticaFont,
      });
      
      if (quoteData.clientEmail) {
        page.drawText(`Email: ${quoteData.clientEmail}`, {
          x: margin + 10,
          y: height - margin - 165,
          size: 12,
          font: helveticaFont,
        });
      }
      
      if (quoteData.clientPhone) {
        page.drawText(`Telefone: ${quoteData.clientPhone}`, {
          x: margin + 10,
          y: height - margin - 185,
          size: 12,
          font: helveticaFont,
        });
      }
      
      // Método e condições de pagamento
      page.drawRectangle({
        x: margin,
        y: height - margin - 280,
        width: width - 2 * margin,
        height: 70,
        borderColor: darkBlue,
        borderWidth: 0.5,
      });
      
      page.drawText('CONDIÇÕES DE PAGAMENTO', {
        x: margin + 10,
        y: height - margin - 220,
        size: 14,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Condições de pagamento
      page.drawText(`Forma de Pagamento: ${quoteData.paymentCondition || 'À vista'}`, {
        x: margin + 10,
        y: height - margin - 245,
        size: 12,
        font: helveticaFont,
      });
      
      page.drawText(`Método: ${quoteData.paymentMethod || 'Boleto'}`, {
        x: margin + 10,
        y: height - margin - 265,
        size: 12,
        font: helveticaFont,
      });
      
      // Produtos
      let produtosY = height - margin - 300;
      
      page.drawText('PRODUTOS', {
        x: margin,
        y: produtosY,
        size: 16,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      produtosY -= 30;
      
      // Cabeçalho da tabela
      page.drawRectangle({
        x: margin,
        y: produtosY,
        width: width - 2 * margin,
        height: 20,
        color: lightGray,
      });
      
      // Colunas da tabela
      const colWidths = [
        width * 0.35 - margin, // Produto
        width * 0.15,          // Preço
        width * 0.10,          // Quantidade
        width * 0.15,          // Subtotal
      ];
      
      const colX = [
        margin + 65,                                    // Imagem + Produto
        margin + colWidths[0] + 65,                     // Preço
        margin + colWidths[0] + colWidths[1] + 65,      // Quantidade
        margin + colWidths[0] + colWidths[1] + colWidths[2] + 65, // Subtotal
      ];
      
      // Cabeçalhos
      page.drawText('Produto', {
        x: margin + 65,
        y: produtosY + 5,
        size: 12,
        font: helveticaBoldFont,
      });
      
      page.drawText('Preço', {
        x: colX[1],
        y: produtosY + 5,
        size: 12,
        font: helveticaBoldFont,
      });
      
      page.drawText('Qtd', {
        x: colX[2],
        y: produtosY + 5,
        size: 12,
        font: helveticaBoldFont,
      });
      
      page.drawText('Subtotal', {
        x: colX[3],
        y: produtosY + 5,
        size: 12,
        font: helveticaBoldFont,
      });
      
      produtosY -= 20;
      
      // Itens
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
        
        // Linha de separação
        page.drawLine({
          start: { x: margin, y: produtosY },
          end: { x: width - margin, y: produtosY },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
        
        // Espaço para a imagem
        const imageHeight = 50;
        const textOffset = imageHeight / 2;
        
        try {
          // Tentar carregar imagem do produto se estiver disponível
          if (item.imageUrl) {
            try {
              const imageUrl = item.imageUrl;
              const imageExtension = imageUrl.split('.').pop()?.toLowerCase();
              const isJpg = imageExtension === 'jpg' || imageExtension === 'jpeg';
              
              const imageBase64 = await getBase64ImageFromS3(imageUrl);
              
              if (imageBase64) {
                const image = isJpg 
                  ? await pdfDoc.embedJpg(Buffer.from(imageBase64, 'base64'))
                  : await pdfDoc.embedPng(Buffer.from(imageBase64, 'base64'));
                
                const dimensions = image.scale(0.15); // Escalar para 15% do tamanho original
                
                page.drawImage(image, {
                  x: margin,
                  y: produtosY - dimensions.height + 5,
                  width: 60,
                  height: 60,
                });
              }
            } catch (imageError) {
              console.error(`Erro ao carregar imagem para produto ${item.productName}:`, imageError);
              // Continuar sem a imagem em caso de erro
            }
          }
        } catch (imageError) {
          console.warn("Erro ao processar imagem:", imageError);
        }
        
        // Nome do produto
        page.drawText(item.productName, {
          x: margin + 65,
          y: produtosY - textOffset + 15,
          size: 11,
          font: helveticaBoldFont,
          maxWidth: colWidths[0] - 10,
        });
        
        if (item.code) {
          page.drawText(`Cód: ${item.code}`, {
            x: margin + 65,
            y: produtosY - textOffset - 5,
            size: 9,
            font: helveticaFont,
            color: rgb(0.4, 0.4, 0.4),
          });
        }
        
        // Preço unitário
        page.drawText(formattedPrice, {
          x: colX[1],
          y: produtosY - textOffset,
          size: 11,
          font: helveticaFont,
        });
        
        // Quantidade
        page.drawText(`${quantity}`, {
          x: colX[2],
          y: produtosY - textOffset,
          size: 11,
          font: helveticaFont,
        });
        
        // Subtotal
        page.drawText(formattedSubtotal, {
          x: colX[3],
          y: produtosY - textOffset,
          size: 11,
          font: helveticaFont,
        });
        
        produtosY -= (imageHeight + 10); // 10px de espaço extra
        
        // Verificar se precisa de nova página
        if (produtosY < 100) {
          const newPage = pdfDoc.addPage([595, 842]);
          produtosY = height - margin;
          
          // Título da continuação
          newPage.drawText('ORÇAMENTO (continuação)', {
            x: margin,
            y: produtosY - 20,
            size: 14,
            font: helveticaBoldFont,
          });
          
          produtosY -= 50;
        }
      }
      
      // Total e descontos
      const total = quoteData.items.reduce((sum: number, item: any) => 
        sum + (item.price * (item.quantity || 1)), 0);
      
      // Aplicar desconto de 10% se for à vista
      const discountPercentage = quoteData.discountPercentage || 0;
      const discount = discountPercentage > 0 ? (total * (discountPercentage / 100)) : 0;
      const finalTotal = total - discount;
      
      // Retângulo para totais
      page.drawRectangle({
        x: width - margin - 200,
        y: produtosY - 80,
        width: 200,
        height: 80,
        borderColor: darkBlue,
        borderWidth: 0.5,
      });
      
      // Subtotal
      page.drawText('Subtotal:', {
        x: width - margin - 190,
        y: produtosY - 20,
        size: 11,
        font: helveticaFont,
      });
      
      const formattedTotal = (total / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      
      page.drawText(formattedTotal, {
        x: width - margin - 90,
        y: produtosY - 20,
        size: 11,
        font: helveticaFont,
      });
      
      // Desconto
      if (discountPercentage > 0) {
        page.drawText(`Desconto (${discountPercentage}%):`, {
          x: width - margin - 190,
          y: produtosY - 40,
          size: 11,
          font: helveticaFont,
        });
        
        const formattedDiscount = (discount / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        page.drawText(formattedDiscount, {
          x: width - margin - 90,
          y: produtosY - 40,
          size: 11,
          font: helveticaFont,
          color: rgb(0.7, 0, 0),
        });
      }
      
      // Total final
      page.drawText('TOTAL:', {
        x: width - margin - 190,
        y: produtosY - 70,
        size: 14,
        font: helveticaBoldFont,
      });
      
      const formattedFinalTotal = (finalTotal / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      
      page.drawText(formattedFinalTotal, {
        x: width - margin - 90,
        y: produtosY - 70,
        size: 14,
        font: helveticaBoldFont,
      });
      
      // Observações
      if (quoteData.notes) {
        produtosY -= 120;
        
        page.drawText('OBSERVAÇÕES:', {
          x: margin,
          y: produtosY,
          size: 12,
          font: helveticaBoldFont,
        });
        
        // Quebrar observações em múltiplas linhas se necessário
        const notesLines = [];
        let currentLine = '';
        const words = quoteData.notes.split(' ');
        const maxWidth = width - 2 * margin;
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const lineWidth = helveticaFont.widthOfTextAtSize(testLine, 10);
          
          if (lineWidth > maxWidth) {
            notesLines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine) {
          notesLines.push(currentLine);
        }
        
        // Desenhar linhas de observações
        for (let i = 0; i < notesLines.length; i++) {
          page.drawText(notesLines[i], {
            x: margin,
            y: produtosY - 20 - (i * 15),
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