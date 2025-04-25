/**
 * Utilitários para processamento de dados no sistema
 */

/**
 * Extrai dimensões de uma string no formato "LxAxP" ou similar
 * @param dimensionString String contendo informações de dimensão
 * @returns Objeto com dimensões extraídas ou null
 */
export function extractDimensionsFromString(dimensionString: string): any | null {
  if (!dimensionString) return null;
  
  // Normalizar string: remover espaços extras, converter vírgulas para pontos
  const normalizedString = dimensionString
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .toLowerCase();
  
  // Padrões comuns de dimensões
  // Ex: "100x50x75cm", "L: 100 x A: 50 x P: 75", "100 cm x 50 cm x 75 cm"
  
  // Padrão 1: "LxAxP" ou variações
  const pattern1 = /(\d+[\.,]?\d*)[\s]*x[\s]*(\d+[\.,]?\d*)[\s]*x[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?/i;
  
  // Padrão 2: "L: 100 A: 50 P: 75" ou variações
  const pattern2 = /L[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?[\s]*A[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?[\s]*P[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?/i;
  
  // Padrão 3: "Largura: 100cm, Altura: 50cm, Profundidade: 75cm" ou variações
  const pattern3 = /(?:larg|largura|comprimento|comp)[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?.*?(?:alt|altura)[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?.*?(?:prof|profundidade)[\s]*:?[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?/i;
  
  // Padrão 4: "100cm (L) x 50cm (A) x 75cm (P)" ou variações
  const pattern4 = /(\d+[\.,]?\d*)[\s]*(cm|m)?[\s]*\(?[lL]\)?[\s]*x[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?[\s]*\(?[aA]\)?[\s]*x[\s]*(\d+[\.,]?\d*)[\s]*(cm|m)?[\s]*\(?[pP]\)?/i;
  
  let match;
  
  // Tentar padrão 1
  match = normalizedString.match(pattern1);
  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[2]);
    const depth = parseFloat(match[3]);
    const unit = match[4] || 'cm';
    
    // Aplicar conversão de unidades se necessário (m para cm)
    const factor = unit.toLowerCase() === 'm' ? 100 : 1;
    
    return {
      largura: width * factor,
      altura: height * factor,
      profundidade: depth * factor,
      unidade: 'cm', // Padronizado para cm
      dimensoesOriginais: match[0]
    };
  }
  
  // Tentar padrão 2
  match = normalizedString.match(pattern2);
  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[3]);
    const depth = parseFloat(match[5]);
    
    // Verificar unidades (pode ter unidades diferentes para cada dimensão)
    const widthUnit = match[2] || 'cm';
    const heightUnit = match[4] || 'cm';
    const depthUnit = match[6] || 'cm';
    
    // Aplicar conversão de unidades
    const widthFactor = widthUnit.toLowerCase() === 'm' ? 100 : 1;
    const heightFactor = heightUnit.toLowerCase() === 'm' ? 100 : 1;
    const depthFactor = depthUnit.toLowerCase() === 'm' ? 100 : 1;
    
    return {
      largura: width * widthFactor,
      altura: height * heightFactor,
      profundidade: depth * depthFactor,
      unidade: 'cm',
      dimensoesOriginais: match[0]
    };
  }
  
  // Tentar padrão 3
  match = normalizedString.match(pattern3);
  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[3]);
    const depth = parseFloat(match[5]);
    
    // Verificar unidades
    const widthUnit = match[2] || 'cm';
    const heightUnit = match[4] || 'cm';
    const depthUnit = match[6] || 'cm';
    
    // Aplicar conversão de unidades
    const widthFactor = widthUnit.toLowerCase() === 'm' ? 100 : 1;
    const heightFactor = heightUnit.toLowerCase() === 'm' ? 100 : 1;
    const depthFactor = depthUnit.toLowerCase() === 'm' ? 100 : 1;
    
    return {
      largura: width * widthFactor,
      altura: height * heightFactor,
      profundidade: depth * depthFactor,
      unidade: 'cm',
      dimensoesOriginais: match[0]
    };
  }
  
  // Tentar padrão 4
  match = normalizedString.match(pattern4);
  if (match) {
    const width = parseFloat(match[1]);
    const height = parseFloat(match[3]);
    const depth = parseFloat(match[5]);
    
    // Verificar unidades
    const widthUnit = match[2] || 'cm';
    const heightUnit = match[4] || 'cm';
    const depthUnit = match[6] || 'cm';
    
    // Aplicar conversão de unidades
    const widthFactor = widthUnit.toLowerCase() === 'm' ? 100 : 1;
    const heightFactor = heightUnit.toLowerCase() === 'm' ? 100 : 1;
    const depthFactor = depthUnit.toLowerCase() === 'm' ? 100 : 1;
    
    return {
      largura: width * widthFactor,
      altura: height * heightFactor,
      profundidade: depth * depthFactor,
      unidade: 'cm',
      dimensoesOriginais: match[0]
    };
  }
  
  // Nenhum padrão encontrado
  return null;
}

/**
 * Formata um preço para padrão brasileiro (R$ XX.XXX,XX)
 * @param price Preço a ser formatado (string ou número)
 * @returns Preço formatado como string
 */
export function formatProductPrice(price: string | number): string {
  if (!price) return 'R$ 0,00';
  
  // Se for uma string, verificar se já está formatada
  if (typeof price === 'string') {
    // Remover todos os caracteres que não sejam números, pontos ou vírgulas
    const cleanPrice = price.replace(/[^\d.,]/g, '');
    
    // Se já está formatado como R$ X.XXX,XX ou similar, retornar como está
    if (/^R\$\s*[\d.,]+$/.test(price)) {
      return price;
    }
    
    // Verificar se tem vírgula como separador decimal
    if (cleanPrice.includes(',')) {
      // Extrair parte decimal após a última vírgula
      const parts = cleanPrice.split(',');
      const decimal = parts.pop() || '00';
      const integer = parts.join('').replace(/\./g, '');
      
      // Formatar com separadores de milhar
      const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `R$ ${formattedInteger},${decimal.padEnd(2, '0').substring(0, 2)}`;
    }
    
    // Formatar como número se não tiver formato específico
    const numValue = parseFloat(cleanPrice.replace(/,/g, '.'));
    if (isNaN(numValue)) return 'R$ 0,00';
    
    // Formatar com Intl.NumberFormat
    return `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numValue)}`;
  }
  
  // Se for número, formatar direto
  return `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price)}`;
}

/**
 * Determina a categoria do produto com base no nome e descrição
 * @param name Nome do produto
 * @param description Descrição do produto
 * @returns Categoria detectada
 */
export function determineProductCategory(name?: string, description?: string): string {
  const text = `${name || ''} ${description || ''}`.toLowerCase();
  
  // Categorias de móveis
  if (/sofa|sofá|sofas|sofás|chaise|recamier/i.test(text)) return 'Sofás';
  if (/mesa|mesas|bancada|escrivaninha/i.test(text)) return 'Mesas';
  if (/cadeira|cadeiras|poltrona|poltronas/i.test(text)) return 'Cadeiras';
  if (/armario|armário|estante|estantes|rack|racks/i.test(text)) return 'Armários e Estantes';
  if (/cama|camas|colchao|colchão|cabeceira/i.test(text)) return 'Camas';
  if (/comoda|cômoda|criado|criado-mudo|mudo/i.test(text)) return 'Cômoda e Criados';
  if (/acessorio|acessório|espelho|quadro|tapete/i.test(text)) return 'Acessórios';
  
  return 'Outros';
}

/**
 * Extrai informações de materiais da descrição do produto
 * @param description Descrição do produto
 * @returns Array de materiais detectados
 */
export function extractMaterialsFromDescription(description?: string): string[] {
  if (!description) return [];
  
  const text = description.toLowerCase();
  const materiais: string[] = [];
  
  if (/madeira|lamin|mdp|mdf|jequitiba|pinus|eucalipto/i.test(text)) materiais.push('Madeira');
  if (/couro|courino|couro sintético|leath/i.test(text)) materiais.push('Couro');
  if (/tecido|algodao|algodão|cotton|veludo|linho|suede|linen/i.test(text)) materiais.push('Tecido');
  if (/vidro|glass|espelho|mirror/i.test(text)) materiais.push('Vidro');
  if (/metal|metalico|metálico|inox|ferro|aluminio|alumínio|aço/i.test(text)) materiais.push('Metal');
  if (/plastico|plástico|poliprop|polietil|acrilico|acrílico/i.test(text)) materiais.push('Plástico');
  if (/marmore|mármore|granito|quartzo|pedra/i.test(text)) materiais.push('Pedra');
  if (/rattan|vime|palha|junco|natural|fibra/i.test(text)) materiais.push('Fibras Naturais');
  
  return materiais;
}