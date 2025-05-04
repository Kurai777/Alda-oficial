/**
 * Gerador de PDF Simplificado para Orçamentos
 * 
 * Versão básica para garantir funcionalidade fundamental
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { storage } from './storage';
import { User } from '@shared/schema';

// Interface para os dados do orçamento recebidos da rota
export interface QuoteDataInput {
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  architectName?: string;
  notes?: string;
  items: {
    productId: number;
    productName: string;
    productCode: string | null;
    color: string;
    size?: string;
    price: number;
    quantity: number;
  }[];
  totalPrice: number;
  finalPrice?: number;
  paymentInstallments?: string;
  paymentMethod?: string;
  applyCashDiscount?: boolean;
  discountPercentage?: number;
}

/**
 * Gera um PDF simples usando apenas pdf-lib
 * Esta é uma implementação básica para provar o conceito
 */
export async function generateSimplePdf(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração simples com pdf-lib...");
  
  try {
    // Criar um novo documento PDF
    const pdfDoc = await PDFDocument.create();
    
    // Adicionar uma página
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    
    // Obter a fonte padrão
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Definir margens e espaçamento
    const margin = 50;
    let y = page.getHeight() - margin;
    const lineHeight = 20;
    
    // Adicionar título
    page.drawText('ORÇAMENTO', {
      x: margin,
      y,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight * 2;
    
    // Adicionar informações da empresa
    page.drawText(`Empresa: ${companyUser.companyName || "Não informado"}`, {
      x: margin,
      y,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
    
    // Adicionar informações do cliente
    page.drawText(`Cliente: ${quoteData.clientName}`, {
      x: margin,
      y,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
    
    if (quoteData.clientEmail) {
      page.drawText(`Email: ${quoteData.clientEmail}`, {
        x: margin,
        y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    }
    
    if (quoteData.clientPhone) {
      page.drawText(`Telefone: ${quoteData.clientPhone}`, {
        x: margin,
        y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    }
    
    if (quoteData.architectName) {
      page.drawText(`Arquiteto: ${quoteData.architectName}`, {
        x: margin,
        y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    }
    
    y -= lineHeight; // Espaço adicional
    
    // Adicionar cabeçalho dos itens
    page.drawText('Produtos', {
      x: margin,
      y,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
    
    // Cabeçalho da tabela
    page.drawText('Nome', {
      x: margin,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    page.drawText('Qtd', {
      x: margin + 200,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    page.drawText('Preço', {
      x: margin + 280,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    page.drawText('Total', {
      x: margin + 380,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    y -= lineHeight;
    
    // Adicionar itens
    for (const item of quoteData.items) {
      // Se estivermos próximos ao final da página, começar uma nova
      if (y < margin + 100) {
        page.drawText('Continua na próxima página...', {
          x: margin,
          y: margin / 2,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        
        // Adicionar nova página
        const newPage = pdfDoc.addPage([595.28, 841.89]);
        y = newPage.getHeight() - margin;
        
        // Título da página
        newPage.drawText('ORÇAMENTO (continuação)', {
          x: margin,
          y,
          size: 24,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        y -= lineHeight * 2;
        
        // Cabeçalho da tabela
        newPage.drawText('Nome', {
          x: margin,
          y,
          size: 12,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        
        newPage.drawText('Qtd', {
          x: margin + 200,
          y,
          size: 12,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        
        newPage.drawText('Preço', {
          x: margin + 280,
          y,
          size: 12,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        
        newPage.drawText('Total', {
          x: margin + 380,
          y,
          size: 12,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        
        y -= lineHeight;
        
        // Atualizar referência da página
        page = newPage;
      }
      
      // Nome do produto (limitar a 25 caracteres)
      const displayName = item.productName.length > 25 
        ? item.productName.substring(0, 25) + '...' 
        : item.productName;
      
      page.drawText(displayName, {
        x: margin,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      
      // Quantidade
      page.drawText(item.quantity.toString(), {
        x: margin + 200,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      
      // Preço unitário
      page.drawText(`R$ ${item.price.toFixed(2).replace('.', ',')}`, {
        x: margin + 280,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      
      // Preço total do item
      const itemTotal = item.price * item.quantity;
      page.drawText(`R$ ${itemTotal.toFixed(2).replace('.', ',')}`, {
        x: margin + 380,
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      
      y -= lineHeight;
    }
    
    y -= lineHeight; // Espaço adicional
    
    // Total do orçamento
    page.drawText('Total:', {
      x: margin + 280,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    page.drawText(`R$ ${quoteData.totalPrice.toFixed(2).replace('.', ',')}`, {
      x: margin + 380,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    
    // Se houver desconto aplicado
    if (quoteData.applyCashDiscount && quoteData.discountPercentage && quoteData.finalPrice) {
      y -= lineHeight;
      
      page.drawText(`Desconto (${quoteData.discountPercentage}%):`, {
        x: margin + 280,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      page.drawText(`R$ ${quoteData.finalPrice.toFixed(2).replace('.', ',')}`, {
        x: margin + 380,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
    }
    
    y -= lineHeight * 2;
    
    // Opções de pagamento
    if (quoteData.paymentMethod || quoteData.paymentInstallments) {
      page.drawText('Forma de Pagamento:', {
        x: margin,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
      
      if (quoteData.paymentMethod) {
        page.drawText(`Método: ${quoteData.paymentMethod}`, {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        y -= lineHeight;
      }
      
      if (quoteData.paymentInstallments) {
        page.drawText(`Parcelas: ${quoteData.paymentInstallments}`, {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        y -= lineHeight;
      }
    }
    
    y -= lineHeight;
    
    // Observações
    if (quoteData.notes) {
      page.drawText('Observações:', {
        x: margin,
        y,
        size:
        12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
      
      // Limitar notas a 100 caracteres por linha
      const maxWidth = page.getWidth() - margin * 2;
      let remainingNotes = quoteData.notes;
      
      while (remainingNotes.length > 0 && y > margin) {
        // Pegar até 100 caracteres ou quebrar no último espaço para não cortar palavras
        let lineText = remainingNotes.substring(0, 100);
        if (lineText.length < remainingNotes.length) {
          const lastSpaceIndex = lineText.lastIndexOf(' ');
          if (lastSpaceIndex > 0) {
            lineText = remainingNotes.substring(0, lastSpaceIndex);
          }
        }
        
        page.drawText(lineText, {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        
        remainingNotes = remainingNotes.substring(lineText.length).trim();
        y -= lineHeight;
      }
    }
    
    // Data atual
    const dateStr = new Date().toLocaleDateString('pt-BR');
    page.drawText(`Data: ${dateStr}`, {
      x: margin,
      y: margin,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Serializar o PDF para bytes
    const pdfBytes = await pdfDoc.save();
    
    // Converter para Buffer
    const buffer = Buffer.from(pdfBytes);
    console.log("✅ PDF simples gerado com sucesso!");
    
    return buffer;
  } catch (error) {
    console.error("Erro na geração do PDF simplificado:", error);
    throw error;
  }
}