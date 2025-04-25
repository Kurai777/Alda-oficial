/**
 * Script para inicializar dados de teste no armazenamento
 * Este script é executado apenas uma vez para popular o banco de dados
 * com dados básicos para testes
 */
import { storage } from '../storage';
import fs from 'fs';
import path from 'path';
import { saveImageLocally } from '../image-utils';

export async function setupTestData() {
  console.log("Configurando dados de teste...");
  
  try {
    // Verificar se já existem produtos
    const existingProducts = await storage.getProductsByUserId(1);
    if (existingProducts.length > 0) {
      console.log(`Já existem ${existingProducts.length} produtos. Pulando inicialização de dados.`);
      return;
    }
    
    // Criar um catálogo de teste
    const catalog = await storage.createCatalog({
      userId: 1,
      fileName: "POE - MÃVEIS.xlsx",
      fileUrl: "/uploads/test-catalog.xlsx",
      processedStatus: "completed",
      firestoreCatalogId: "test-catalog-1",
      firebaseUserId: null
    });
    
    console.log(`Catálogo criado: ${catalog.id} - ${catalog.fileName}`);
    
    // Criar produtos de amostra para o catálogo
    const sampleProducts = [
      {
        name: "Sofá Home",
        code: "SOFA-HOME",
        description: "Sofá 3 lugares em tecido premium",
        price: 399900, // R$ 3.999,00
        category: "Sofá",
        manufacturer: "POE Design",
        location: "2º Piso",
        imageUrl: "/api/images/1/local-1/sofa-home.jpg"
      },
      {
        name: "Mesa Centro",
        code: "MESA-CTR",
        description: "Mesa de centro em madeira maciça",
        price: 189900, // R$ 1.899,00
        category: "Mesa",
        manufacturer: "Sierra Móveis",
        location: "1º Piso",
        imageUrl: "/api/images/1/local-1/mesa-centro.jpg"
      },
      {
        name: "Poltrona Oslo",
        code: "PLT-OSLO",
        description: "Poltrona em tecido com pés em madeira",
        price: 299900, // R$ 2.999,00
        category: "Poltrona",
        manufacturer: "Fratini Design",
        location: "2º Piso",
        imageUrl: "/api/images/1/local-1/poltrona-oslo.jpg"
      }
    ];
    
    // Salvar imagens para os produtos
    await saveSampleImages();
    
    // Criar os produtos no banco de dados
    for (const productData of sampleProducts) {
      const product = await storage.createProduct({
        ...productData,
        userId: 1,
        catalogId: catalog.id,
        colors: ["white", "gray", "brown"],
        materials: ["Madeira", "Tecido"],
        sizes: [{ width: 200, height: 85, depth: 95 }],
        stock: 10,
        firestoreId: null,
        firebaseUserId: null,
        isEdited: false
      });
      
      console.log(`Produto criado: ${product.id} - ${product.name}`);
    }
    
    console.log("Dados de teste configurados com sucesso!");
  } catch (error) {
    console.error("Erro ao configurar dados de teste:", error);
  }
}

/**
 * Função para salvar imagens de amostra para os produtos
 * Usa placeholder SVGs básicos para demonstração
 */
async function saveSampleImages() {
  try {
    // Criar diretório para imagens
    const imagesDir = path.join(process.cwd(), 'uploads', 'images', '1', 'local-1');
    fs.mkdirSync(imagesDir, { recursive: true });
    
    // Cores básicas como placeholders simples
    const colorMap = {
      'sofa-home.jpg': '#8B4513', // Marrom (sofá)
      'mesa-centro.jpg': '#A0522D', // Sienna (madeira)
      'poltrona-oslo.jpg': '#BC8F8F', // RosyBrown (poltrona)
    };
    
    for (const [filename, color] of Object.entries(colorMap)) {
      const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
        <rect width="600" height="400" fill="${color}" />
        <text x="300" y="200" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
          ${filename.replace('.jpg', '')}
        </text>
      </svg>`;
      
      const filePath = path.join(imagesDir, filename);
      fs.writeFileSync(filePath, svgContent);
      
      console.log(`Imagem salva: ${filePath}`);
    }
  } catch (error) {
    console.error("Erro ao salvar imagens de amostra:", error);
  }
}