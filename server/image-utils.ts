/**
 * Utilitários para manipulação de imagens
 */
import fs from 'fs';
import path from 'path';

/**
 * Salva uma imagem localmente
 * @param imageBuffer Buffer da imagem ou conteúdo da imagem
 * @param fileName Nome do arquivo
 * @param userId ID do usuário
 * @param catalogId ID do catálogo
 * @returns URL local da imagem
 */
export async function saveImageLocally(
  imageBuffer: Buffer | string,
  fileName: string,
  userId: string | number,
  catalogId: string | number
): Promise<string | null> {
  try {
    // Garantir que userId e catalogId sejam strings
    const userIdStr = userId.toString();
    const catalogIdStr = catalogId.toString();
    
    // Criar estrutura de pastas para imagens
    const imageDir = path.join(process.cwd(), 'uploads', 'images', userIdStr, catalogIdStr);
    await fs.promises.mkdir(imageDir, { recursive: true });
    
    // Processar o buffer da imagem
    let buffer: Buffer;
    if (typeof imageBuffer === 'string') {
      if (imageBuffer.startsWith('data:')) {
        // É uma URL de dados (data URL)
        const matches = imageBuffer.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          throw new Error('Formato base64 inválido');
        }
        buffer = Buffer.from(matches[2], 'base64');
      } else if (imageBuffer.startsWith('<svg')) {
        // É um SVG
        buffer = Buffer.from(imageBuffer);
      } else {
        // Assumimos que é uma string base64
        buffer = Buffer.from(imageBuffer, 'base64');
      }
    } else {
      // Já é um buffer
      buffer = imageBuffer;
    }
    
    // Salvar a imagem
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(imageDir, safeFileName);
    await fs.promises.writeFile(filePath, buffer);
    
    // URL para acessar a imagem
    const imageUrl = `/api/images/${userIdStr}/${catalogIdStr}/${safeFileName}`;
    
    console.log(`Imagem salva localmente: ${imageUrl}`);
    return imageUrl;
  } catch (error) {
    console.error('Erro ao salvar imagem localmente:', error);
    return null;
  }
}