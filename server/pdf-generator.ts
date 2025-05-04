import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { Product, User } from '@shared/schema'; // Importar User
import { downloadFileFromS3 } from './s3-service'; 
import { storage } from './storage'; // Para buscar descrição do produto
import fs from 'fs/promises';
import path from 'path';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';

// Helper para converter imagem do S3 para base64 para incluir no HTML
async function getBase64ImageFromS3(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  
  try {
    console.log(`Obtendo imagem do S3: ${imageUrl}`);
    
    // Se a URL não parece ser do S3, retornar a própria URL (pode ser uma URL externa)
    if (imageUrl.startsWith('http') && !imageUrl.includes('amazonaws.com')) {
      console.log(`URL externa detectada, usando diretamente: ${imageUrl}`);
      return imageUrl;
    }
    
    // Extrair a chave do S3 da URL
    const urlParts = new URL(imageUrl);
    const s3Key = decodeURIComponent(urlParts.pathname.substring(1));
    
    // Baixar o arquivo do S3
    const imageUint8Array = await downloadFileFromS3(s3Key);
    const imageBuffer = Buffer.from(imageUint8Array);
    
    // Determinar o tipo MIME com base na extensão
    let mimeType = 'image/jpeg'; // Padrão
    const lcPath = s3Key.toLowerCase();
    if (lcPath.endsWith('.png')) {
      mimeType = 'image/png';
    } else if (lcPath.endsWith('.webp')) {
      mimeType = 'image/webp';
    } else if (lcPath.endsWith('.gif')) {
      mimeType = 'image/gif';
    } else if (lcPath.endsWith('.svg')) {
      mimeType = 'image/svg+xml';
    }
    
    // Converter para base64
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`Erro ao obter imagem do S3 (${imageUrl}):`, error);
    // Tentar retornar a URL original como fallback
    if (imageUrl.startsWith('http')) {
      console.log(`Tentando usar URL original como fallback: ${imageUrl}`);
      return imageUrl;
    }
    return null; // Retornar null em caso de erro
  }
}

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
  }[];
  totalPrice: number;
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

// Função principal para gerar o PDF
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
      const s3Key = decodeURIComponent(urlParts.pathname.substring(1)); 
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
  yPos -= 10;

  // --- Tabela de Itens --- 
  const tableTopY = yPos; // Salvar Y inicial da tabela
  const rowHeight = 45; // Aumentar altura para possível imagem
  const colWidths = { code: 60, product: 150, desc: 160, color: 60, price: 70 }; // Ajustar larguras

  // Cabeçalho Tabela
  page.setFont(helveticaBoldFont); page.setFontSize(10);
  let currentX = margin;
  // page.drawText('Imagem', { x: currentX, y: yPos }); currentX += colWidths.image + 10; // Coluna Imagem (TODO)
  page.drawText('Código', { x: currentX, y: yPos }); currentX += colWidths.code + 10;
  page.drawText('Produto', { x: currentX, y: yPos }); currentX += colWidths.product + 10;
  page.drawText('Descrição', { x: currentX, y: yPos }); currentX += colWidths.desc + 10;
  page.drawText('Cor', { x: currentX, y: yPos }); currentX += colWidths.color + 10;
  page.drawText('Preço Unit.', { x: width - margin - colWidths.price, y: yPos }); // Alinhar Preço à direita
  yPos -= (1.5 * 10); // Espaço após cabeçalho

  // Linha abaixo do cabeçalho
  page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  yPos -= 5;

  // Itens da Tabela
  page.setFont(helveticaFont); page.setFontSize(9);
  for (const item of quoteData.items) {
    const productDetails = await storage.getProduct(item.productId);
    const description = sanitizeWinAnsi(productDetails?.description || '-');
    const code = sanitizeWinAnsi(item.productCode);
    const name = sanitizeWinAnsi(item.productName);
    const color = sanitizeWinAnsi(item.color);
    const priceText = formatPrice(item.price);

    // Calcular altura necessária para descrição (aproximação)
    const descLines = Math.ceil(helveticaFont.widthOfTextAtSize(description, 9) / colWidths.desc) + description.split('\n').length -1;
    const currentItemHeight = Math.max(rowHeight, descLines * 11); // Altura mínima ou baseada na descrição

    if (yPos - currentItemHeight < margin + 40) { // Verificar espaço
        page = pdfDoc.addPage();
        yPos = height - margin - 20; // Reiniciar Y com espaço para cabeçalho repetido?
        // TODO: Redesenhar cabeçalho da tabela
    }
    
    const itemStartY = yPos;
    let textY = itemStartY - 11; // Começar texto um pouco abaixo do topo da linha
    currentX = margin;

    // TODO: Lógica para buscar e desenhar imagem do produto aqui
    // const imageBase64 = await getBase64ImageFromS3(productDetails?.imageUrl || null);
    // if (imageBase64) { ... page.drawImage ... }
    
    currentX += colWidths.code + 10; // Pular coluna imagem por enquanto
    page.drawText(code, { x: margin, y: textY });
    page.drawText(name, { x: currentX, y: textY }); currentX += colWidths.product + 10;
    await drawWrappedText(page, description, { x: currentX, y: textY, font: helveticaFont, size: 9, maxWidth: colWidths.desc, lineHeight: 11});
    currentX += colWidths.desc + 10;
    page.drawText(color, { x: currentX, y: textY });
    
    page.drawText(priceText, { x: width - margin - colWidths.price, y: textY }); // Usar largura da coluna para alinhar
    
    yPos -= Math.max(rowHeight, descLines * 11); // Adjust yPos based on description height
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: width - margin, y: yPos }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
    yPos -= 5; // Espaço antes do próximo item
  }

  // --- Total --- (Restaurando)
  yPos -= 10; // Espaço antes do total
  page.setFont(helveticaBoldFont); page.setFontSize(12);
  const totalText = `TOTAL DO ORÇAMENTO: ${formatPrice(quoteData.totalPrice)}`;
  // Usar posição X fixa aproximada para evitar erro de widthOfTextAtSize
  page.drawText(totalText, { x: width - margin - 150, y: yPos }); 
  yPos -= 25;

  // --- Observações --- (Restaurando)
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

  // --- Rodapé --- 
  const footerStartY = margin + 40; // Começar um pouco mais acima do fundo
  let currentFooterY = footerStartY;
  page.setFont(helveticaFont); page.setFontSize(9);
  page.drawLine({ start: { x: margin, y: currentFooterY + 5 }, end: { x: width - margin, y: currentFooterY + 5 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  currentFooterY -= 11; // Descer após a linha
  
  const validityDays = companyUser.quoteValidityDays ?? 7; 
  page.drawText(
    `A validade deste orçamento é de ${validityDays} dias a partir da data de emissão.`,
    { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) }
  );
  currentFooterY -= 11 * 2; // Mais espaço

  const terms = companyUser.quotePaymentTerms || 'Condições de pagamento a combinar.';
  const termsLines = sanitizeWinAnsi(terms).split('\n');
  page.drawText('Condições:', { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3), font: helveticaBoldFont }); // Negrito para título
  currentFooterY -= 11;
  for (const line of termsLines) {
      if (currentFooterY < margin / 2) break; 
      // TODO: Quebra de linha automática para linhas longas dos termos
      page.drawText(line, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3), lineHeight: 11 });
      currentFooterY -= 11;
  }
  currentFooterY -= 5; // Espaço extra
  
  if (currentFooterY > margin / 2) { 
    page.drawText(`${companyUser.companyName || 'Empresa'} agradece a preferência.`, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) });
    currentFooterY -= 11;
  }
  if(companyUser.companyPhone && currentFooterY > margin / 2) {
       page.drawText(`Para mais informações: ${sanitizeWinAnsi(companyUser.companyPhone)}`, { x: margin, y: currentFooterY, size: 9, color: rgb(0.3, 0.3, 0.3) });
  }

  // 4. Salvar o documento PDF
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- NOVA FUNÇÃO USANDO PUPPETEER ---
export async function generateQuotePdfWithPuppeteer(quoteData: QuoteDataInput, companyUser: User): Promise<any> { // Usando 'any' temporariamente para resolver o erro de tipo
  console.log("Iniciando geração de PDF com Puppeteer...");

  // 1. Carregar e compilar template HTML Handlebars
  let templateHtml = '';
  try {
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    console.log(`Carregando template de: ${templatePath}`);
    templateHtml = await fs.readFile(templatePath, 'utf-8');
    console.log("Template HTML carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar template HTML:", err);
    throw new Error("Falha ao carregar template do orçamento.");
  }
  const template = handlebars.compile(templateHtml);

  // 2. Preparar dados completos para o template
  console.log("Preparando dados para o template...");
  let companyLogoBase64: string | null = null;
  try {
      companyLogoBase64 = await getBase64ImageFromS3(companyUser.companyLogoUrl);
      console.log(`Logo ${companyLogoBase64 ? 'processado' : 'não encontrado/falhou'}`);
  } catch (err) {
      console.error("Erro ao processar logo:", err);
      // Continuar sem logo se falhar
  }

  // Buscar dados completos dos produtos (incluindo descrição e imageUrl)
  let itemsWithDetails: any[] = [];
  try {
      console.log(`Buscando detalhes para ${quoteData.items.length} itens...`);
      
      // Usar Promise.all para processar todos os itens em paralelo
      itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
        console.log(`  Item ${index + 1}: Buscando produto ID ${item.productId}`);
        
        // Buscar informações detalhadas do produto no banco de dados
        const productDetails = await storage.getProduct(item.productId);
        console.log(`  Item ${index + 1}: Detalhes ${productDetails ? 'encontrados' : 'NÃO encontrados'}`);
        
        // Buscar e converter a imagem para base64 (se existir)
        let imageBase64 = null;
        if (productDetails?.imageUrl) {
          imageBase64 = await getBase64ImageFromS3(productDetails.imageUrl);
          console.log(`  Item ${index + 1}: Imagem ${imageBase64 ? 'processada' : 'não encontrada/falhou'}`);
        } else {
          console.log(`  Item ${index + 1}: Produto sem URL de imagem definida`);
        }
        
        // Retornar objeto com todas as informações necessárias para o template
        return {
          ...item,
          description: productDetails?.description || '-', // Usar '-' se descrição for null
          imageBase64: imageBase64,
          // Adicionamos outros campos relevantes do produto que possam ser úteis no template
          manufacturer: productDetails?.manufacturer || null,
          sizes: productDetails?.sizes || null,
          materials: productDetails?.materials || []
        };
      }));
      console.log("Detalhes de todos os itens processados.");
  } catch (err) {
      console.error("Erro ao buscar detalhes dos produtos:", err);
      throw new Error("Falha ao buscar informações dos produtos.");
  }
  
  // CORRIGIR: Restaurar a criação completa do objeto templateData
  const templateData: TemplateData = {
    ...quoteData,
    items: itemsWithDetails, // Usar itens com detalhes
    companyName: companyUser.companyName,
    companyLogoBase64: companyLogoBase64,
    companyAddress: companyUser.companyAddress,
    companyPhone: companyUser.companyPhone,
    companyCnpj: companyUser.companyCnpj,
    quotePaymentTerms: companyUser.quotePaymentTerms,
    quoteValidityDays: companyUser.quoteValidityDays ?? '7', // Default 7 dias
    currentDate: new Date().toLocaleDateString('pt-BR'),
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
    const puppeteerArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']; // Adicionar flag comum
    console.log("Args Puppeteer:", puppeteerArgs);
    browser = await puppeteer.launch({ 
        headless: true, 
        args: puppeteerArgs,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined // Usar o do Nix se definido
    });
    console.log("Navegador lançado.");
    const page = await browser.newPage();
    console.log("Nova página criada.");
    
    // Definir conteúdo da página
    console.log("Definindo conteúdo HTML na página...");
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    console.log("Conteúdo HTML definido.");
    
    // Gerar PDF
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
    
    // O Puppeteer retorna um Buffer, mas podemos converter explicitamente para garantir compatibilidade
    console.log("PDF gerado com sucesso (Buffer). Tamanho:", pdfBuffer.length);
    return Buffer.from(pdfBuffer);

  } catch (error) {
      // Log detalhado do erro do Puppeteer
      console.error("Erro DETALHADO durante a geração do PDF com Puppeteer:", error);
      throw new Error(`Falha ao gerar o PDF com Puppeteer: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
      if (browser) {
          console.log("Fechando navegador Puppeteer...");
          await browser.close();
      }
  }
} 