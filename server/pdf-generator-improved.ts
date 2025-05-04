/**
 * Gerador de PDF para Orçamentos - Versão Aprimorada
 * 
 * Sistema de três camadas de geração de PDF com:
 * 1. Puppeteer (alta qualidade)
 * 2. html-pdf/PhantomJS (qualidade média)
 * 3. pdf-lib (básico mas mais confiável)
 * 
 * Esta versão corrige os problemas com:
 * - Imagens não aparecendo nos PDFs
 * - Condições de pagamento não sendo exibidas
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import * as path from 'path';
import * as fs from 'fs';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { storage } from './storage';
import { downloadFileFromS3 } from './s3-service';
import { User } from '@shared/schema';
import htmlPdf from 'html-pdf'; // Alternativa leve ao Puppeteer
import { promisify } from 'util';
import { promises as fsPromises } from 'fs'; // Versão promise do fs

// Helper para converter imagem do S3 para base64 para incluir no HTML
export async function getBase64ImageFromS3(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  
  console.log(`🔍 Processando imagem: ${imageUrl}`);
  
  // MÉTODO 1: Tentar baixar do S3 se for URL do S3
  try {
    if (imageUrl.includes('amazonaws.com') || imageUrl.includes('/api/s3-images/')) {
      console.log(`Detectada imagem S3: ${imageUrl}`);
      let s3Key;
      
      if (imageUrl.includes('amazonaws.com')) {
        const urlParts = new URL(imageUrl);
        // Extrai a chave de forma diferente para alanis.replit.app ou amazonaws.com
        // Remove o bucket name da URL 
        const pathWithoutBucket = urlParts.pathname.split('/').slice(1).join('/');
        s3Key = decodeURIComponent(pathWithoutBucket);
      } else {
        // Para API local de imagens
        s3Key = imageUrl.split('/api/s3-images/')[1];
      }
      
      console.log(`Chave S3 extraída: ${s3Key}`);
      
      const imageUint8Array = await downloadFileFromS3(s3Key); 
      const imageBuffer = Buffer.from(imageUint8Array);
      
      let mimeType = 'image/jpeg'; 
      if (s3Key.toLowerCase().endsWith('.png')) mimeType = 'image/png';
      else if (s3Key.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
      else if (s3Key.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';
      
      console.log(`✅ Imagem do S3 processada com sucesso: ${mimeType}`);
      return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    }
  } catch (s3Error) {
    console.error(`⚠️ Erro ao processar imagem do S3: ${imageUrl}`, s3Error);
    // Continuar para o próximo método
  }
  
  // MÉTODO 2: Tentar baixar de URL externa usando fetch
  try {
    if (imageUrl.startsWith('http')) {
      console.log(`Tentando baixar imagem de URL externa: ${imageUrl}`);
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Erro ao baixar imagem (status ${response.status})`);
      }
      
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      console.log(`✅ Imagem externa processada com sucesso: ${contentType}`);
      return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
    }
  } catch (fetchError) {
    console.error(`⚠️ Erro ao processar imagem externa: ${imageUrl}`, fetchError);
    // Continuar para o próximo método
  }
  
  // MÉTODO 3: Se for URL relativa, tentar acessar localmente
  try {
    if (imageUrl.startsWith('/')) {
      const localPath = path.join(process.cwd(), 'public', imageUrl);
      console.log(`Tentando acessar imagem local: ${localPath}`);
      
      if (fs.existsSync(localPath)) {
        const imageBuffer = fs.readFileSync(localPath);
        
        let mimeType = 'image/jpeg';
        if (localPath.toLowerCase().endsWith('.png')) mimeType = 'image/png';
        else if (localPath.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
        else if (localPath.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';
        
        console.log(`✅ Imagem local processada com sucesso: ${mimeType}`);
        return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
      }
    }
  } catch (localError) {
    console.error(`⚠️ Erro ao processar imagem local: ${imageUrl}`, localError);
    // Continuar para o próximo método
  }
  
  // MÉTODO 4: Se a URL for um data:URI, já está em base64, retornar diretamente
  if (imageUrl.startsWith('data:')) {
    console.log(`✅ Imagem já está em formato data:URI, usando diretamente`);
    return imageUrl;
  }
  
  // Nenhum método funcionou
  console.warn(`❌ Todos os métodos de acesso à imagem falharam: ${imageUrl}`);
  return null;
}

// Helpers para o template Handlebars
// Helper para multiplicação
handlebars.registerHelper('multiply', function(a, b) {
  return Number(a) * Number(b);
});

// Helper para divisão
handlebars.registerHelper('divide', function(a, b) {
  return Number(a) / Number(b);
});

// Helper para comparação de igualdade
handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

// Helper para formatar preço para o template Handlebars
handlebars.registerHelper('formatPrice', function(price) {
  return new Intl.NumberFormat('pt-BR', { 
    style: 'currency', 
    currency: 'BRL' 
  }).format(price / 100);
});

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

// Interface para os dados que serão injetados no template HBS
interface TemplateData extends QuoteDataInput {
  companyName: string | null;
  companyLogoBase64: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyCnpj: string | null;
  quotePaymentTerms: string | null;
  quoteValidityDays: number | string; // Pode ser string ou número
  currentDate: string;
  // Itens com informações adicionais (descrição, imagem base64)
  items: (QuoteDataInput['items'][0] & { description?: string | null; imageBase64?: string | null; })[]; 
}

/**
 * Processa os dados do orçamento recebidos do front-end e prepara-os para o template
 * Garante que todos os campos necessários tenham valores padrão quando não fornecidos
 * 
 * @param quoteData Dados de orçamento vindos do front-end
 * @param itemsWithDetails Detalhes dos itens com imagens
 * @param companyUser Dados da empresa
 * @param companyLogoBase64 Logo da empresa em base64
 * @returns Dados prontos para o template
 */
function processQuoteData(
  quoteData: QuoteDataInput, 
  itemsWithDetails: any[], 
  companyUser: User,
  companyLogoBase64: string | null
): TemplateData {
  // Processando valor final com desconto se aplicável
  const finalPrice = quoteData.finalPrice || (quoteData.applyCashDiscount && quoteData.discountPercentage 
    ? quoteData.totalPrice * (1 - quoteData.discountPercentage / 100) 
    : quoteData.totalPrice);
  
  // Log para depuração dos dados de pagamento
  console.log('Dados de condições de pagamento processados:', {
    paymentInstallments: quoteData.paymentInstallments,
    paymentMethod: quoteData.paymentMethod,
    applyCashDiscount: quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage,
    totalPrice: quoteData.totalPrice,
    finalPrice: finalPrice
  });
  
  return {
    ...quoteData,
    items: itemsWithDetails, 
    companyName: companyUser.companyName,
    companyLogoBase64: companyLogoBase64,
    companyAddress: companyUser.companyAddress,
    companyPhone: companyUser.companyPhone,
    companyCnpj: companyUser.companyCnpj,
    quotePaymentTerms: companyUser.quotePaymentTerms,
    quoteValidityDays: companyUser.quoteValidityDays ?? '7', 
    currentDate: new Date().toLocaleDateString('pt-BR'),
    finalPrice: finalPrice,
    // Garantindo que os valores relacionados a pagamento estejam presentes
    paymentInstallments: quoteData.paymentInstallments || 'à vista',
    paymentMethod: quoteData.paymentMethod || 'boleto',
    applyCashDiscount: !!quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage || 0
  };
}

// Função para formatar preço (similar à do frontend)
const formatPrice = (priceInCents: number) => {
  return new Intl.NumberFormat('pt-BR', { 
    style: 'currency', 
    currency: 'BRL' 
  }).format(priceInCents / 100);
};

// Função para remover caracteres não-WinAnsi E NOVAS LINHAS
const sanitizeWinAnsi = (text: string | null | undefined): string => {
  if (!text) return '-';
  // Substituir CR e LF por espaço, depois remover outros caracteres inválidos
  return text.replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7EÁÉÍÓÚáéíóúÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÃÕãõÇçÄËÏÖÜäëïöü]/g, '?');
};

// Função auxiliar para desenhar texto com quebra de linha (melhorada)
async function drawWrappedText(page: PDFPage, text: string, options: { x: number, y: number, font: PDFFont, size: number, maxWidth: number, lineHeight: number, color?: any }) {
  const { x, y, font, size, maxWidth, lineHeight, color } = options;
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  let currentY = y;

  page.setFont(font);
  page.setFontSize(size);

  for (const paragraph of paragraphs) {
      const words = paragraph.split(' ');
      let currentLine = '';
      for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = font.widthOfTextAtSize(testLine, size);
          if (testWidth > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
          } else {
              currentLine = testLine;
          }
      }
      lines.push(currentLine); // Adiciona a última linha do parágrafo
  }

  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, color });
    currentY -= lineHeight;
  }

  return currentY;
}

// Função utilitária para formatação de preço (centavos para R$)
function formatBRLPrice(priceInCents: number): string {
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

// Método 1: Gerar PDF com pdf-lib (básico mas confiável)
export async function generateQuotePdf(quoteData: QuoteDataInput, companyUser: User): Promise<Uint8Array> {
  // LOG para verificar dados recebidos da empresa
  console.log("Dados da Empresa Recebidos para PDF:", JSON.stringify(companyUser, null, 2));
  
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 50;
  const contentWidth = width - 2 * margin;
  let yPos = height - margin;

  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  page.setFont(helveticaFont);
  page.setFontSize(10);

  // --- Cabeçalho --- 
  let logoHeight = 0;
  if (companyUser.companyLogoUrl) {
    try {
      const urlParts = new URL(companyUser.companyLogoUrl);
      let s3Key;
      
      if (companyUser.companyLogoUrl.includes('amazonaws.com')) {
        // Remove o bucket name da URL 
        const pathWithoutBucket = urlParts.pathname.split('/').slice(1).join('/');
        s3Key = decodeURIComponent(pathWithoutBucket);
      } else {
        s3Key = decodeURIComponent(urlParts.pathname.substring(1)); 
      }
      
      const imageUint8Array = await downloadFileFromS3(s3Key);
      
      const imageBuffer = Buffer.from(imageUint8Array);
      
      let embeddedImage;
      if (s3Key.toLowerCase().endsWith('.png')) {
          embeddedImage = await pdfDoc.embedPng(imageBuffer);
      } else if (s3Key.toLowerCase().endsWith('.jpg') || s3Key.toLowerCase().endsWith('.jpeg')) {
          embeddedImage = await pdfDoc.embedJpg(imageBuffer);
      } // TODO: Adicionar suporte a WEBP se necessário (requer biblioteca externa talvez)

      if (embeddedImage) {
        const logoMaxWidth = 120; // Diminuir um pouco?
        const logoMaxHeight = 40; 
        const scaled = embeddedImage.scaleToFit(logoMaxWidth, logoMaxHeight);
        logoHeight = scaled.height;
        page.drawImage(embeddedImage, {
          x: margin,
          y: yPos - scaled.height + 10, 
          width: scaled.width,
          height: scaled.height,
        });
      }
    } catch (error) {
      console.error("Erro ao baixar/incorporar logo:", error);
    }
  }
  
  const companyNameText = companyUser.companyName || 'Nome da Empresa';
  page.setFont(helveticaBoldFont);
  page.setFontSize(18); // Um pouco menor que antes
  const companyNameX = margin + (logoHeight > 0 ? 130 : 0); 
  const companyNameMaxWidth = width - companyNameX - margin;
  yPos = await drawWrappedText(page, companyNameText, { x: companyNameX, y: yPos, font: helveticaBoldFont, size: 18, maxWidth: companyNameMaxWidth, lineHeight: 20 });
  yPos += 10; // Ajustar espaçamento
  
  // Dados da Empresa abaixo do nome/logo
  let companyInfoY = yPos;
  page.setFontSize(9);
  page.setFont(helveticaFont);
  const companyInfoX = margin + (logoHeight > 0 ? 130 : 0);
   if(companyUser.companyAddress) {
      companyInfoY = await drawWrappedText(page, sanitizeWinAnsi(companyUser.companyAddress), { x: companyInfoX, y: companyInfoY, font: helveticaFont, size: 9, maxWidth: companyNameMaxWidth, lineHeight: 11 });
  }
  if(companyUser.companyPhone) {
      page.drawText(`Tel: ${sanitizeWinAnsi(companyUser.companyPhone)}`, { x: companyInfoX, y: companyInfoY, size: 9 });
      companyInfoY -= 11;
  }
   if(companyUser.companyCnpj) {
      page.drawText(`CNPJ: ${sanitizeWinAnsi(companyUser.companyCnpj)}`, { x: companyInfoX, y: companyInfoY, size: 9 });
      companyInfoY -= 11;
  }
  
  // Data sempre alinhada à direita, mas abaixo do bloco esquerdo (logo)
  page.setFont(helveticaFont);
  page.setFontSize(10);
  const dateText = `Data: ${new Date().toLocaleDateString('pt-BR')}`;
  const dateWidth = helveticaFont.widthOfTextAtSize(dateText, 10);
  // Usar a posição Y mais alta (a inicial do logo) para a data
  page.drawText(dateText, { x: width - margin - dateWidth, y: height - margin }); 

  yPos = companyInfoY - 25; // Espaço após info da empresa

  // --- Título Orçamento --- 
  page.setFont(helveticaBoldFont);
  page.setFontSize(16);
  page.drawText('ORÇAMENTO', { x: margin, y: yPos });
  yPos -= 25;

  // --- Dados do Cliente --- 
  page.setFont(helveticaBoldFont);
  page.setFontSize(12);
  page.drawText('DADOS DO CLIENTE', { x: margin, y: yPos });
  yPos -= 18;

  page.setFont(helveticaFont);
  page.setFontSize(10);
  page.drawText(`Nome: ${sanitizeWinAnsi(quoteData.clientName)}`, { x: margin, y: yPos });
  yPos -= 14;
  
  if (quoteData.clientEmail) {
      page.drawText(`E-mail: ${sanitizeWinAnsi(quoteData.clientEmail)}`, { x: margin, y: yPos });
      yPos -= 14;
  }
  
  if (quoteData.clientPhone) {
      page.drawText(`Telefone: ${sanitizeWinAnsi(quoteData.clientPhone)}`, { x: margin, y: yPos });
      yPos -= 14;
  }
  
  if (quoteData.architectName) {
      page.drawText(`Arquiteto: ${sanitizeWinAnsi(quoteData.architectName)}`, { x: margin, y: yPos });
      yPos -= 14;
  }
  
  yPos -= 15; // Espaço adicional
  
  // --- Produtos --- 
  page.setFont(helveticaBoldFont);
  page.setFontSize(12);
  page.drawText('PRODUTOS SELECIONADOS', { x: margin, y: yPos });
  yPos -= 18;

  // Header da Tabela
  const colX = {
      code: margin,
      name: margin + 70,
      color: margin + 230,
      quantity: margin + 300,
      price: margin + 340,
      total: margin + 410
  };
  
  // Cabeçalho da tabela
  page.setFont(helveticaBoldFont);
  page.setFontSize(9);
  page.drawText('Código', { x: colX.code, y: yPos });
  page.drawText('Produto', { x: colX.name, y: yPos });
  page.drawText('Cor', { x: colX.color, y: yPos });
  page.drawText('Qtd.', { x: colX.quantity, y: yPos });
  page.drawText('Preço', { x: colX.price, y: yPos });
  page.drawText('Subtotal', { x: colX.total, y: yPos });
  
  yPos -= 12;
  
  // Linha separadora
  page.drawLine({
      start: { x: margin, y: yPos + 2 },
      end: { x: width - margin, y: yPos + 2 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
  });
  
  yPos -= 12;
  
  // Itens da tabela
  page.setFont(helveticaFont);
  page.setFontSize(8);
  
  let itemCount = 0;
  for (const item of quoteData.items) {
      itemCount++;
      
      const productCode = sanitizeWinAnsi(item.productCode || '-');
      const productName = sanitizeWinAnsi(item.productName);
      const color = sanitizeWinAnsi(item.color || '-');
      const quantity = item.quantity || 1;
      const priceText = formatBRLPrice(item.price);
      const subtotal = item.price * quantity;
      const subtotalText = formatBRLPrice(subtotal);
      
      if (yPos < 100) { // Se estiver próximo do fim da página, adicione uma nova
          page = pdfDoc.addPage();
          page.setFont(helveticaFont);
          page.setFontSize(8);
          yPos = height - margin;
          
          // Repete o cabeçalho
          page.setFont(helveticaBoldFont);
          page.drawText('Código', { x: colX.code, y: yPos });
          page.drawText('Produto', { x: colX.name, y: yPos });
          page.drawText('Cor', { x: colX.color, y: yPos });
          page.drawText('Qtd.', { x: colX.quantity, y: yPos });
          page.drawText('Preço', { x: colX.price, y: yPos });
          page.drawText('Subtotal', { x: colX.total, y: yPos });
          
          yPos -= 12;
          
          page.drawLine({
              start: { x: margin, y: yPos + 2 },
              end: { x: width - margin, y: yPos + 2 },
              thickness: 1,
              color: rgb(0.8, 0.8, 0.8),
          });
          
          yPos -= 12;
          page.setFont(helveticaFont);
      }
      
      let descLines = 0;
      if (productName.length > 25) {
          const lines = Math.ceil(productName.length / 25);
          descLines = lines - 1; // A primeira linha já está contada no espaçamento padrão
      }
      
      page.drawText(productCode, { x: colX.code, y: yPos });
      
      // Nome do produto - texto que pode quebrar linhas
      const nameMaxWidth = colX.color - colX.name - 5;
      await drawWrappedText(page, productName, { x: colX.name, y: yPos, font: helveticaFont, size: 8, maxWidth: nameMaxWidth, lineHeight: 11 });
      
      page.drawText(color, { x: colX.color, y: yPos });
      page.drawText(String(quantity), { x: colX.quantity, y: yPos });
      page.drawText(priceText, { x: colX.price, y: yPos });
      page.drawText(subtotalText, { x: colX.total, y: yPos });
      
      const rowHeight = 14;
      yPos -= Math.max(rowHeight, descLines * 11); // Adjust yPos based on description height
  }
  
  yPos -= 15;
  
  // Linha separadora antes do total
  page.drawLine({
      start: { x: colX.total - 20, y: yPos + 2 },
      end: { x: width - margin, y: yPos + 2 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
  });
  
  yPos -= 15;
  
  // Calculando o valor final (com desconto, se aplicável)
  const finalPrice = quoteData.finalPrice || (quoteData.applyCashDiscount && quoteData.discountPercentage 
      ? quoteData.totalPrice * (1 - quoteData.discountPercentage / 100) 
      : quoteData.totalPrice);
  
  // Total
  if (quoteData.applyCashDiscount && quoteData.discountPercentage) {
      page.setFont(helveticaFont);
      page.setFontSize(9);
      page.drawText('Subtotal:', { x: colX.total - 50, y: yPos });
      page.drawText(formatBRLPrice(quoteData.totalPrice), { x: colX.total, y: yPos });
      yPos -= 14;
      
      page.drawText(`Desconto (${quoteData.discountPercentage}%):`, { x: colX.total - 90, y: yPos });
      const discountValue = quoteData.totalPrice * (quoteData.discountPercentage / 100);
      page.drawText(`-${formatBRLPrice(discountValue)}`, { x: colX.total, y: yPos });
      yPos -= 14;
  }
  
  page.setFont(helveticaBoldFont);
  page.setFontSize(10);
  page.drawText('TOTAL:', { x: colX.total - 50, y: yPos });
  page.drawText(formatBRLPrice(finalPrice), { x: colX.total, y: yPos });
  
  yPos -= 30;
  
  // --- Condições de Pagamento --- 
  page.setFont(helveticaBoldFont);
  page.setFontSize(12);
  page.drawText('CONDIÇÕES DE PAGAMENTO', { x: margin, y: yPos });
  yPos -= 18;
  
  page.setFont(helveticaFont);
  page.setFontSize(10);
  
  // Forma de pagamento (à vista, parcelado, etc.)
  const paymentInstallments = quoteData.paymentInstallments || 'à vista';
  page.drawText(`Forma de pagamento: ${paymentInstallments}`, { x: margin, y: yPos });
  yPos -= 14;
  
  // Método de pagamento (boleto, cartão, etc.)
  let paymentMethodText = 'Não especificado';
  switch (quoteData.paymentMethod) {
      case 'boleto':
          paymentMethodText = 'Boleto Bancário';
          break;
      case 'cartao':
          paymentMethodText = 'Cartão de Crédito';
          break;
      case 'cheque':
          paymentMethodText = 'Cheque';
          break;
      default:
          paymentMethodText = quoteData.paymentMethod || 'Não especificado';
  }
  
  page.drawText(`Método: ${paymentMethodText}`, { x: margin, y: yPos });
  yPos -= 14;
  
  // Desconto para pagamento à vista
  if (paymentInstallments === 'à vista' && quoteData.applyCashDiscount) {
      page.drawText(`Desconto à vista: ${quoteData.discountPercentage}%`, { x: margin, y: yPos });
      yPos -= 14;
  }
  
  yPos -= 10;
  
  // --- Observações ---
  if (quoteData.notes) {
      page.setFont(helveticaBoldFont);
      page.setFontSize(12);
      page.drawText('OBSERVAÇÕES', { x: margin, y: yPos });
      yPos -= 18;
      
      page.setFont(helveticaFont);
      page.setFontSize(9);
      yPos = await drawWrappedText(page, sanitizeWinAnsi(quoteData.notes), { 
          x: margin, 
          y: yPos, 
          font: helveticaFont, 
          size: 9, 
          maxWidth: width - (2 * margin), 
          lineHeight: 11 
      });
      
      yPos -= 15;
  }
  
  // --- Rodapé ---
  page.drawLine({
      start: { x: margin, y: 100 },
      end: { x: width - margin, y: 100 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
  });
  
  page.setFont(helveticaFont);
  page.setFontSize(8);
  let footerY = 85;
  
  // Adicionar termos de validade
  page.drawText(`A validade deste orçamento é de ${companyUser.quoteValidityDays || '7'} dias a partir da data de emissão.`, { 
      x: margin, 
      y: footerY 
  });
  footerY -= 12;
  
  // Adicionar condições de pagamento personalizadas (se houver)
  if (companyUser.quotePaymentTerms) {
      footerY = await drawWrappedText(page, sanitizeWinAnsi(companyUser.quotePaymentTerms), { 
          x: margin, 
          y: footerY, 
          font: helveticaFont, 
          size: 8, 
          maxWidth: width - (2 * margin), 
          lineHeight: 10 
      });
  } else {
      page.drawText('Condições de pagamento a combinar.', { x: margin, y: footerY });
      footerY -= 12;
  }
  
  footerY -= 5;
  
  // Mensagem de agradecimento
  page.drawText(`${companyUser.companyName || 'Nossa empresa'} agradece a preferência.`, { 
      x: margin, 
      y: footerY 
  });
  
  // Telefone para contato
  if (companyUser.companyPhone) {
      footerY -= 12;
      page.drawText(`Para mais informações, entre em contato com nossa comercial: ${companyUser.companyPhone}`, { 
          x: margin, 
          y: footerY 
      });
  }
  
  // Retorna o PDF como Uint8Array
  return await pdfDoc.save();
}

// Método 2: Gerar PDF com HTML e Puppeteer (melhor qualidade visual)
export async function generateQuotePdfWithPuppeteer(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração com Puppeteer...");
  
  try {
    // 1. Ler o template Handlebars
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    const templateSource = await fs.promises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);
    
    // 2. Buscar logo da empresa em base64 (se houver)
    let companyLogoBase64 = null;
    if (companyUser.companyLogoUrl) {
      try {
        companyLogoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
        console.log("✅ Logo da empresa carregada com sucesso!");
      } catch (logoError) {
        console.error("❌ Erro ao carregar logo da empresa:", logoError);
      }
    }
    
    // 3. Buscar detalhes e imagens dos produtos
    let itemsWithDetails: any[] = [];
    try {
      // Buscando detalhes adicionais dos produtos da base de dados
      const productIds = quoteData.items.map(item => item.productId);
      console.log(`Buscando detalhes para ${productIds.length} produtos...`);
      
      const productsDetails = await storage.getProductsDetails(productIds);
      console.log(`Detalhes encontrados para ${Object.keys(productsDetails).length} produtos.`);
      
      // Processar cada item, adicionando descrição e imagem base64
      itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
        console.log(`Processando imagem do item ${index + 1} - ${item.productName}...`);
        const productDetails = productsDetails[item.productId];
        
        // Estratégia de 5 camadas para obter a imagem do produto:
        let imageBase64 = null;
        
        // Estratégia 1: Usar URL de imagem fornecida do front-end (se houver)
        if (productDetails?.imageUrl) {
          console.log(`  Item ${index + 1}: Tentando URL da imagem principal: ${productDetails.imageUrl}`);
          imageBase64 = await getBase64ImageFromS3(productDetails.imageUrl);
        }
        
        // Estratégia 2: Se não deu certo, verificar URL da miniatura (thumbnail)
        if (!imageBase64 && productDetails?.thumbnailUrl) {
          console.log(`  Item ${index + 1}: Tentando URL da miniatura: ${productDetails.thumbnailUrl}`);
          imageBase64 = await getBase64ImageFromS3(productDetails.thumbnailUrl);
        }
        
        // Estratégia 3: Se ainda não deu certo, tentar URL completa do S3
        if (!imageBase64 && productDetails?.s3ImageUrl) {
          console.log(`  Item ${index + 1}: Tentando URL completa do S3: ${productDetails.s3ImageUrl}`);
          imageBase64 = await getBase64ImageFromS3(productDetails.s3ImageUrl);
        }
        
        // Estratégia 4: Se tudo falhou, tentar imagens adicionais (se houver)
        if (!imageBase64 && productDetails?.additionalImages?.length > 0) {
          console.log(`  Item ${index + 1}: Tentando primeira imagem adicional: ${(productDetails as any).additionalImages[0]}`);
          imageBase64 = await getBase64ImageFromS3((productDetails as any).additionalImages[0]);
        }
        
        // Estratégia 5: Usar imagem de placeholder caso nenhuma das opções acima funcione
        if (!imageBase64) {
          const placeholderUrl = 'https://via.placeholder.com/150?text=Sem+Imagem';
          console.log(`  Item ${index + 1}: Usando imagem de placeholder`);
          try {
            const response = await fetch(placeholderUrl);
            if (response.ok) {
              const buffer = await response.arrayBuffer();
              imageBase64 = `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
            }
          } catch (placeholderError) {
            console.error(`Erro ao buscar placeholder: ${placeholderError}`);
          }
        }
        
        console.log(`  Item ${index + 1}: Status final da imagem: ${imageBase64 ? '✅ SUCESSO' : '❌ FALHA'}`);
        
        return {
          ...item,
          description: productDetails?.description || '-', 
          imageBase64: imageBase64,
          productCode: item.productCode || '-', // Garantir que não é null
          color: item.color || '-', // Garantir que não é null/undefined
          // Adicionar mais informações que podem ser úteis no template
          category: productDetails?.category || null,
          manufacturer: productDetails?.manufacturer || null
        };
      }));
      console.log("✅ Detalhes de todos os itens processados.");
    } catch (err) {
      console.error("❌ Erro ao buscar detalhes dos produtos:", err);
      throw new Error("Falha ao buscar informações dos produtos para o PDF.");
    }
  
  // Processando valor final com desconto se aplicável
  const finalPrice = quoteData.finalPrice || (quoteData.applyCashDiscount && quoteData.discountPercentage 
    ? quoteData.totalPrice * (1 - quoteData.discountPercentage / 100) 
    : quoteData.totalPrice);
  
  // Log para depuração dos dados de pagamento
  console.log('Dados de condições de pagamento (Puppeteer):', {
    paymentInstallments: quoteData.paymentInstallments,
    paymentMethod: quoteData.paymentMethod,
    applyCashDiscount: quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage,
    totalPrice: quoteData.totalPrice,
    finalPrice: finalPrice
  });
  
  const templateData: TemplateData = {
    ...quoteData,
    items: itemsWithDetails, 
    companyName: companyUser.companyName,
    companyLogoBase64: companyLogoBase64,
    companyAddress: companyUser.companyAddress,
    companyPhone: companyUser.companyPhone,
    companyCnpj: companyUser.companyCnpj,
    quotePaymentTerms: companyUser.quotePaymentTerms,
    quoteValidityDays: companyUser.quoteValidityDays ?? '7', 
    currentDate: new Date().toLocaleDateString('pt-BR'),
    finalPrice: finalPrice,
    // Garantindo que os valores relacionados a pagamento estejam presentes
    paymentInstallments: quoteData.paymentInstallments || 'à vista',
    paymentMethod: quoteData.paymentMethod || 'boleto',
    applyCashDiscount: !!quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage || 0
  };
  
  // 3. Renderizar HTML
  let htmlContent = '';
  try {
      console.log("Renderizando HTML com Handlebars...");
      htmlContent = template(templateData);
      console.log("HTML renderizado com sucesso.");
  } catch (err) {
      console.error("Erro ao renderizar HTML com Handlebars:", err);
      throw new Error("Falha ao montar conteúdo do PDF.");
  }
  
  // 4. Gerar PDF com o Puppeteer
  let pdfBuffer: Buffer;
  try {
      console.log("Iniciando Puppeteer para geração do PDF...");
      
      const browser = await puppeteer.launch({
          headless: 'new', // 'new' é a nova forma para headless
          args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      console.log("Carregando HTML no Puppeteer...");
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      
      console.log("Gerando PDF com Puppeteer...");
      pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
          displayHeaderFooter: false,
      });
      
      await browser.close();
      console.log("✅ PDF gerado com sucesso via Puppeteer!");
      
      return pdfBuffer;
  } catch (err) {
      console.error("Erro ao gerar PDF com Puppeteer:", err);
      throw err; // Propagar o erro para que o próximo método seja tentado
  }
}

// Método 3: Gerar PDF com html-pdf (PhantomJS - alternativa mais leve)
export async function generateQuotePdfWithHtmlPdf(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração com html-pdf (PhantomJS)...");
  
  try {
    // 1. Ler o template Handlebars
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    const templateSource = await fs.promises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);
    
    // 2. Buscar logo da empresa em base64 (se houver)
    let companyLogoBase64 = null;
    if (companyUser.companyLogoUrl) {
      try {
        companyLogoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
        console.log("✅ Logo da empresa carregada com sucesso!");
      } catch (logoError) {
        console.error("❌ Erro ao carregar logo da empresa:", logoError);
      }
    }
    
    // 3. Buscar detalhes e imagens dos produtos
    let itemsWithDetails: any[] = [];
    try {
        // Buscando detalhes adicionais dos produtos da base de dados
        const productIds = quoteData.items.map(item => item.productId);
        const productsDetails = await storage.getProductsDetails(productIds);
        
        // Processar cada item, adicionando descrição e imagem base64
        itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
            const productDetails = productsDetails[item.productId];
            
            // Estratégia de 5 camadas para obter a imagem do produto:
            let imageBase64 = null;
            
            // Estratégia 1: Usar URL de imagem fornecida do front-end (se houver)
            if (productDetails?.imageUrl) {
                imageBase64 = await getBase64ImageFromS3(productDetails.imageUrl);
            }
            
            // Estratégia 2: Se não deu certo, verificar URL da miniatura (thumbnail)
            if (!imageBase64 && productDetails?.thumbnailUrl) {
                imageBase64 = await getBase64ImageFromS3(productDetails.thumbnailUrl);
            }
            
            // Estratégia 3: Se ainda não deu certo, tentar URL completa do S3
            if (!imageBase64 && productDetails?.s3ImageUrl) {
                imageBase64 = await getBase64ImageFromS3(productDetails.s3ImageUrl);
            }
            
            // Estratégia 4: Se tudo falhou, tentar imagens adicionais (se houver)
            if (!imageBase64 && productDetails?.additionalImages?.length > 0) {
                imageBase64 = await getBase64ImageFromS3((productDetails as any).additionalImages[0]);
            }
            
            // Estratégia 5: Usar imagem de placeholder caso nenhuma das opções acima funcione
            if (!imageBase64) {
                try {
                    const response = await fetch('https://via.placeholder.com/150?text=Sem+Imagem');
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        imageBase64 = `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
                    }
                } catch (placeholderError) {
                    console.error(`Erro ao buscar placeholder: ${placeholderError}`);
                }
            }
            
            return {
                ...item,
                description: productDetails?.description || '-', 
                imageBase64: imageBase64,
                productCode: item.productCode || '-',
                color: item.color || '-',
                category: productDetails?.category || null,
                manufacturer: productDetails?.manufacturer || null
            };
        }));
        
    } catch (err) {
        console.error("Erro ao buscar detalhes dos produtos:", err);
        throw new Error("Falha ao buscar informações dos produtos para o PDF.");
    }
  
  // Processando valor final com desconto se aplicável
  const finalPrice = quoteData.finalPrice || (quoteData.applyCashDiscount && quoteData.discountPercentage 
    ? quoteData.totalPrice * (1 - quoteData.discountPercentage / 100) 
    : quoteData.totalPrice);
  
  // Log para depuração dos dados de pagamento
  console.log('Dados de condições de pagamento (PhantomJS):', {
    paymentInstallments: quoteData.paymentInstallments,
    paymentMethod: quoteData.paymentMethod,
    applyCashDiscount: quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage,
    totalPrice: quoteData.totalPrice,
    finalPrice: finalPrice
  });
  
  const templateData: TemplateData = {
    ...quoteData,
    items: itemsWithDetails, 
    companyName: companyUser.companyName,
    companyLogoBase64: companyLogoBase64,
    companyAddress: companyUser.companyAddress,
    companyPhone: companyUser.companyPhone,
    companyCnpj: companyUser.companyCnpj,
    quotePaymentTerms: companyUser.quotePaymentTerms,
    quoteValidityDays: companyUser.quoteValidityDays ?? '7', 
    currentDate: new Date().toLocaleDateString('pt-BR'),
    finalPrice: finalPrice,
    // Garantindo que os valores relacionados a pagamento estejam presentes
    paymentInstallments: quoteData.paymentInstallments || 'à vista',
    paymentMethod: quoteData.paymentMethod || 'boleto',
    applyCashDiscount: !!quoteData.applyCashDiscount,
    discountPercentage: quoteData.discountPercentage || 0
  };
    
    // 3. Renderizar HTML
    let htmlContent = '';
    try {
        console.log("Renderizando HTML com Handlebars...");
        htmlContent = template(templateData);
        console.log("HTML renderizado com sucesso!");
    } catch (err) {
        console.error("Erro ao renderizar HTML com Handlebars:", err);
        throw new Error("Falha ao montar conteúdo do PDF.");
    }
    
    // 4. Gerar PDF com html-pdf (PhantomJS)
    return new Promise((resolve, reject) => {
        const pdfOptions = {
            format: 'A4',
            border: {
                top: '15mm',
                right: '15mm',
                bottom: '15mm',
                left: '15mm'
            },
            timeout: 30000, // 30 segundos
        };
        
        console.log("Gerando PDF com html-pdf (PhantomJS)...");
        
        try {
          htmlPdf.create(htmlContent, pdfOptions).toBuffer((err: Error | null, buffer: Buffer) => {
              if (err) {
                  console.error("Erro ao gerar PDF com html-pdf:", err);
                  reject(err);
                  return;
              }
              
              console.log("✅ PDF gerado com sucesso via html-pdf (PhantomJS)!");
              resolve(buffer);
          });
        } catch (err) {
          console.error("Erro crítico ao gerar PDF com html-pdf:", err);
          reject(err);
        }
    });
  } catch (err) {
      console.error("Erro durante o processo de geração com html-pdf:", err);
      throw err; // Propagar o erro para o próximo método
  }
}