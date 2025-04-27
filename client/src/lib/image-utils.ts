/**
 * Utilitários para manipulação de imagens
 * 
 * Este módulo fornece funções para processamento e manipulação de URLs
 * e nomes de arquivos de imagem.
 */

/**
 * Extrai o nome do arquivo de uma URL de imagem
 * 
 * @param imageUrl URL da imagem
 * @returns Nome do arquivo ou null se não encontrado
 */
export function extractImageFilename(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  
  try {
    // Tentar extrair usando regex
    const matches = imageUrl.match(/\/([^\/]+)$/);
    if (matches && matches[1]) {
      // Decodificar URI para tratar nomes com caracteres especiais
      return decodeURIComponent(matches[1]);
    }
    
    // Alternativa: usar URL API
    try {
      const url = new URL(imageUrl);
      const pathname = url.pathname;
      const segments = pathname.split('/');
      const filename = segments[segments.length - 1];
      
      if (filename) {
        return decodeURIComponent(filename);
      }
    } catch (urlError) {
      // Não é uma URL completa, continuar com outras estratégias
    }
    
    // Se for apenas um nome de arquivo
    if (!imageUrl.includes('/')) {
      return imageUrl;
    }
    
    return null;
  } catch (error) {
    console.error('Erro ao extrair nome de arquivo da URL:', error);
    return null;
  }
}

/**
 * Verifica se a imagem está armazenada no S3
 * 
 * @param imageUrl URL da imagem
 * @returns true se a imagem estiver no S3
 */
export function isS3Image(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  
  // Verificar se a URL é do S3
  return imageUrl.includes('amazonaws.com') || 
         imageUrl.includes('.s3.') || 
         imageUrl.includes('s3-');
}

/**
 * Obtém URL segura para imagem com fallback
 * 
 * @param imageUrl URL original da imagem
 * @param fallbackUrl URL de fallback
 * @returns URL segura para a imagem
 */
export function getSafeImageUrl(imageUrl?: string | null, fallbackUrl: string = '/placeholder-product.png'): string {
  if (!imageUrl) return fallbackUrl;
  
  // Se já for uma URL completa, retornar a mesma
  if (imageUrl.startsWith('http') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  
  // Se for uma URL relativa, garantir que comece com /
  if (!imageUrl.startsWith('/')) {
    return `/${imageUrl}`;
  }
  
  return imageUrl;
}