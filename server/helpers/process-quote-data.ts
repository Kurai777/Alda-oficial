/**
 * Funções auxiliares para processar dados de orçamento
 * 
 * Este arquivo contém funções utilitárias para processar e preparar dados
 * de orçamento para o sistema de geração de PDF.
 */

import { User } from '@shared/schema';
import { getBase64ImageFromS3 } from '../pdf-generator';

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
export interface TemplateData extends QuoteDataInput {
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
export function processQuoteData(
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