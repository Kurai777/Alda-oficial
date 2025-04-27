import fs from 'fs/promises';
import path from 'path';
import StreamZip from 'node-stream-zip'; // Biblioteca para ler arquivos ZIP
import { XMLParser } from 'fast-xml-parser'; // Para parsear XML interno do Excel
import { uploadBufferToS3 } from './s3-service.js';

/**
 * Mapeia IDs de relacionamento para caminhos de imagem.
 * @param {StreamZip} zip Arquivo Zip aberto do Excel.
 * @returns {Promise<Map<string, string>>} Mapa de rId para target (ex: 'rId1' -> '../media/image1.png').
 */
async function getDrawingRelationships(zip) {
  const relsPath = 'xl/drawings/_rels/drawing1.xml.rels'; // Caminho comum
  const relationships = new Map();
  try {
    if (await zip.entry(relsPath)) {
      const relsContent = await zip.entryData(relsPath);
      const parser = new XMLParser({ ignoreAttributes: false });
      const relsData = parser.parse(relsContent);
      
      if (relsData.Relationships && relsData.Relationships.Relationship) {
        const relArray = Array.isArray(relsData.Relationships.Relationship) 
                           ? relsData.Relationships.Relationship 
                           : [relsData.Relationships.Relationship];
                           
        relArray.forEach(rel => {
          if (rel['@_Type']?.endsWith('/image')) {
            relationships.set(rel['@_Id'], rel['@_Target']);
          }
        });
      }
    }
  } catch (error) {
    console.error("Erro ao ler relacionamentos de desenho:", error);
  }
  console.log(`Relacionamentos de imagem encontrados: ${relationships.size}`);
  return relationships;
}

/**
 * Extrai informações de ancoragem das imagens do arquivo de desenho.
 * @param {StreamZip} zip Arquivo Zip aberto do Excel.
 * @returns {Promise<Map<string, number>>} Mapa de rId para anchorRow.
 */
async function getImageAnchors(zip) {
  const drawingPath = 'xl/drawings/drawing1.xml'; // Caminho comum
  const anchors = new Map();
  try {
    if (await zip.entry(drawingPath)) {
      const drawingContent = await zip.entryData(drawingPath);
      const parser = new XMLParser({ 
        ignoreAttributes: false,
        isArray: (tagName, jPath) => jPath.endsWith('xdr:twoCellAnchor') || jPath.endsWith('xdr:pic') // Garante que sejam arrays
      });
      const drawingData = parser.parse(drawingContent);

      // Navegar pela estrutura XML complexa para encontrar a âncora da imagem
      const anchorsData = drawingData['xdr:wsDr']?.['xdr:twoCellAnchor'] || [];
      
      for (const anchor of anchorsData) {
        const pic = anchor['xdr:pic'];
        if (pic) {
          const rId = pic['xdr:blipFill']?.['a:blip']?.['@_r:embed'];
          const fromRow = anchor['xdr:from']?.['xdr:row']; // Linha inicial (0-based)
          const toRow = anchor['xdr:to']?.['xdr:row'];     // Linha final (0-based)
          
          // Usar a linha final como referência de âncora (convertida para 1-based)
          const anchorRow = (typeof toRow === 'number') ? toRow + 1 : 
                            (typeof fromRow === 'number' ? fromRow + 1 : null);
                            
          if (rId && anchorRow !== null) {
            anchors.set(rId, anchorRow);
          }
        }
      }
    }
  } catch (error) {
    console.error("Erro ao ler âncoras de desenho:", error);
  }
  console.log(`Âncoras de imagem encontradas: ${anchors.size}`);
  return anchors;
}

/**
 * Extrai imagens de um arquivo Excel usando abordagem de leitura de ZIP.
 */
export async function extractImagesFromExcelZip(
  filePath, 
  userId,
  catalogId
) {
  console.log(`\\n=== INICIANDO EXTRAÇÃO DE IMAGENS (Node.js ZIP) ===`);
  console.log(`Arquivo: ${filePath}`);
  const imageDataList = [];
  let zip;

  try {
    zip = new StreamZip.async({ file: filePath });
    const relationships = await getDrawingRelationships(zip);
    const anchors = await getImageAnchors(zip);
    const entries = await zip.entries();
    const imageEntries = Object.values(entries).filter(entry => 
        entry.name.startsWith('xl/media/image') && !entry.isDirectory
    );

    console.log(`Encontradas ${imageEntries.length} entradas de imagem em xl/media/`);
    let uploadSuccessCount = 0;

    for (const entry of imageEntries) {
      const relativePath = entry.name.substring(entry.name.indexOf('media/')); // ex: media/image1.png
      let rId = null;
      let anchorRow = null;
      
      // Encontrar o rId correspondente ao caminho da imagem
      for (const [id, target] of relationships.entries()) {
          // O target pode ser relativo (../media/image1.png)
          if (target.endsWith(path.basename(relativePath))) {
              rId = id;
              break;
          }
      }

      if (!rId) {
          console.warn(`Não foi possível encontrar rId para imagem: ${entry.name}`);
          continue;
      }

      // Obter a linha de âncora usando o rId
      anchorRow = anchors.get(rId);
      if (anchorRow === null || anchorRow === undefined) {
          console.warn(`Não foi possível encontrar âncora para imagem: ${entry.name} (rId: ${rId})`);
          // Poderíamos tentar uma linha padrão ou pular?
          anchorRow = -1; // Indicar âncora desconhecida
      }

      console.log(`Processando: ${entry.name}, rId: ${rId}, AnchorRow: ${anchorRow}`);

      try {
        const imageBuffer = await zip.entryData(entry.name);
        const mimeType = require('mime-types').lookup(entry.name) || 'image/png';
        const originalFileName = path.basename(entry.name);
        const s3Key = `users/${userId}/products/${catalogId}/${Date.now()}-${originalFileName}`;
        const imageUrl = await uploadBufferToS3(imageBuffer, s3Key, mimeType);

        if (anchorRow !== -1) {
            imageDataList.push({ imageUrl, anchorRow });
            uploadSuccessCount++;
            console.log(`   -> Imagem ${originalFileName} (linha ~${anchorRow}) enviada para S3: ${imageUrl}`);
        } else {
            console.log(`   -> Imagem ${originalFileName} enviada, mas sem âncora válida.`);
        }

      } catch (uploadError) {
        console.error(`Falha no upload/processamento da imagem ${entry.name}.`, uploadError);
      }
    }
    console.log(`Upload de ${uploadSuccessCount} imagens com âncora concluído.`);

  } catch (error) {
    console.error('Erro CRÍTICO ao extrair imagens via Node.js ZIP:', error);
  } finally {
    if (zip) {
      await zip.close();
    }
  }
  
  console.log(`=== FIM EXTRAÇÃO DE IMAGENS (Node.js ZIP) ===`);
  return imageDataList;
} 