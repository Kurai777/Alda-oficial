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

// Rota especializada para geração de PDF melhorada (v2)
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
    
    console.log("🔍 Gerando PDF melhorado v2 em rota alternativa...");
    
    try {
      // Checar imageUrls nos produtos e registrar
      for (const item of quoteData.items) {
        console.log(`Produto: ${item.productName}, ImageUrl: ${item.imageUrl || 'Nenhuma'}`);
      }
      
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      
      // Criar documento PDF
      const pdfDoc = await PDFDocument.create();
      
      // Funções auxiliares para criar páginas conforme necessário
      const createPage = () => {
        const page = pdfDoc.addPage([595, 842]); // Tamanho A4
        return page;
      };
      
      // Primeira página
      const page = createPage();
      const { width, height } = page.getSize();
      const margin = 40; // Margens menores para mais espaço útil
      
      // Fontes
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Definir cores baseadas na imagem de exemplo
      const darkBlue = rgb(0.1, 0.1, 0.6);
      const mediumBlue = rgb(0.2, 0.2, 0.7);  
      const lightGray = rgb(0.95, 0.95, 0.95);
      const borderGray = rgb(0.7, 0.7, 0.7);
      
      // ===== CABEÇALHO =====
      // Borda ao redor do título
      page.drawRectangle({
        x: margin,
        y: height - margin - 40,
        width: width - 2 * margin,
        height: 40,
        borderColor: darkBlue,
        borderWidth: 1,
      });
      
      // Título centralizado
      const title = 'ORÇAMENTO';
      const titleWidth = helveticaBoldFont.widthOfTextAtSize(title, 20);
      page.drawText(title, {
        x: (width - titleWidth) / 2,
        y: height - margin - 30,
        size: 20,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Informações da empresa e data - lado a lado
      const startY = height - margin - 60;
      
      page.drawText(`Empresa: ${user.companyName || 'Não definido'}`, {
        x: margin,
        y: startY,
        size: 10,
        font: helveticaBoldFont,
      });
      
      const today = new Date().toLocaleDateString('pt-BR');
      page.drawText(`Data: ${today}`, {
        x: width - margin - 80,
        y: startY,
        size: 10,
        font: helveticaFont,
      });
      
      // ===== DADOS DO CLIENTE =====
      // Título da seção
      page.drawText('DADOS DO CLIENTE', {
        x: margin,
        y: startY - 25,
        size: 12,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Desenha linha fina embaixo do título de seção
      page.drawLine({
        start: { x: margin, y: startY - 28 },
        end: { x: width - margin, y: startY - 28 },
        thickness: 1,
        color: darkBlue,
      });
      
      // Dados do cliente em formato de tabela
      const clientData = [
        { label: 'Nome:', value: quoteData.clientName },
        { label: 'Email:', value: quoteData.clientEmail || '' },
        { label: 'Telefone:', value: quoteData.clientPhone || '' }
      ];
      
      let clientY = startY - 45;
      const clientRowHeight = 15;
      
      for (const data of clientData) {
        if (data.value) {
          page.drawText(data.label, {
            x: margin,
            y: clientY,
            size: 10,
            font: helveticaBoldFont,
          });
          
          page.drawText(data.value, {
            x: margin + 70,
            y: clientY,
            size: 10,
            font: helveticaFont,
          });
          
          clientY -= clientRowHeight;
        }
      }
      
      // ===== CONDIÇÕES DE PAGAMENTO =====
      // Título da seção
      const paymentY = clientY - 20;
      
      page.drawText('CONDIÇÕES DE PAGAMENTO', {
        x: margin,
        y: paymentY,
        size: 12,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Desenha linha fina embaixo do título de seção
      page.drawLine({
        start: { x: margin, y: paymentY - 3 },
        end: { x: width - margin, y: paymentY - 3 },
        thickness: 1,
        color: darkBlue,
      });
      
      // Informações de pagamento lado a lado
      const paymentInfoY = paymentY - 20;
      
      page.drawText(`Forma de Pagamento: ${quoteData.paymentCondition || 'À vista'}`, {
        x: margin,
        y: paymentInfoY,
        size: 10,
        font: helveticaFont,
      });
      
      page.drawText(`Método: ${quoteData.paymentMethod || 'Boleto'}`, {
        x: margin + 230,
        y: paymentInfoY,
        size: 10,
        font: helveticaFont,
      });
      
      // ===== PRODUTOS =====
      // Título da seção
      const productsY = paymentInfoY - 30;
      
      page.drawText('PRODUTOS', {
        x: margin,
        y: productsY,
        size: 12,
        font: helveticaBoldFont,
        color: darkBlue,
      });
      
      // Desenha linha fina embaixo do título de seção
      page.drawLine({
        start: { x: margin, y: productsY - 3 },
        end: { x: width - margin, y: productsY - 3 },
        thickness: 1,
        color: darkBlue,
      });
      
      // Cabeçalhos da tabela de produtos
      const tableHeaderY = productsY - 25;
      const tableCols = [
        { label: 'Produto', x: margin, width: width * 0.4 },
        { label: 'Preço', x: margin + width * 0.4, width: width * 0.2 },
        { label: 'Qtd', x: margin + width * 0.6, width: width * 0.1 },
        { label: 'Subtotal', x: margin + width * 0.7, width: width * 0.2 }
      ];
      
      // Cabeçalhos
      for (const col of tableCols) {
        page.drawText(col.label, {
          x: col.x,
          y: tableHeaderY,
          size: 10,
          font: helveticaBoldFont,
        });
      }
      
      // Linha abaixo dos cabeçalhos
      page.drawLine({
        start: { x: margin, y: tableHeaderY - 5 },
        end: { x: width - margin, y: tableHeaderY - 5 },
        thickness: 0.5,
        color: borderGray,
      });
      
      // ===== LISTA DE PRODUTOS =====
      let currentY = tableHeaderY - 25; // Começa 25 pontos abaixo do cabeçalho
      let currentPage = page;
      const itemHeight = 30; // Altura de cada item na tabela
      const pageBreakMargin = 60; // Margem inferior para quebra de página
      
      for (let i = 0; i < quoteData.items.length; i++) {
        const item = quoteData.items[i];
        
        // Verificar se precisa de nova página
        if (currentY < pageBreakMargin) {
          currentPage = createPage();
          currentY = height - margin - 40; // Reinicia posição Y no topo da nova página
        }
        
        // Formatar valores
        const quantity = item.quantity || 1;
        const subtotal = item.price * quantity;
        
        const formattedPrice = (item.price / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        const formattedSubtotal = (subtotal / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        // Nome do produto e código
        currentPage.drawText(item.productName, {
          x: tableCols[0].x,
          y: currentY,
          size: 10,
          font: helveticaBoldFont,
          maxWidth: tableCols[0].width - 5,
        });
        
        if (item.code) {
          currentPage.drawText(`Cód: ${item.code}`, {
            x: tableCols[0].x,
            y: currentY - 12,
            size: 8,
            font: helveticaFont,
            color: rgb(0.4, 0.4, 0.4),
          });
        }
        
        // Preço unitário
        currentPage.drawText(formattedPrice, {
          x: tableCols[1].x,
          y: currentY,
          size: 10,
          font: helveticaFont,
        });
        
        // Quantidade
        currentPage.drawText(`${quantity}`, {
          x: tableCols[2].x,
          y: currentY,
          size: 10,
          font: helveticaFont,
        });
        
        // Subtotal
        currentPage.drawText(formattedSubtotal, {
          x: tableCols[3].x,
          y: currentY,
          size: 10,
          font: helveticaFont,
        });
        
        // Linha separadora entre itens
        currentPage.drawLine({
          start: { x: margin, y: currentY - itemHeight + 5 },
          end: { x: width - margin, y: currentY - itemHeight + 5 },
          thickness: 0.5,
          color: borderGray,
        });
        
        // Avança para o próximo item
        currentY -= itemHeight;
      }
      
      // ===== TOTAIS =====
      // Calcula totais
      const total = quoteData.items.reduce((sum: number, item: any) => 
        sum + (item.price * (item.quantity || 1)), 0);
      
      // Aplicar desconto se especificado
      const discountPercentage = quoteData.discountPercentage || 10; // 10% por padrão para pagamento à vista
      const discount = (quoteData.paymentCondition === 'À vista' || quoteData.paymentCondition === 'A vista') 
        ? (total * (discountPercentage / 100)) 
        : 0;
        
      const finalTotal = total - discount;
      
      // Se o último produto estiver muito próximo do final da página, vá para a próxima
      if (currentY < pageBreakMargin + 100) {
        currentPage = createPage();
        currentY = height - margin - 40;
      }
      
      // Desenha área de totais
      const totalsX = width - margin - 200;
      const totalsWidth = 200;
      
      // Subtotal
      if (totalsX > margin) { // Garante que não vai desenhar fora da margem
        currentPage.drawText('Subtotal:', {
          x: totalsX,
          y: currentY - 15,
          size: 10,
          font: helveticaFont,
        });
        
        const formattedTotal = (total / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        currentPage.drawText(formattedTotal, {
          x: totalsX + 100,
          y: currentY - 15,
          size: 10,
          font: helveticaFont,
        });
        
        // Desconto (se aplicável)
        if (discount > 0) {
          currentPage.drawText(`Desconto (${discountPercentage}%):`, {
            x: totalsX,
            y: currentY - 35,
            size: 10,
            font: helveticaFont,
          });
          
          const formattedDiscount = (discount / 100).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
          
          currentPage.drawText(formattedDiscount, {
            x: totalsX + 100,
            y: currentY - 35,
            size: 10,
            font: helveticaFont,
            color: rgb(0.7, 0, 0),
          });
        }
        
        // Linha antes do total final
        currentPage.drawLine({
          start: { x: totalsX, y: currentY - 45 },
          end: { x: totalsX + totalsWidth, y: currentY - 45 },
          thickness: 0.5,
          color: darkBlue,
        });
        
        // Total final
        currentPage.drawText('TOTAL:', {
          x: totalsX,
          y: currentY - 65,
          size: 12,
          font: helveticaBoldFont,
          color: darkBlue,
        });
        
        const formattedFinalTotal = (finalTotal / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        
        currentPage.drawText(formattedFinalTotal, {
          x: totalsX + 100,
          y: currentY - 65,
          size: 12,
          font: helveticaBoldFont,
        });
      }
      
      // ===== OBSERVAÇÕES =====
      if (quoteData.notes) {
        const notesY = currentY - 100;
        
        // Título
        currentPage.drawText('OBSERVAÇÕES:', {
          x: margin,
          y: notesY,
          size: 10,
          font: helveticaBoldFont,
        });
        
        // Texto de observações formatado
        const noteText = quoteData.notes;
        const maxWidth = width - 2 * margin;
        let textX = margin;
        let textY = notesY - 20;
        let fontSize = 10;
        
        // Quebrar texto em múltiplas linhas
        let remainingText = noteText;
        while (remainingText.length > 0 && textY > pageBreakMargin) {
          // Determinar quantos caracteres cabem na linha atual
          let i = 0;
          let lineText = '';
          
          while (
            i < remainingText.length && 
            helveticaFont.widthOfTextAtSize(lineText + remainingText[i], fontSize) < maxWidth
          ) {
            lineText += remainingText[i];
            i++;
          }
          
          // Se não conseguiu encaixar nenhum texto, forçar pelo menos um caractere
          if (lineText.length === 0 && remainingText.length > 0) {
            lineText = remainingText[0];
            i = 1;
          }
          
          // Desenhar a linha atual
          currentPage.drawText(lineText, {
            x: textX,
            y: textY,
            size: fontSize,
            font: helveticaFont,
          });
          
          // Atualizar texto restante e posição Y
          remainingText = remainingText.substring(i);
          textY -= fontSize + 5;
          
          // Se estiver muito próximo do final da página e ainda tiver texto
          if (textY < pageBreakMargin && remainingText.length > 0) {
            currentPage = createPage();
            textY = height - margin - 40;
          }
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