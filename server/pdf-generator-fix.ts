/**
 * Gerador de PDF para Orçamentos - Versão Corrigida
 * 
 * Sistema de três camadas de geração de PDF com:
 * 1. Puppeteer (alta qualidade)
 * 2. html-pdf/PhantomJS (qualidade média)
 * 3. pdf-lib (básico mas mais confiável)
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import * as path from 'path';
import * as fs from 'fs';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import { storage } from './storage';
import { downloadFileFromS3 } from './s3-service';
import { User } from '@shared/schema';
import htmlPdf from 'html-pdf';

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

// Registrar helpers Handlebars
handlebars.registerHelper('multiply', function(a, b) {
  return Number(a) * Number(b);
});

handlebars.registerHelper('divide', function(a, b) {
  return Number(a) / Number(b);
});

handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

handlebars.registerHelper('formatPrice', function(price) {
  return new Intl.NumberFormat('pt-BR', { 
    style: 'currency', 
    currency: 'BRL' 
  }).format(price / 100);
});

// Método 1: Gerar PDF com Puppeteer
export async function generateQuotePdfWithPuppeteer(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração com Puppeteer...");
  
  try {
    // 1. Ler o template Handlebars
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
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
      
      // Obter produtos do storage
      const productsDetails: Record<number, any> = {};
      for (const productId of productIds) {
        const product = await storage.getProduct(productId);
        if (product) {
          productsDetails[productId] = product;
        }
      }
      
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
          console.log(`  Item ${index + 1}: Tentando primeira imagem adicional`);
          imageBase64 = await getBase64ImageFromS3(productDetails.additionalImages[0]);
        }
        
        // Estratégia 5: Usar imagem de placeholder caso nenhuma das opções acima funcione
        if (!imageBase64) {
          console.log(`  Item ${index + 1}: Sem imagem encontrada`);
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
    try {
      console.log("Iniciando Puppeteer para geração do PDF...");
      
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      console.log("Carregando HTML no Puppeteer...");
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      
      console.log("Gerando PDF com Puppeteer...");
      const pdfBuffer = await page.pdf({
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
  } catch (err) {
    console.error("Erro geral na geração com Puppeteer:", err);
    throw err;
  }
}

// Método 2: Gerar PDF com html-pdf (PhantomJS - alternativa mais leve)
export async function generateQuotePdfWithHtmlPdf(quoteData: QuoteDataInput, companyUser: User): Promise<Buffer> {
  console.log("Iniciando geração com html-pdf (PhantomJS)...");
  
  try {
    // 1. Ler o template Handlebars
    const templatePath = path.join(process.cwd(), 'server', 'templates', 'quote-template.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf8');
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
      
      // Obter produtos do storage
      const productsDetails: Record<number, any> = {};
      for (const productId of productIds) {
        const product = await storage.getProduct(productId);
        if (product) {
          productsDetails[productId] = product;
        }
      }
      
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
          imageBase64 = await getBase64ImageFromS3(productDetails.additionalImages[0]);
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
        htmlPdf.create(htmlContent, pdfOptions).toBuffer((err, buffer) => {
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

// Método 3: Gerar PDF com pdf-lib (básico mas mais confiável)
export async function generateQuotePdf(quoteData: QuoteDataInput, companyUser: User): Promise<Uint8Array> {
  console.log("Iniciando geração com pdf-lib (fallback simples)...");
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 50;
  
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  page.setFont(helveticaFont);
  page.setFontSize(12);
  
  // Título
  page.setFont(helveticaBoldFont);
  page.setFontSize(16);
  page.drawText('ORÇAMENTO', { x: margin, y: height - margin - 20 });
  
  // Dados da empresa
  page.setFont(helveticaFont);
  page.setFontSize(12);
  page.drawText(`Empresa: ${companyUser.companyName || 'Não definido'}`, { x: margin, y: height - margin - 50 });
  
  // Data
  const today = new Date().toLocaleDateString('pt-BR');
  page.drawText(`Data: ${today}`, { x: margin, y: height - margin - 70 });
  
  // Cliente
  page.setFont(helveticaBoldFont);
  page.drawText('DADOS DO CLIENTE', { x: margin, y: height - margin - 100 });
  page.setFont(helveticaFont);
  page.drawText(`Nome: ${quoteData.clientName}`, { x: margin, y: height - margin - 120 });
  
  if (quoteData.clientEmail) {
    page.drawText(`Email: ${quoteData.clientEmail}`, { x: margin, y: height - margin - 140 });
  }
  
  if (quoteData.clientPhone) {
    page.drawText(`Telefone: ${quoteData.clientPhone}`, { x: margin, y: height - margin - 160 });
  }
  
  // Produtos
  page.setFont(helveticaBoldFont);
  page.drawText('PRODUTOS', { x: margin, y: height - margin - 190 });
  
  page.setFont(helveticaFont);
  let yPos = height - margin - 210;
  
  // Lista de produtos
  for (const item of quoteData.items) {
    const quantity = item.quantity || 1;
    const subtotal = item.price * quantity;
    const formattedPrice = (item.price / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formattedSubtotal = (subtotal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    page.drawText(`${item.productName} - ${formattedPrice} x ${quantity} = ${formattedSubtotal}`, { x: margin, y: yPos });
    yPos -= 20;
    
    if (yPos < 100) {
      // Nova página se necessário
      page = pdfDoc.addPage();
      yPos = height - margin;
    }
  }
  
  // Total
  const formattedTotal = (quoteData.totalPrice / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  yPos -= 20;
  page.setFont(helveticaBoldFont);
  page.drawText(`Total: ${formattedTotal}`, { x: margin, y: yPos });
  
  // Condições de Pagamento
  yPos -= 40;
  page.setFont(helveticaBoldFont);
  page.drawText('CONDIÇÕES DE PAGAMENTO', { x: margin, y: yPos });
  
  yPos -= 20;
  page.setFont(helveticaFont);
  page.drawText(`Forma: ${quoteData.paymentInstallments || 'À vista'}`, { x: margin, y: yPos });
  
  yPos -= 20;
  page.drawText(`Método: ${quoteData.paymentMethod || 'Não especificado'}`, { x: margin, y: yPos });
  
  // Se há desconto à vista
  if (quoteData.applyCashDiscount && quoteData.discountPercentage) {
    yPos -= 20;
    page.drawText(`Desconto à vista: ${quoteData.discountPercentage}%`, { x: margin, y: yPos });
    
    // Valor final com desconto
    const finalPrice = quoteData.totalPrice * (1 - quoteData.discountPercentage / 100);
    const formattedFinalPrice = (finalPrice / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    yPos -= 20;
    page.drawText(`Valor final com desconto: ${formattedFinalPrice}`, { x: margin, y: yPos });
  }
  
  return await pdfDoc.save();
}