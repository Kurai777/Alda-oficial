/**
 * Adaptador para ambiente serverless da Vercel
 * 
 * Este arquivo contém funções auxiliares para adaptar o código Express
 * para o ambiente serverless da Vercel.
 */

// Função para determinar se estamos rodando na Vercel
export function isVercelEnvironment() {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

// Função para obter a URL de base correta para recursos
export function getBaseUrl() {
  if (isVercelEnvironment()) {
    // Na Vercel, usamos a variável VERCEL_URL como base
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) {
      return `https://${vercelUrl}`;
    }
  }
  
  // Em desenvolvimento, usamos o localhost
  return 'http://localhost:5000';
}

// Função para determinar se devemos usar HTTPS
export function shouldUseHttps() {
  return isVercelEnvironment() || process.env.NODE_ENV === 'production';
}

// Função para adaptar configurações de sessão para Vercel
export function getSessionConfig(baseConfig) {
  if (isVercelEnvironment()) {
    // Na Vercel, precisamos ajustar algumas configurações de segurança
    return {
      ...baseConfig,
      cookie: {
        ...baseConfig.cookie,
        secure: true,
        sameSite: 'none',
        domain: process.env.VERCEL_URL ? `.${process.env.VERCEL_URL.split('.')[0]}.vercel.app` : undefined
      }
    };
  }
  
  return baseConfig;
}

// Função para adaptar configurações de CORS para Vercel
export function getCorsConfig() {
  if (isVercelEnvironment()) {
    return {
      origin: [
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*',
        /\.vercel\.app$/,
        // Adicione quaisquer outros domínios permitidos aqui
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization']
    };
  }
  
  // Em desenvolvimento, somos mais permissivos
  return {
    origin: '*',
    credentials: true
  };
}