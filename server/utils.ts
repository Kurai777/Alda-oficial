/**
 * Utilitários para processamento de produtos e imagens
 */

/**
 * Formata o preço do produto para o formato brasileiro
 * @param price Preço em qualquer formato (número ou string)
 * @returns Preço formatado (ex: "R$ 1.299,90")
 */
export function formatProductPrice(price: number | string): string {
  // Se for string, tentar converter para número
  let numericPrice: number;
  
  if (typeof price === 'string') {
    // Remover 'R$' e outros caracteres não numéricos, exceto pontos e vírgulas
    const cleanPrice = price.replace(/[^\d.,]/g, '')
      // Substituir vírgula por ponto para parsing
      .replace(/,/g, '.');
    
    // Encontrar o último ponto (para sistemas que usam ponto como separador decimal)
    const lastDotIndex = cleanPrice.lastIndexOf('.');
    
    if (lastDotIndex >= 0 && lastDotIndex < cleanPrice.length - 3) {
      // Se houver mais de 2 decimais, ajustar formato
      const intPart = cleanPrice.substring(0, lastDotIndex).replace(/\./g, '');
      const decPart = cleanPrice.substring(lastDotIndex + 1);
      numericPrice = parseFloat(`${intPart}.${decPart}`);
    } else {
      numericPrice = parseFloat(cleanPrice);
    }
  } else {
    numericPrice = price;
  }
  
  // Se não for um número válido, retornar valor padrão
  if (isNaN(numericPrice)) {
    return 'R$ 0,00';
  }
  
  // Formatar para o padrão brasileiro
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2
  }).format(numericPrice);
}

/**
 * Extrai dimensões de uma string no formato LxAxP ou similar
 * @param dimensionString String com dimensões (ex: "120x45x60 cm")
 * @returns Objeto com largura, altura e profundidade
 */
export function extractDimensionsFromString(dimensionString: string) {
  if (!dimensionString) return null;
  
  // Normalizar string (remover "cm" e outros caracteres, substituir vírgula por ponto)
  const normalized = dimensionString
    .toLowerCase()
    .replace(/cm|metros|m|mm|"|'|pol|polegadas/g, '')
    .replace(/[×x]/g, 'x')
    .replace(/,/g, '.')
    .trim();
  
  // Padrão 1: formato "LxAxP"
  const lxaxpMatch = normalized.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if (lxaxpMatch) {
    return {
      largura: parseFloat(lxaxpMatch[1]),
      altura: parseFloat(lxaxpMatch[2]),
      profundidade: parseFloat(lxaxpMatch[3])
    };
  }
  
  // Padrão 2: formato "L: XX A: XX P: XX"
  const separateMatch = normalized.match(/l(?:argura)?:?\s*(\d+(?:\.\d+)?)[^\d]+a(?:ltura)?:?\s*(\d+(?:\.\d+)?)[^\d]+p(?:rof(?:undidade)?)?:?\s*(\d+(?:\.\d+)?)/);
  if (separateMatch) {
    return {
      largura: parseFloat(separateMatch[1]),
      altura: parseFloat(separateMatch[2]),
      profundidade: parseFloat(separateMatch[3])
    };
  }
  
  // Padrão 3: Apenas números separados (pegar os 3 primeiros números encontrados)
  const numbers = normalized.match(/\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 3) {
    return {
      largura: parseFloat(numbers[0]),
      altura: parseFloat(numbers[1]),
      profundidade: parseFloat(numbers[2])
    };
  }
  
  return null;
}

/**
 * Determina a categoria do produto com base no nome e descrição
 * @param nome Nome do produto
 * @param descricao Descrição do produto
 * @returns Categoria determinada
 */
export function determineProductCategory(nome: string, descricao: string): string {
  const text = `${nome} ${descricao}`.toLowerCase();
  
  // Lista de palavras-chave por categoria
  const categoryKeywords = {
    'Sofás': ['sofá', 'sofa', 'sofas', 'canto', 'reclinável', 'reclinavel', 'retrátil', 'retratil', 'chaise'],
    'Poltronas': ['poltrona', 'puff', 'pufe', 'bergère', 'bergere', 'lounge'],
    'Mesas': ['mesa', 'mesinha', 'console', 'aparador', 'bar', 'bancada', 'escrivaninha'],
    'Mesas de Centro': ['mesa de centro', 'mesa centro', 'mesa lateral', 'mesa auxiliar', 'mesa de canto'],
    'Mesas de Jantar': ['mesa de jantar', 'mesa jantar', 'mesa refeição', 'mesa refeicao'],
    'Cadeiras': ['cadeira', 'banqueta', 'banco', 'tamborete', 'stool'],
    'Bancos': ['banco', 'banqueta', 'puff', 'pufe'],
    'Armários': ['armário', 'armario', 'roupeiro', 'guarda-roupa', 'guarda roupa', 'estante', 'buffet', 'aparador'],
    'Cômodas': ['cômoda', 'comoda', 'gaveteiro', 'chest'],
    'Estantes': ['estante', 'prateleira', 'livreiro', 'rack', 'painel'],
    'Camas': ['cama', 'cabeceira', 'colchão', 'colchao', 'box', 'beliche', 'bicama'],
    'Criados-mudos': ['criado mudo', 'criado-mudo', 'mesa cabeceira', 'mesa de cabeceira', 'nightstand'],
    'Racks': ['rack', 'painel', 'tv', 'home theater', 'home cinema'],
    'Escrivaninhas': ['escrivaninha', 'escritório', 'escritorio', 'desk', 'estação de trabalho', 'estacao de trabalho'],
    'Jardim': ['jardim', 'varanda', 'externo', 'externa', 'outdoor', 'área externa', 'area externa'],
    'Decoração': ['decoração', 'decoracao', 'vaso', 'espelho', 'quadro', 'tapete', 'luminária', 'luminaria']
  };
  
  // Verificar cada categoria
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return category;
      }
    }
  }
  
  // Categoria padrão se nenhuma correspondência for encontrada
  return 'Outros';
}

/**
 * Extrai materiais a partir da descrição do produto
 * @param descricao Descrição do produto
 * @returns Lista de materiais encontrados
 */
export function extractMaterialsFromDescription(descricao: string): string[] {
  if (!descricao) return [];
  
  const text = descricao.toLowerCase();
  
  // Lista de materiais comuns em móveis
  const commonMaterials = [
    'madeira', 'mdf', 'mdp', 'compensado', 'maciça', 'maciça', 'pinus', 'eucalipto', 'carvalho', 'cedro',
    'metal', 'alumínio', 'aluminio', 'aço', 'aco', 'ferro', 'inox',
    'vidro', 'cristal', 'espelho',
    'tecido', 'linho', 'algodão', 'algodao', 'poliéster', 'poliester', 'veludo', 'chenille', 'suede',
    'couro', 'couro sintético', 'couro ecológico', 'couro sintetico', 'couro ecologico', 'corino',
    'plástico', 'plastico', 'polipropileno', 'abs', 'acrílico', 'acrilico',
    'mármore', 'marmore', 'granito', 'pedra', 'cerâmica', 'ceramica',
    'vime', 'rattan', 'junco', 'palha', 'fibra natural'
  ];
  
  // Encontrar materiais na descrição
  const foundMaterials = [];
  
  for (const material of commonMaterials) {
    if (text.includes(material)) {
      // Normalizar nome do material (primeira letra maiúscula)
      const normalizedMaterial = material.charAt(0).toUpperCase() + material.slice(1);
      foundMaterials.push(normalizedMaterial);
    }
  }
  
  return foundMaterials;
}

/**
 * Gera um nome de arquivo único para armazenamento
 * @param originalName Nome original do arquivo
 * @param userId ID do usuário
 * @param type Tipo do arquivo (catalog, product, etc)
 * @returns Nome de arquivo único
 */
export function generateUniqueFileName(originalName: string, userId: string | number, type: string = 'generic'): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 10);
  const extension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
  
  return `${type}_${userId}_${timestamp}_${randomStr}.${extension}`;
}

/**
 * Valida se o texto contém informações de produto
 * @param text Texto a ser validado
 * @returns True se contém informações de produto
 */
export function validateProductText(text: string): boolean {
  // Verificar se o texto tem um tamanho mínimo
  if (!text || text.length < 10) return false;
  
  // Verificar se contém palavras-chave geralmente presentes em produtos
  const hasPriceIndicator = /R\$|preço|preco|valor|custo|por apenas|por só|desconto|promoção/i.test(text);
  const hasDimensionIndicator = /[0-9]+\s*x\s*[0-9]+|largura|altura|profundidade|dimensões|dimensao|tamanho|medida|cm|m²/i.test(text);
  const hasMaterialIndicator = /madeira|tecido|couro|metal|vidro|mdf|mdp|aço|aco|alumínio|aluminio/i.test(text);
  const hasProductIndicator = /código|codigo|referência|referencia|ref|modelo|marca|fabricante|garantia|frete/i.test(text);
  
  // Verificar se atende a pelo menos dois critérios
  const criteria = [hasPriceIndicator, hasDimensionIndicator, hasMaterialIndicator, hasProductIndicator];
  const matchCount = criteria.filter(c => c).length;
  
  return matchCount >= 2;
}