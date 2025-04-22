/**
 * Determine the product category based on the product name
 * @param productName Product name
 * @returns Category name
 */
export function determineProductCategory(productName: string): string {
  if (!productName) return "Outros";
  
  const nameLower = productName.toLowerCase();
  
  if (nameLower.includes('cadeira') && (nameLower.includes('gamer') || nameLower.includes('gaming'))) {
    return 'Cadeiras Gamer';
  } else if (nameLower.includes('cadeira')) {
    return 'Cadeiras';
  } else if (nameLower.includes('banqueta')) {
    return 'Banquetas';
  } else if (nameLower.includes('poltrona')) {
    return 'Poltronas';
  } else if (nameLower.includes('sofá') || nameLower.includes('sofa')) {
    return 'Sofás';
  } else if (nameLower.includes('mesa')) {
    return 'Mesas';
  } else if (nameLower.includes('apoio')) {
    return 'Acessórios';
  } else {
    return 'Outros';
  }
}

/**
 * Extract materials from product description
 * @param description Product description
 * @returns Array of materials
 */
export function extractMaterialsFromDescription(description: string): string[] {
  const materials: string[] = [];
  const materialKeywords = [
    'madeira', 'metal', 'aço', 'plástico', 'vidro', 'mdf', 'couro', 'tecido',
    'polipropileno', 'alumínio', 'cromado', 'nylon', 'mesh', 'tela'
  ];
  
  if (!description) return materials;
  
  const descLower = description.toLowerCase();
  
  for (const material of materialKeywords) {
    if (descLower.includes(material)) {
      materials.push(material.charAt(0).toUpperCase() + material.slice(1));
    }
  }
  
  return materials;
}