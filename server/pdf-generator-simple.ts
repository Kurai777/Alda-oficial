/**
 * Gerador de PDF Simplificado para Orçamentos
 * 
 * Versão básica para garantir funcionalidade fundamental
 */
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { storage } from './storage';
import { User } from '@shared/schema';
import { getBase64ImageFromS3 } from './s3-service';
import path from 'path';
import { promises as fsPromises } from 'fs';
import fs from 'fs';

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
  deliveryTime?: string;
}

// Função para remover caracteres não-WinAnsi E NOVAS LINHAS
const sanitizeWinAnsi = (text: string | null | undefined): string => {
  if (!text) return '-';
  // Substituir CR e LF por espaço, depois remover outros caracteres inválidos
  return text.replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7EÁÉÍÓÚáéíóúÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÃÕãõÇçÄËÏÖÜäëïöü]/g, '?');
};

// Função auxiliar para desenhar texto com quebra de linha
async function drawWrappedText(page: any, text: string, options: { x: number, y: number, font: PDFFont, size: number, maxWidth: number, lineHeight: number, color?: any }) {
  const { x, y, font, size, maxWidth, lineHeight, color = rgb(0, 0, 0) } = options;
  const paragraphs = sanitizeWinAnsi(text).split('\n'); // Sanitiza aqui também
  let currentY = y;

  for (const paragraph of paragraphs) {
    let words = paragraph.split(' ');
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, size);
      if (testWidth > maxWidth && currentLine !== '') {
        page.drawText(currentLine, { x, y: currentY, size, font, color });
        currentY -= lineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    // Desenhar a última linha do parágrafo
    if (currentLine !== '') {
        page.drawText(currentLine, { x, y: currentY, size, font, color });
        currentY -= lineHeight;
    }
    // Adicionar um pequeno espaço extra entre parágrafos (se houver mais de um)
    if (paragraphs.length > 1) currentY -= lineHeight * 0.3; 
  }
  return currentY; // Retorna a próxima posição Y
}

// Função utilitária para formatação de preço (centavos para R$)
function formatBRLPrice(priceInCents: number): string {
  if (isNaN(priceInCents)) return "R$ 0,00";
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    }).format(priceInCents / 100);
  } catch (err) {
    console.error('Erro ao formatar preço:', err);
    return 'R$ ???';
  }
}

// Função para obter imagem placeholder como base64
async function getPlaceholderBase64(): Promise<string | null> {
  try {
    const localPlaceholderPath = path.join(process.cwd(), 'public', 'placeholder.png');
    if (fs.existsSync(localPlaceholderPath)) { 
        const buffer = await fsPromises.readFile(localPlaceholderPath);
        console.log("Usando placeholder local.");
        return `data:image/png;base64,${buffer.toString('base64')}`;
    }
  } catch (localErr) { 
      console.error("Erro ao ler placeholder local:", localErr);
  }
  console.warn("Placeholder local não encontrado ou erro ao ler.");
  return null;
}

/**
 * Gera um PDF simples usando apenas pdf-lib
 * Esta é uma implementação básica para provar o conceito
 */
export async function generateSimplePdf(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração pdf-lib aprimorada v3...");
  
  try {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    const margin = 40;
    const contentWidth = width - 2 * margin;
    let y = height - margin;
    const smallLineHeight = 12;
    const mediumLineHeight = 16;

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // --- BUSCAR DADOS ADICIONAIS --- 
    let companyLogoEmbedded: any = null;
    let companyLogoDims = { width: 0, height: 0 };
    if (companyUser.companyLogoUrl) {
        try {
            console.log(`Tentando carregar logo de: ${companyUser.companyLogoUrl}`);
            const logoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
            if (logoBase64 && typeof logoBase64 === 'string') {
                try {
                    const logoBytes = Buffer.from(logoBase64.split(',')[1], 'base64');
                    if (logoBase64.startsWith('data:image/png')) {
                        companyLogoEmbedded = await pdfDoc.embedPng(logoBytes);
                    } else if (logoBase64.startsWith('data:image/jpeg') || logoBase64.startsWith('data:image/jpg')) {
                        companyLogoEmbedded = await pdfDoc.embedJpg(logoBytes);
                    }
                    if (companyLogoEmbedded) {
                        const logoMaxWidth = 100;
                        const logoMaxHeight = 40; 
                        companyLogoDims = companyLogoEmbedded.scaleToFit(logoMaxWidth, logoMaxHeight);
                        console.log("Logo carregado e incorporado.");
                    }
                } catch (embedError) {
                   console.error("Erro ao incorporar logo (base64 inválido?):", embedError);
                }
            } else {
                console.warn("Não foi possível obter logo em base64.");
            }
        } catch(e) { console.error("Erro geral ao carregar logo:", e); }
    }
    
    // --- CABEÇALHO --- 
    let headerStartY = y;
    let rightColX = margin + 150; // Coluna para info da empresa

    if (companyLogoEmbedded) {
        page.drawImage(companyLogoEmbedded, {
            x: margin,
            y: y - companyLogoDims.height,
            width: companyLogoDims.width,
            height: companyLogoDims.height,
        });
    } else {
        rightColX = margin; // Sem logo, info começa na margem esquerda
    }

    // Info Empresa
    page.setFont(boldFont);
    page.setFontSize(12);
    y = await drawWrappedText(page, companyUser.companyName || 'Nome da Empresa', { x: rightColX, y: y, font: boldFont, size: 12, maxWidth: contentWidth - (rightColX - margin), lineHeight: mediumLineHeight });
    
    page.setFont(font);
    page.setFontSize(9);
    if (companyUser.companyAddress) {
      y = await drawWrappedText(page, companyUser.companyAddress, { x: rightColX, y: y, font: font, size: 9, maxWidth: contentWidth - (rightColX - margin), lineHeight: smallLineHeight });
    }
    if (companyUser.companyPhone) {
      y = await drawWrappedText(page, `Tel: ${companyUser.companyPhone}`, { x: rightColX, y: y, font: font, size: 9, maxWidth: contentWidth - (rightColX - margin), lineHeight: smallLineHeight });
    }
     if (companyUser.companyCnpj) {
      y = await drawWrappedText(page, `CNPJ: ${companyUser.companyCnpj}`, { x: rightColX, y: y, font: font, size: 9, maxWidth: contentWidth - (rightColX - margin), lineHeight: smallLineHeight });
    }

    // Ajustar Y para o final do cabeçalho (considerando logo ou texto)
    const headerEndY = Math.min(y, headerStartY - companyLogoDims.height); 
    y = headerEndY - mediumLineHeight * 1.5; // Espaço após cabeçalho

    // Linha separadora
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= mediumLineHeight;

    // --- DADOS DO CLIENTE --- 
    page.setFont(boldFont);
    page.setFontSize(11);
    page.drawText('Cliente:', { x: margin, y: y });
    y -= mediumLineHeight;
    
    page.setFont(font);
    page.setFontSize(10);
    y = await drawWrappedText(page, quoteData.clientName, { x: margin + 10, y: y, font: font, size: 10, maxWidth: contentWidth - 10, lineHeight: smallLineHeight });
    if (quoteData.clientEmail) {
      y = await drawWrappedText(page, `Email: ${quoteData.clientEmail}`, { x: margin + 10, y: y, font: font, size: 10, maxWidth: contentWidth - 10, lineHeight: smallLineHeight });
    }
    if (quoteData.clientPhone) {
      y = await drawWrappedText(page, `Telefone: ${quoteData.clientPhone}`, { x: margin + 10, y: y, font: font, size: 10, maxWidth: contentWidth - 10, lineHeight: smallLineHeight });
    }
    if (quoteData.architectName) {
      y = await drawWrappedText(page, `Arquiteto: ${quoteData.architectName}`, { x: margin + 10, y: y, font: font, size: 10, maxWidth: contentWidth - 10, lineHeight: smallLineHeight });
    }
    y -= mediumLineHeight * 1.5; // Espaço

    // --- TÍTULO PRODUTOS ---
    page.setFont(boldFont);
    page.setFontSize(14);
    page.drawText('Produtos', { x: margin, y: y });
    y -= mediumLineHeight * 1.5;

    // --- TABELA DE PRODUTOS --- 
    
    // Buscar detalhes dos produtos
    const productIds = quoteData.items.map(item => item.productId);
    let productsDetails: Record<number, any> = {};
    let productImagesEmbedded: Record<number, { image: any, dims: {width: number, height: number} } | null > = {};
    const placeholderBase64 = await getPlaceholderBase64();
    let placeholderEmbedded: any = null;
    if (placeholderBase64) {
      try {
        placeholderEmbedded = await pdfDoc.embedPng(Buffer.from(placeholderBase64.split(',')[1], 'base64'));
      } catch (e) { console.error("Erro ao incorporar placeholder:", e); }
    }
    
    try {
        productsDetails = await storage.getProductsDetails(productIds);
        console.log(`Detalhes buscados para ${Object.keys(productsDetails).length} produtos.`);
        // Pré-carregar e incorporar imagens
        for(const item of quoteData.items) {
            const details = productsDetails[item.productId];
            let imageFoundAndEmbedded = false;
            if (details?.imageUrl) {
                try {
                    const imgBase64 = await getBase64ImageFromS3(details.imageUrl);
                    if (imgBase64 && typeof imgBase64 === 'string') {
                        try {
                            const imgBytes = Buffer.from(imgBase64.split(',')[1], 'base64');
                            let embeddedImg: any = null;
                            if (imgBase64.startsWith('data:image/png')) {
                                embeddedImg = await pdfDoc.embedPng(imgBytes);
                            } else if (imgBase64.startsWith('data:image/jpeg') || imgBase64.startsWith('data:image/jpg')) {
                                embeddedImg = await pdfDoc.embedJpg(imgBytes);
                            }
                            if (embeddedImg) {
                               const imgMaxWidth = 50;
                               const imgMaxHeight = 50; 
                               const imgDims = embeddedImg.scaleToFit(imgMaxWidth, imgMaxHeight);
                               productImagesEmbedded[item.productId] = { image: embeddedImg, dims: imgDims };
                               imageFoundAndEmbedded = true;
                            }
                         } catch (embedError) {
                            console.error(`Erro ao incorporar imagem ${details.imageUrl} (base64 inválido?):`, embedError);
                        }
                    } else {
                        console.warn(`Imagem base64 nula para produto ${item.productId}, URL: ${details.imageUrl}`);
                    }
                } catch(e) { console.error(`Erro geral ao carregar/processar imagem ${details.imageUrl} para produto ${item.productId}:`, e); }
            }
            // Usar placeholder se imagem não foi encontrada/incorporada
            if (!imageFoundAndEmbedded && placeholderEmbedded) {
                 productImagesEmbedded[item.productId] = { image: placeholderEmbedded, dims: placeholderEmbedded.scaleToFit(50, 50) };
            }
        }
    } catch(e) { 
        console.error("Erro ao buscar detalhes dos produtos:", e);
        if (placeholderEmbedded) { 
           quoteData.items.forEach(item => {
               productImagesEmbedded[item.productId] = { image: placeholderEmbedded, dims: placeholderEmbedded.scaleToFit(50, 50) };
           });
        }
    }

    // Definir Colunas da Tabela
    const tableTopY = y;
    const colDef = {
      img: { x: margin, width: 55 },
      name: { x: margin + 60, width: 210 },
      qty: { x: margin + 275, width: 40 },
      unitPrice: { x: margin + 320, width: 85 },
      totalPrice: { x: margin + 410, width: 95 } 
    };
    
    // Cabeçalho Tabela
    page.setFont(boldFont);
    page.setFontSize(9);
    let headerY = y;
    page.drawText('Imagem', { x: colDef.img.x, y: headerY });
    page.drawText('Produto / Código', { x: colDef.name.x, y: headerY });
    page.drawText('Qtd', { x: colDef.qty.x, y: headerY });
    page.drawText('Preço Unit.', { x: colDef.unitPrice.x, y: headerY });
    page.drawText('Preço Total', { x: colDef.totalPrice.x, y: headerY });
    y -= mediumLineHeight;
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    y -= 5;

    // Itens da Tabela
    page.setFont(font);
    page.setFontSize(8);
    const defaultRowHeight = 60; // Altura para acomodar imagem
    let pageNum = 1;

    for (const item of quoteData.items) {
      const productDetail = productsDetails[item.productId] || {};
      const embeddedImageData = productImagesEmbedded[item.productId];

      // Combinar nome e código para desenho com quebra de linha
      const nameText = `${item.productName}${item.productCode ? ` (Cód: ${item.productCode})` : ''}`;
      // Estimar altura do texto (CORRIGIDO)
      const textLineHeight = smallLineHeight * 0.95; // Usar 0.95 para dar um respiro
      const sanitizedNameText = sanitizeWinAnsi(nameText); // Sanitizar ANTES de calcular largura
      const nameLinesArray = sanitizedNameText.split('\n'); // Usar texto sanitizado
      let maxLineWidth = 0;
      for(const line of nameLinesArray) {
          maxLineWidth = Math.max(maxLineWidth, font.widthOfTextAtSize(line, 8));
      }
      const nameLines = Math.ceil(maxLineWidth / colDef.name.width) * nameLinesArray.length; // Linhas = quebras por largura * quebras por \n
      const textHeight = Math.max(textLineHeight, nameLines * textLineHeight); // Altura minima de 1 linha
      const rowHeight = Math.max(defaultRowHeight, textHeight + 10); 
      
      // --- Quebra de Página --- 
      if (y - rowHeight < margin + 50) { 
        pageNum++;
        page = pdfDoc.addPage(); 
        y = height - margin;
        // Redesenhar Cabeçalho da Tabela
        page.setFont(boldFont);
        page.setFontSize(9);
        headerY = y;
        page.drawText('Imagem', { x: colDef.img.x, y: headerY });
        page.drawText('Produto / Código', { x: colDef.name.x, y: headerY });
        page.drawText('Qtd', { x: colDef.qty.x, y: headerY });
        page.drawText('Preço Unit.', { x: colDef.unitPrice.x, y: headerY });
        page.drawText('Preço Total', { x: colDef.totalPrice.x, y: headerY });
        y -= mediumLineHeight;
        page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
        y -= 5;
        page.setFont(font);
        page.setFontSize(8);
      }
      
      const rowStartY = y;

      // Desenhar Imagem (se houver)
      if (embeddedImageData) {
        page.drawImage(embeddedImageData.image, {
          x: colDef.img.x + (colDef.img.width - embeddedImageData.dims.width) / 2, // Centralizar
          y: rowStartY - embeddedImageData.dims.height - 5, // Alinhar um pouco abaixo do topo
          width: embeddedImageData.dims.width,
          height: embeddedImageData.dims.height,
        });
      }

      // Usar drawWrappedText para Nome/Código (passando texto já sanitizado)
      let finalItemTextY = await drawWrappedText(page, sanitizedNameText, { 
           x: colDef.name.x, 
           y: rowStartY - 5, 
           font: font, 
           size: 8, 
           maxWidth: colDef.name.width, 
           lineHeight: textLineHeight 
      });

      // Desenhar Qtd, Preço Unit, Preço Total (alinhado com a primeira linha do texto)
      const firstLineY = rowStartY - 5 - textLineHeight; 
      page.drawText(String(item.quantity || 1), { x: colDef.qty.x + 5, y: firstLineY, size: 8 });
      page.drawText(formatBRLPrice(item.price), { x: colDef.unitPrice.x, y: firstLineY, size: 8 });
      page.drawText(formatBRLPrice(item.price * (item.quantity || 1)), { x: colDef.totalPrice.x, y: firstLineY, size: 8 });

      // Atualizar Y para a próxima linha (considerando a altura da imagem e a altura real do texto)
      const imageBottomY = rowStartY - (embeddedImageData?.dims.height ?? 0) - 5;
      y = Math.min(finalItemTextY, imageBottomY) - 5; // -5 para um pequeno padding abaixo

      // Desenhar linha separadora abaixo da linha inteira
      page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: width - margin, y: y + 2 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    }
    
    y -= mediumLineHeight; // Espaço após tabela

    // --- TOTAIS --- (Calcular antes de desenhar)
    const totalsStartX = width - margin - 150; // Alinhar à direita
    const totalsValueX = width - margin; // Posição final para alinhar à direita
    let currentY = y; // Começar a desenhar da posição Y atual

    page.drawLine({ start: { x: totalsStartX - 10, y: currentY + 5 }, end: { x: width - margin, y: currentY + 5 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    currentY -= mediumLineHeight;
    
    page.setFont(font);
    page.setFontSize(10);
    const subtotalText = formatBRLPrice(quoteData.totalPrice);
    const subtotalWidth = font.widthOfTextAtSize(subtotalText, 10);
    page.drawText('Subtotal:', { x: totalsStartX, y: currentY, font: font, size: 10 });
    page.drawText(subtotalText, { x: totalsValueX - subtotalWidth, y: currentY, font: font, size: 10 }); // Alinhar à direita
    currentY -= smallLineHeight * 1.2;

    // Cálculo e exibição do desconto
    const finalPrice = quoteData.finalPrice !== undefined && !isNaN(quoteData.finalPrice) 
        ? quoteData.finalPrice 
        : (quoteData.applyCashDiscount && quoteData.discountPercentage && !isNaN(quoteData.discountPercentage)
            ? quoteData.totalPrice * (1 - quoteData.discountPercentage / 100) 
            : quoteData.totalPrice);
    // CORRIGIDO: Usar applyCashDiscount e discountPercentage diretamente dos dados recebidos
    const discountApplied = quoteData.applyCashDiscount && quoteData.discountPercentage && quoteData.discountPercentage > 0;
    const discountValue = discountApplied ? quoteData.totalPrice * (quoteData.discountPercentage / 100) : 0;
    
    // Exibir linha de desconto apenas se discountApplied for verdadeiro
    if (discountApplied && quoteData.discountPercentage) { 
        const discountText = `-${formatBRLPrice(discountValue)}`;
        const discountTextWidth = font.widthOfTextAtSize(discountText, 10);
        page.drawText(`Desconto (${quoteData.discountPercentage}% Pagto. à Vista):`, { x: totalsStartX, y: currentY, font: font, size: 10 });
        page.drawText(discountText, { x: totalsValueX - discountTextWidth, y: currentY, font: font, size: 10, color: rgb(0.6, 0, 0) });
        currentY -= smallLineHeight * 1.2;
    }
    
    page.drawLine({ start: { x: totalsStartX - 10, y: currentY + 5 }, end: { x: width - margin, y: currentY + 5 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    currentY -= smallLineHeight * 1.2;

    page.setFont(boldFont);
    page.setFontSize(11);
    const totalText = formatBRLPrice(finalPrice);
    const totalWidth = boldFont.widthOfTextAtSize(totalText, 11);
    page.drawText('TOTAL:', { x: totalsStartX, y: currentY, font: boldFont, size: 11 });
    page.drawText(totalText, { x: totalsValueX - totalWidth, y: currentY, font: boldFont, size: 11 }); // Alinhar à direita
    y = currentY - mediumLineHeight * 2; // Aumentar espaço após total

    // --- DESENHAR PAGAMENTO, OBS, PRAZO (Abaixo dos totais) --- 
    const leftColX = margin;
    const leftColMaxWidth = width - margin * 2; // Usar largura total agora
    
    page.setFont(boldFont);
    page.setFontSize(11);
    page.drawText('Forma de Pagamento:', { x: leftColX, y: y });
    y -= mediumLineHeight;

    page.setFont(font);
    page.setFontSize(10);
    let paymentMethodText = 'Não especificado';
    switch (quoteData.paymentMethod) {
        case 'boleto': paymentMethodText = 'Boleto Bancário'; break;
        case 'cartao': paymentMethodText = 'Cartão de Crédito'; break;
        case 'cheque': paymentMethodText = 'Cheque'; break;
        default: paymentMethodText = quoteData.paymentMethod || 'Não especificado';
    }
    y = await drawWrappedText(page, `Método: ${paymentMethodText}`, { x: leftColX + 10, y: y, font: font, size: 10, maxWidth: leftColMaxWidth, lineHeight: smallLineHeight });
    y = await drawWrappedText(page, `Condição: ${quoteData.paymentInstallments || 'à vista'}`, { x: leftColX + 10, y: y, font: font, size: 10, maxWidth: leftColMaxWidth, lineHeight: smallLineHeight });
    y -= mediumLineHeight * 1.5;

    if (quoteData.notes) {
      page.setFont(boldFont);
      page.setFontSize(11);
      page.drawText('Observações:', { x: leftColX, y: y });
      y -= mediumLineHeight;
      page.setFont(font);
      page.setFontSize(9);
      y = await drawWrappedText(page, quoteData.notes, { x: leftColX + 10, y: y, font: font, size: 9, maxWidth: leftColMaxWidth, lineHeight: smallLineHeight });
      y -= mediumLineHeight * 1.5;
    }

    if (quoteData.deliveryTime) {
        page.setFont(boldFont);
        page.setFontSize(11);
        page.drawText('Prazo de Entrega:', { x: leftColX, y: y });
        y -= mediumLineHeight;
        page.setFont(font);
        page.setFontSize(10);
        y = await drawWrappedText(page, quoteData.deliveryTime, { x: leftColX + 10, y: y, font: font, size: 10, maxWidth: leftColMaxWidth, lineHeight: smallLineHeight });
        y -= mediumLineHeight * 1.5;
    }

    // --- RODAPÉ FINAL (Abaixo de todo o conteúdo) --- 
    const footerMinY = margin + 60; // Aumentar margem inferior para mais espaço
    // Se o conteúdo já está muito baixo, força o rodapé na margem
    if (y < footerMinY) y = footerMinY; 
    
    page.drawLine({ start: { x: margin, y: y + 15 }, end: { x: width - margin, y: y + 15 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) }); // Subir linha
    let currentFooterY = y; // Começar um pouco mais abaixo
    page.setFont(font);
    page.setFontSize(8);
    currentFooterY = await drawWrappedText(page, `Validade da Proposta: ${companyUser.quoteValidityDays || '7'} dias.`, { x: margin, y: currentFooterY, font: font, size: 8, maxWidth: contentWidth, lineHeight: smallLineHeight * 0.9 });
    if (companyUser.quotePaymentTerms) {
        currentFooterY = await drawWrappedText(page, `Termos Adicionais: ${companyUser.quotePaymentTerms}`, { x: margin, y: currentFooterY, font: font, size: 8, maxWidth: contentWidth, lineHeight: smallLineHeight * 0.9 });
    }
    currentFooterY -= smallLineHeight;
    page.drawText(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, { x: margin, y: currentFooterY, size: 8 });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    console.log("✅ PDF pdf-lib aprimorado v3 gerado com sucesso!");
    return buffer;

  } catch (error) {
    console.error("Erro na geração do PDF pdf-lib aprimorado:", error);
    throw error;
  }
}