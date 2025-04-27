import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formata um valor numérico como moeda (BRL)
 * 
 * @param value Valor a ser formatado
 * @param options Opções de formatação
 * @returns String formatada como moeda
 */
export function formatCurrency(
  value: number | string | undefined | null,
  options: {
    currency?: string;
    locale?: string;
    decimals?: number;
    showSymbol?: boolean;
  } = {}
): string {
  if (value === undefined || value === null) return 'R$ 0,00';
  
  const {
    currency = 'BRL',
    locale = 'pt-BR',
    decimals = 2,
    showSymbol = true
  } = options;
  
  // Converter para número se for string
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  
  // Verificar se é um número válido
  if (isNaN(numericValue)) return 'R$ 0,00';
  
  return new Intl.NumberFormat(locale, {
    style: showSymbol ? 'currency' : 'decimal',
    currency: showSymbol ? currency : undefined,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numericValue);
}

/**
 * Formata uma data para exibição
 * 
 * @param date Data a ser formatada
 * @param format Formato desejado
 * @returns String formatada de data
 */
export function formatDate(
  date: Date | string | number | undefined | null,
  format: 'short' | 'long' | 'relative' = 'short'
): string {
  if (!date) return '';
  
  const dateObj = date instanceof Date ? date : new Date(date);
  
  if (format === 'relative') {
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) return 'agora';
    if (diffMin < 60) return `${diffMin}m atrás`;
    if (diffHour < 24) return `${diffHour}h atrás`;
    if (diffDay < 30) return `${diffDay}d atrás`;
    
    return dateObj.toLocaleDateString('pt-BR');
  }
  
  if (format === 'long') {
    return dateObj.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  return dateObj.toLocaleDateString('pt-BR');
}
