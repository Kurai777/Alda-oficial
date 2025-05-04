import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { Product, User } from '@shared/schema'; // Importar User
import { downloadFileFromS3 } from './s3-service'; 
import { storage } from './storage'; // Para buscar descrição do produto
import fs from 'fs/promises';
import * as fsSync from 'fs'; // fs síncrono para verificações de existência de arquivos
import path from 'path';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { execSync } from 'child_process'; // Para comandos do sistema

// Helper para converter imagem do S3 para base64 para incluir no HTML
async function getBase64ImageFromS3(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  
  try {
    console.log(`Tentando baixar imagem de: ${imageUrl}`);
    const urlParts = new URL(imageUrl);
    const s3Key = decodeURIComponent(urlParts.pathname.substring(1)); 
    console.log(`Chave S3 extraída para imagem: ${s3Key}`);
    
    const imageUint8Array = await downloadFileFromS3(s3Key); 
    const imageBuffer = Buffer.from(imageUint8Array);
    
    let mimeType = 'image/jpeg'; 
    if (s3Key.toLowerCase().endsWith('.png')) mimeType = 'image/png';
    else if (s3Key.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
    else if (s3Key.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';
    
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  } catch (error) {
    console.error(`Erro ao buscar/converter imagem ${imageUrl}:`, error);
    return null; 
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
    const priceText = formatBRLPrice(item.price);

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
  const totalText = `TOTAL DO ORÇAMENTO: ${formatBRLPrice(quoteData.totalPrice)}`;
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
export async function generateQuotePdfWithPuppeteer(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração de PDF com Puppeteer...");

  // 1. Carregar e compilar template HTML Handlebars
  let templateHtml = '';
  try {
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    console.log(`Carregando template de: ${templatePath}`);
    // Usar a versão de promessa do fs.readFile
    const fileContent = await fs.readFile(templatePath, { encoding: 'utf-8' });
    templateHtml = fileContent;
    console.log("Template HTML carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar template HTML:", err);
    throw new Error("Falha ao carregar template do orçamento.");
  }
  
  // Registrar helper de formatação de preço
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
      console.log(`Buscando detalhes para ${quoteData.items.length} itens...`);
      itemsWithDetails = await Promise.all(quoteData.items.map(async (item, index) => {
        console.log(`  Item ${index + 1}: Buscando produto ID ${item.productId}`);
        const productDetails = await storage.getProduct(item.productId);
        console.log(`  Item ${index + 1}: Detalhes ${productDetails ? 'encontrados' : 'NÃO encontrados'}`);
        const imageBase64 = await getBase64ImageFromS3(productDetails?.imageUrl || null);
        console.log(`  Item ${index + 1}: Imagem ${imageBase64 ? 'processada' : 'não encontrada/falhou'}`);
        return {
          ...item,
          description: productDetails?.description || '-', 
          imageBase64: imageBase64,
          productCode: item.productCode || '-', // Garantir que não é null
          color: item.color || '-' // Garantir que não é null/undefined
        };
      }));
      console.log("Detalhes de todos os itens processados.");
  } catch (err) {
      console.error("Erro ao buscar detalhes dos produtos:", err);
      throw new Error("Falha ao buscar informações dos produtos.");
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
    // Função para localizar o binário do Chromium no sistema
    const findChromiumExecutable = () => {
      try {
        // Tenta encontrar o caminho do chromium usando 'which'
        const chromiumPath = execSync('which chromium').toString().trim();
        console.log("Caminho do Chromium detectado:", chromiumPath);
        
        if (fsSync.existsSync(chromiumPath)) {
          return chromiumPath;
        }
      } catch (err) {
        console.error("Erro ao localizar chromium com 'which':", 
            err instanceof Error ? err.message : String(err));
      }
      
      // Caminhos comuns do Chromium em ambientes Replit/Nix
      const possiblePaths = [
        '/nix/store/0s8gfj0rrdgw5pl1v72cf0zk8qbjl09q-chromium-115.0.5790.170/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/nix/store/*/chromium*/bin/chromium'
      ];
      
      // Verificar caminhos conhecidos
      for (const path of possiblePaths) {
        if (path.includes('*')) {
          try {
            // Se o caminho contém wildcards, usar glob
            const matches = execSync(`ls ${path} 2>/dev/null || echo ""`).toString().trim().split('\n');
            if (matches[0]) {
              console.log("Chromium encontrado via glob:", matches[0]);
              return matches[0];
            }
          } catch (e) {
            // Ignorar erros de glob
          }
        } else if (fsSync.existsSync(path)) {
          console.log("Chromium encontrado via caminho fixo:", path);
          return path;
        }
      }
      
      console.log("Nenhum executável do Chromium encontrado, usando undefined");
      return undefined;
    };
    
    const chromiumPath = findChromiumExecutable();
    console.log("Caminho do Chromium a ser usado:", chromiumPath);

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
    
    // Configuração específica para ambiente Replit
    browser = await puppeteer.launch({ 
        headless: true,
        args: puppeteerArgs,
        timeout: 60000, // Timeout mais alto (60 segundos)
        executablePath: chromiumPath,
        ignoreDefaultArgs: ['--disable-extensions']
    });
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