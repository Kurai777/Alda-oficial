import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { Product, User } from '@shared/schema'; // Importar User
import { downloadFileFromS3 } from './s3-service'; 
import { storage } from './storage'; // Para buscar descrição do produto
import * as fs from 'fs'; // Usar fs normal para ter acesso às funções sync
import path from 'path';
import handlebars from 'handlebars';
// import puppeteer from 'puppeteer'; // COMENTADO - REMOVENDO PUPPETEER
import { execSync } from 'child_process'; // Para comandos do sistema
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
interface QuoteDataInput {
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

// Função principal para gerar o PDF com pdf-lib (MELHORADA)
export async function generateQuotePdf(quoteData: QuoteDataInput, companyUser: User): Promise<Uint8Array> {
  console.log("Gerando PDF (pdf-lib) - Dados da Empresa:", JSON.stringify(companyUser, null, 2));
  
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

  // --- CABEÇALHO MELHORADO --- 
  let logoHeight = 0;
  const logoMaxWidth = 120; 
  const logoMaxHeight = 40;
  if (companyUser.companyLogoUrl) {
    try {
      const urlParts = new URL(companyUser.companyLogoUrl);
      const s3Key = decodeURIComponent(urlParts.pathname.substring(1)); 
      const imageUint8Array = await downloadFileFromS3(s3Key);
      const imageBuffer = Buffer.from(imageUint8Array);
      let embeddedImage;
      if (s3Key.toLowerCase().endsWith('.png')) {
          embeddedImage = await pdfDoc.embedPng(imageBuffer);
      } else if (s3Key.toLowerCase().endsWith('.jpg') || s3Key.toLowerCase().endsWith('.jpeg')) {
          embeddedImage = await pdfDoc.embedJpg(imageBuffer);
      } 

      if (embeddedImage) {
        const scaled = embeddedImage.scaleToFit(logoMaxWidth, logoMaxHeight);
        logoHeight = scaled.height;
        page.drawImage(embeddedImage, {
          x: margin,
          y: yPos - scaled.height + 10, 
          width: scaled.width,
          height: scaled.height,
        });
        console.log("Logo incorporado ao PDF.");
      } else {
         console.log("Logo encontrado mas formato não suportado (PNG/JPG).")
      }
    } catch (error) {
      console.error("Erro ao baixar/incorporar logo no pdf-lib:", error);
    }
  } else {
      console.log("Nenhuma URL de logo encontrada para a empresa.");
  }
  
  // Nome da Empresa
  const companyNameText = companyUser.companyName || 'Nome da Empresa';
  page.setFont(helveticaBoldFont);
  page.setFontSize(18); 
  const companyNameX = margin + (logoHeight > 0 ? logoMaxWidth + 10 : 0); 
  const companyNameMaxWidth = width - companyNameX - margin;
  // Desenhar nome (quebra manual simples se necessário)
  const companyNameLines = companyNameText.split('\n'); // Tratar quebras de linha no nome?
  let nameY = yPos;
  for (const line of companyNameLines) {
       page.drawText(line, { x: companyNameX, y: nameY, font: helveticaBoldFont, size: 18 });
       nameY -= 20; // Espaçamento entre linhas do nome
  }
  const companyNameHeight = (companyNameLines.length * 20);

  // Dados da Empresa abaixo do nome
  let companyInfoY = nameY + (companyNameLines.length > 1 ? 10 : 0); // Ajustar Y inicial
  page.setFont(helveticaFont);
  page.setFontSize(9);
  const companyInfoX = companyNameX;
   if(companyUser.companyAddress) {
       const addrLines = sanitizeWinAnsi(companyUser.companyAddress).split('\n');
       for(const line of addrLines) {
           // TODO: Quebra de linha longa?
            page.drawText(line, { x: companyInfoX, y: companyInfoY, size: 9 });
            companyInfoY -= 11;
       }
  }
  if(companyUser.companyPhone) {
      page.drawText(`Tel: ${sanitizeWinAnsi(companyUser.companyPhone)}`, { x: companyInfoX, y: companyInfoY, size: 9 });
      companyInfoY -= 11;
  }
   if(companyUser.companyCnpj) {
      page.drawText(`CNPJ: ${sanitizeWinAnsi(companyUser.companyCnpj)}`, { x: companyInfoX, y: companyInfoY, size: 9 });
      companyInfoY -= 11;
  }
  const companyInfoHeight = nameY - companyInfoY;
  
  // Data alinhada à direita
  page.setFont(helveticaFont);
  page.setFontSize(10);
  const dateText = `Data: ${new Date().toLocaleDateString('pt-BR')}`;
  const dateWidth = helveticaFont.widthOfTextAtSize(dateText, 10);
  page.drawText(dateText, { x: width - margin - dateWidth, y: height - margin }); 

  // Ajustar Y principal baseado na maior altura (logo ou texto da empresa)
  yPos = height - margin - Math.max(logoHeight + 10, companyNameHeight + companyInfoHeight) - 15; 

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
  yPos -= 10;

  // --- Tabela de Itens --- (Adicionar Imagem e Descrição)
  const tableTopY = yPos;
  const rowHeight = 45; // Aumentar altura para imagem
  const imageColWidth = 40;
  const colWidths = { 
      image: imageColWidth, 
      code: 60, 
      product: 130, // Diminuir um pouco
      desc: 140, // Diminuir um pouco
      color: 50, 
      price: 70 
  }; 

  // Cabeçalho Tabela
  page.setFont(helveticaBoldFont); page.setFontSize(10);
  let currentX = margin;
  page.drawText('Img', { x: currentX + imageColWidth / 2 - 10, y: yPos }); // Centralizar Img
  currentX += colWidths.image + 10;
  page.drawText('Código', { x: currentX, y: yPos }); currentX += colWidths.code + 10;
  page.drawText('Produto', { x: currentX, y: yPos }); currentX += colWidths.product + 10;
  page.drawText('Descrição', { x: currentX, y: yPos }); currentX += colWidths.desc + 10;
  page.drawText('Cor', { x: currentX, y: yPos }); currentX += colWidths.color + 10;
  page.drawText('Preço Unit.', { x: width - margin - colWidths.price, y: yPos }); // Alinhar Preço à direita
  yPos -= 15; 
  page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  yPos -= 5;

  // Itens da Tabela
  page.setFont(helveticaFont); page.setFontSize(9);
  for (const item of quoteData.items) {
    if (yPos - rowHeight < margin + 60) { // Checar espaço antes de desenhar
        page = pdfDoc.addPage();
        yPos = height - margin - 20; 
        // TODO: Redesenhar cabeçalho da tabela na nova página
    }
    
    const itemStartY = yPos;
    let textY = itemStartY - 11; 
    currentX = margin;

    // 1. TENTAR DESENHAR IMAGEM
    let productImageHeight = 0;
    try {
      const productDetails = await storage.getProduct(item.productId);
      if (productDetails?.imageUrl) {
        const urlParts = new URL(productDetails.imageUrl);
        const s3Key = decodeURIComponent(urlParts.pathname.substring(1));
        const imgUint8Array = await downloadFileFromS3(s3Key);
        const imgBuffer = Buffer.from(imgUint8Array);
        let embeddedImg;
        if (s3Key.toLowerCase().endsWith('.png')) {
            embeddedImg = await pdfDoc.embedPng(imgBuffer);
        } else if (s3Key.toLowerCase().endsWith('.jpg') || s3Key.toLowerCase().endsWith('.jpeg')) {
            embeddedImg = await pdfDoc.embedJpg(imgBuffer);
        }
        if (embeddedImg) {
            const maxImgHeight = rowHeight - 10; // Deixar margem
            const scaled = embeddedImg.scaleToFit(colWidths.image, maxImgHeight);
            page.drawImage(embeddedImg, {
                x: margin,
                y: yPos - maxImgHeight + (maxImgHeight - scaled.height) / 2, // Centralizar verticalmente
                width: scaled.width,
                height: scaled.height
            });
            productImageHeight = scaled.height;
            console.log(`Imagem ${s3Key} desenhada.`);
        } else {
             console.log(`Imagem ${s3Key} encontrada mas formato não suportado.`)
        }
      } else {
          console.log(`Produto ${item.productId} sem imageUrl.`);
      }
    } catch (imgError) {
      console.error(`Erro ao processar imagem para produto ${item.productId}:`, imgError);
    }
    currentX += colWidths.image + 10;

    // 2. DESENHAR OUTRAS COLUNAS
    const productDetails = await storage.getProduct(item.productId);
    const description = sanitizeWinAnsi(productDetails?.description || '-').substring(0, 100); // Truncar descrição por ora
    const code = sanitizeWinAnsi(item.productCode);
    const name = sanitizeWinAnsi(item.productName);
    const color = sanitizeWinAnsi(item.color);
    const priceText = formatPrice(item.price);

    page.drawText(code, { x: currentX, y: textY }); currentX += colWidths.code + 10;
    page.drawText(name, { x: currentX, y: textY }); currentX += colWidths.product + 10;
    page.drawText(description, { x: currentX, y: textY }); currentX += colWidths.desc + 10;
    page.drawText(color, { x: currentX, y: textY });
    
    const priceWidth = helveticaFont.widthOfTextAtSize(priceText, 9);
    page.drawText(priceText, { x: width - margin - priceWidth, y: textY });
    
    // 3. AJUSTAR Y e desenhar linha
    yPos -= rowHeight; // Usar altura de linha fixa por enquanto
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
    yPos -= 5; 
  }

  // --- Total --- (Restaurado)
  yPos -= 10; 
  page.setFont(helveticaBoldFont); page.setFontSize(12);
  const totalText = `TOTAL DO ORÇAMENTO: ${formatPrice(quoteData.totalPrice)}`;
  page.drawText(totalText, { x: width - margin - 150, y: yPos }); // Posição fixa
  yPos -= 25;

  // --- Observações --- (Restaurado)
  if (quoteData.notes) {
    page.setFont(helveticaBoldFont);
    page.setFontSize(12);
    page.drawText('OBSERVAÇÕES', { x: margin, y: yPos });
    yPos -= 18;

    page.setFont(helveticaFont);
    page.setFontSize(10);
    // Desenhar linha por linha, sanitizando cada uma
    const noteLines = sanitizeWinAnsi(quoteData.notes).split('\n'); 
    for (const line of noteLines) {
        // TODO: Adicionar quebra de linha automática se uma linha for muito longa
        if (yPos < margin) { page = pdfDoc.addPage(); yPos = height - margin; }
        // Usar lineHeight para espaçamento e descer
        page.drawText(line, { x: margin, y: yPos, lineHeight: 12 }); 
        yPos -= 12; 
    }
    yPos -= 10;
  }

  // --- Rodapé MELHORADO --- 
  const footerStartY = margin + 40; 
  let currentFooterY = footerStartY;
  page.setFont(helveticaFont); page.setFontSize(9);
  page.drawLine({ start: { x: margin, y: currentFooterY + 5 }, end: { x: width - margin, y: currentFooterY + 5 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  currentFooterY -= 11;
  
  const validityDays = companyUser.quoteValidityDays ?? 7; 
  page.drawText(
    `A validade deste orçamento é de ${validityDays} dias a partir da data de emissão.`,
    { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) }
  );
  currentFooterY -= 11 * 1.5; // Mais espaço

  const terms = companyUser.quotePaymentTerms || 'Condições de pagamento a combinar.';
  const termsLines = sanitizeWinAnsi(terms).split('\n');
  page.drawText('Condições:', { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3), font: helveticaBoldFont });
  currentFooterY -= 11;
  for (const line of termsLines) {
      if (currentFooterY < margin / 2) break; 
      page.drawText(line, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3), lineHeight: 11 });
      currentFooterY -= 11;
  }
  currentFooterY -= 5; 
  
  if (currentFooterY > margin / 2) { 
    page.drawText(`${companyUser.companyName || 'Empresa'} agradece a preferência.`, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) });
    currentFooterY -= 11;
  }
  if(companyUser.companyPhone && currentFooterY > margin / 2) {
       page.drawText(`Para mais informações: ${sanitizeWinAnsi(companyUser.companyPhone)}`, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) });
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- NOVA FUNÇÃO USANDO PUPPETEER --- // COMENTADO - REMOVENDO PUPPETEER
/* // COMENTADO - REMOVENDO PUPPETEER
export async function generateQuotePdfWithPuppeteer(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração de PDF com Puppeteer...");

  // 1. Carregar e compilar template HTML Handlebars
  let templateHtml = '';
  try {
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    console.log(`Carregando template de: ${templatePath}`);
    // Usar a versão correta de fs.promises
    const fileContent = await fsPromises.readFile(templatePath, 'utf-8');
    templateHtml = fileContent;
    console.log("Template HTML carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar template HTML:", err);
    throw new Error("Falha ao carregar template do orçamento.");
  }
  
  // Registrar helper de formatação de preço
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
  
  // Helper para formatar preço
  handlebars.registerHelper('formatPrice', function(price: number) {
    // Formatar o preço como R$ XX.XXX,XX
    try {
      // Converte para centavos
      const priceInCents = typeof price === 'number' ? price : parseInt(price);
      if (isNaN(priceInCents)) return 'Preço inválido';
      
      // Formato brasileiro: R$ XX.XXX,XX
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2
      }).format(priceInCents / 100);
    } catch (err) {
      console.error('Erro ao formatar preço:', err);
      return 'ERRO';
    }
  });
  
  const template = handlebars.compile(templateHtml);

  // 2. Preparar dados completos para o template
  console.log("Preparando dados para o template...");
  let companyLogoBase64: string | null = null;
  try {
      companyLogoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
      console.log(`Logo ${companyLogoBase64 ? 'processado' : 'não encontrado/falhou'}`);
  } catch (err) {
      console.error("Erro ao processar logo:", err);
  }

  let itemsWithDetails: any[] = [];
  try {
      console.log(`🔍 Buscando detalhes para ${quoteData.items.length} itens...`);
      itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
        console.log(`  Item ${index + 1}: Buscando produto ID ${item.productId}`);
        const productDetails = await storage.getProduct(item.productId);
        console.log(`  Item ${index + 1}: Detalhes ${productDetails ? 'encontrados ✓' : 'NÃO encontrados ✗'}`);
        
        // MÚLTIPLAS ESTRATÉGIAS PARA OBTER IMAGENS
        let imageBase64 = null;
        
        // Estratégia 1: Usar a URL do produto do banco de dados
        if (productDetails?.imageUrl) {
          console.log(`  Item ${index + 1}: Tentando imageUrl do produto: ${productDetails.imageUrl}`);
          imageBase64 = await getBase64ImageFromS3(productDetails.imageUrl);
        }
        
        // Estratégia 2: Tentar buscar pelo código do produto
        if (!imageBase64 && item.productCode) {
          const codeImageUrl = `/api/images/products/by-code/${item.productCode}`;
          console.log(`  Item ${index + 1}: Tentando URL por código: ${codeImageUrl}`);
          imageBase64 = await getBase64ImageFromS3(codeImageUrl);
        }
        
        // Estratégia 3: Tentar usar o ID do produto para construir um caminho alternativo
        if (!imageBase64 && productDetails?.id) {
          const idImageUrl = `/uploads/products/${productDetails.id}.jpg`;
          console.log(`  Item ${index + 1}: Tentando URL por ID: ${idImageUrl}`);
          imageBase64 = await getBase64ImageFromS3(idImageUrl);
        }
        
        // Estratégia 4: Verificar se tem imagem secundária em additionalImages (se existir)
        if (!imageBase64 && productDetails && 'additionalImages' in productDetails && 
            Array.isArray((productDetails as any).additionalImages) && 
            (productDetails as any).additionalImages.length > 0) {
          console.log(`  Item ${index + 1}: Tentando imagem adicional`);
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
  } catch (err: any) { // Adicionado 'any' para compatibilidade com o throw abaixo
      console.error("❌ Erro ao buscar detalhes dos produtos:", err);
      throw new Error("Falha ao buscar informações dos produtos para o PDF.");
  }
  
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
    paymentInstallments: quoteData.paymentInstallments || 'Não especificado',
    paymentMethod: quoteData.paymentMethod || 'Não especificado',
    applyCashDiscount: quoteData.applyCashDiscount ?? false,
    discountPercentage: quoteData.discountPercentage || 0,
    finalPrice: quoteData.finalPrice ?? quoteData.totalPrice
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

  // 4. Lançar Puppeteer e gerar PDF
  console.log("Lançando Puppeteer...");
  let browser;
  try {
    // Flags adicionais para melhorar compatibilidade em ambiente Replit
    const puppeteerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--disable-software-rasterizer'
    ]; 
    
    console.log("Args Puppeteer:", puppeteerArgs.join(' '));
    
    // Abordagem simplificada - deixar o Puppeteer usar seu próprio Chromium
    // browser = await puppeteer.launch({  // LINHA ORIGINAL COMENTADA
    //     headless: true,
    //     args: puppeteerArgs,
    //     timeout: 60000, // Timeout mais alto (60 segundos)
    // });
    throw new Error("Puppeteer está desativado. Esta função não deve ser chamada."); // Adicionado para indicar que não deve ser usado

    console.log("Navegador lançado.");
    const page = await browser.newPage();
    console.log("Nova página criada.");

    // Configurar tamanho da página para A4
    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1.5,
    });
    
    // Definir timeout mais alto para carregamento de conteúdo
    await page.setDefaultNavigationTimeout(30000);
    
    console.log("Definindo conteúdo HTML na página...");
    try {
      await page.setContent(htmlContent, { 
        waitUntil: 'networkidle0',
        timeout: 25000 
      });
      console.log("Conteúdo HTML definido.");
    } catch (contentError) {
      console.error("Erro ao definir conteúdo HTML:", contentError);
      // Tentar de novo com menos restrições no waitUntil
      await page.setContent(htmlContent, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      console.log("Conteúdo HTML definido (modo fallback).");
    }
    
    console.log("Gerando buffer do PDF...");
    const pdfBuffer = await page.pdf({ 
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        bottom: '15mm',
        left: '15mm',
        right: '15mm'
      },
      preferCSSPageSize: true,
      displayHeaderFooter: false
    });
    console.log("PDF gerado com sucesso (Buffer). Tamanho:", pdfBuffer.length);
    return Buffer.from(pdfBuffer); // Garantir que é Buffer do Node

  } catch (error) {
      console.error("Erro DETALHADO durante a geração do PDF com Puppeteer:", error);
      throw new Error(`Falha ao gerar o PDF com Puppeteer: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
      if (browser) {
          console.log("Fechando navegador Puppeteer...");
          await browser.close();
      }
  }
}
*/ // COMENTADO - REMOVENDO PUPPETEER

// --- FIM DA FUNÇÃO PUPPETEER ---

// --- TERCEIRA FUNÇÃO DE FALLBACK USANDO HTML-PDF ---
export async function generateQuotePdfWithHtmlPdf(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração de PDF com html-pdf (PhantomJS)...");

  // 1. Reutilizamos o mesmo carregamento e compilação de template da função anterior
  let templateHtml = '';
  try {
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    console.log(`Carregando template de: ${templatePath}`);
    // Usar a versão correta de fs.promises
    const fileContent = await fsPromises.readFile(templatePath, 'utf-8');
    templateHtml = fileContent;
    console.log("Template HTML carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar template HTML:", err);
    throw new Error("Falha ao carregar template do orçamento.");
  }
  
  // 2. Registrar helpers
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
  
  // Helper para formatação de preço
  handlebars.registerHelper('formatPrice', function(price: number) {
    try {
      const priceInCents = typeof price === 'number' ? price : parseInt(price);
      if (isNaN(priceInCents)) return 'Preço inválido';
      
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2
      }).format(priceInCents / 100);
    } catch (err) {
      console.error('Erro ao formatar preço:', err);
      return 'ERRO';
    }
  });
  
  const template = handlebars.compile(templateHtml);

  // 3. Preparar dados para o template (igual à função anterior)
  console.log("Preparando dados para o template...");
  let companyLogoBase64: string | null = null;
  try {
      companyLogoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
      console.log(`Logo ${companyLogoBase64 ? 'processado' : 'não encontrado/falhou'}`);
  } catch (err) {
      console.error("Erro ao processar logo:", err);
  }

  let itemsWithDetails: any[] = [];
  try {
      console.log(`🔍 Buscando detalhes para ${quoteData.items.length} itens...`);
      itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
        console.log(`  Item ${index + 1}: Buscando produto ID ${item.productId}`);
        const productDetails = await storage.getProduct(item.productId);
        console.log(`  Item ${index + 1}: Detalhes ${productDetails ? 'encontrados ✓' : 'NÃO encontrados ✗'}`);
        
        // MÚLTIPLAS ESTRATÉGIAS PARA OBTER IMAGENS
        let imageBase64 = null;
        
        // Estratégia 1: Usar a URL do produto do banco de dados
        if (productDetails?.imageUrl) {
          console.log(`  Item ${index + 1}: Tentando imageUrl do produto: ${productDetails.imageUrl}`);
          imageBase64 = await getBase64ImageFromS3(productDetails.imageUrl);
        }
        
        // Estratégia 2: Tentar buscar pelo código do produto
        if (!imageBase64 && item.productCode) {
          const codeImageUrl = `/api/images/products/by-code/${item.productCode}`;
          console.log(`  Item ${index + 1}: Tentando URL por código: ${codeImageUrl}`);
          imageBase64 = await getBase64ImageFromS3(codeImageUrl);
        }
        
        // Estratégia 3: Tentar usar o ID do produto para construir um caminho alternativo
        if (!imageBase64 && productDetails?.id) {
          const idImageUrl = `/uploads/products/${productDetails.id}.jpg`;
          console.log(`  Item ${index + 1}: Tentando URL por ID: ${idImageUrl}`);
          imageBase64 = await getBase64ImageFromS3(idImageUrl);
        }
        
        // Estratégia 4: Verificar se tem imagem secundária em additionalImages (se existir)
        if (!imageBase64 && productDetails && 'additionalImages' in productDetails && 
            Array.isArray((productDetails as any).additionalImages) && 
            (productDetails as any).additionalImages.length > 0) {
          console.log(`  Item ${index + 1}: Tentando imagem adicional`);
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
          productCode: item.productCode || '-',
          color: item.color || '-',
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
    paymentInstallments: quoteData.paymentInstallments || 'Não especificado',
    paymentMethod: quoteData.paymentMethod || 'Não especificado',
    applyCashDiscount: quoteData.applyCashDiscount ?? false,
    discountPercentage: quoteData.discountPercentage || 0,
    finalPrice: quoteData.finalPrice ?? quoteData.totalPrice
  };

  // 4. Renderizar HTML
  let htmlContent = '';
  try {
      console.log("Renderizando HTML com Handlebars...");
      htmlContent = template(templateData);
      console.log("HTML renderizado com sucesso.");
  } catch (err) {
      console.error("Erro ao renderizar HTML com Handlebars:", err);
      throw new Error("Falha ao montar conteúdo do PDF.");
  }

  // 5. Gerar PDF usando html-pdf (PhantomJS)
  try {
      console.log("Iniciando geração de PDF com PhantomJS...");
      const pdfOptions = {
          format: 'A4',
          border: {
              top: "15mm",
              right: "15mm",
              bottom: "15mm",
              left: "15mm"
          },
          timeout: 60000, // 60 segundos
      };
      
      console.log("Opcoes do PhantomJS configuradas:", JSON.stringify(pdfOptions));
      
      // Usar html-pdf com Promise
      return new Promise<Buffer>((resolve, reject) => {
          htmlPdf.create(htmlContent, pdfOptions).toBuffer((err: Error | null, buffer: Buffer) => {
              if (err) {
                  console.error("Erro ao gerar PDF com PhantomJS:", err);
                  reject(new Error(`Falha ao gerar PDF com PhantomJS: ${err.message}`));
                  return;
              }
              
              console.log("PDF gerado com sucesso (PhantomJS). Tamanho:", buffer.length);
              resolve(buffer);
          });
      });
  } catch (error) {
      console.error("Erro ao gerar PDF com PhantomJS:", error);
      throw new Error(`Falha ao gerar PDF com PhantomJS: ${error instanceof Error ? error.message : String(error)}`);
  }
}