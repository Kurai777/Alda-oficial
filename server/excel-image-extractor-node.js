import fs from 'fs/promises';
import path from 'path';
import StreamZip from 'node-stream-zip'; // Biblioteca para ler arquivos ZIP
import { XMLParser } from 'fast-xml-parser'; // Para parsear XML interno do Excel
import { uploadBufferToS3 } from './s3-service.js';
import mime from 'mime-types'; // Usar import ES6

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
 * Encontra o caminho do arquivo de desenho associado a uma planilha.
 */
async function findDrawingFileForSheet(zip, sheetXmlPath) {
    const sheetRelsPath = `xl/worksheets/_rels/${path.basename(sheetXmlPath)}.rels`;
    console.log(`Procurando relacionamentos da planilha em: ${sheetRelsPath}`);
    try {
        if (await zip.entry(sheetRelsPath)) {
            const relsContent = await zip.entryData(sheetRelsPath);
            const parser = new XMLParser({ ignoreAttributes: false });
            const relsData = parser.parse(relsContent);
            
            if (relsData.Relationships && relsData.Relationships.Relationship) {
                const relArray = Array.isArray(relsData.Relationships.Relationship) 
                                   ? relsData.Relationships.Relationship 
                                   : [relsData.Relationships.Relationship];
                                   
                const drawingRel = relArray.find(rel => rel['@_Type']?.endsWith('/drawing'));
                if (drawingRel && drawingRel['@_Target']) {
                    // O Target é relativo a xl/worksheets/, precisamos do caminho completo
                    const drawingPathRelative = drawingRel['@_Target'].startsWith('..') 
                        ? drawingRel['@_Target'].substring(3) // Remove ../
                        : `drawings/${drawingRel['@_Target']}`;
                    const fullDrawingPath = `xl/${drawingPathRelative}`;
                    console.log(`Arquivo de desenho encontrado para ${sheetXmlPath}: ${fullDrawingPath}`);
                    return fullDrawingPath;
                }
            }
        }
    } catch(error) {
        console.error(`Erro ao ler relacionamentos de ${sheetXmlPath}:`, error);
    }
    console.log(`Nenhum arquivo de desenho encontrado para ${sheetXmlPath}. Usando padrão drawing1.xml.`);
    return 'xl/drawings/drawing1.xml'; // Fallback para o padrão
}

/**
 * Extrai informações de ancoragem das imagens (agora usa o drawingPath correto)
 */
async function getImageAnchors(zip, drawingPath) { // Recebe o caminho do desenho
  const anchors = new Map();
  console.log(`Tentando ler âncoras de: ${drawingPath}`);
  try {
    if (await zip.entry(drawingPath)) {
      const drawingContent = await zip.entryData(drawingPath);
      const parser = new XMLParser({ 
        ignoreAttributes: false,
        // Garantir que ambos os tipos de âncora e pic sejam arrays
        isArray: (tagName, jPath) => jPath.endsWith('xdr:twoCellAnchor') || 
                                     jPath.endsWith('xdr:oneCellAnchor') || 
                                     jPath.endsWith('xdr:pic')
      });
      const drawingData = parser.parse(drawingContent);

      const processAnchor = (anchor) => {
        // Tenta encontrar 'xdr:pic' diretamente ou dentro de 'xdr:graphicFrame'
        const picArray = anchor['xdr:pic'] || 
                         anchor['xdr:graphicFrame']?.['xdr:nvGraphicFramePr']?.['xdr:cNvPr']?.['@_name']?.includes('Picture') ? 
                         [anchor['xdr:graphicFrame']?.['xdr:pic']] : // Simular array se encontrado em graphicFrame
                         []; // Caso não seja nem um nem outro
                         
        const pic = picArray && picArray.length > 0 ? picArray[0] : null;

        if (pic) {
          const rId = pic['xdr:blipFill']?.['a:blip']?.['@_r:embed'];
          const fromRow = anchor['xdr:from']?.['xdr:row']; 
          const toRow = anchor['xdr:to']?.['xdr:row']; // Pode não existir em oneCellAnchor
          
          // Prioriza toRow, depois fromRow. Adiciona +1 para ser 1-based.
          const anchorRow = (typeof toRow === 'number') ? toRow + 1 : 
                            (typeof fromRow === 'number' ? fromRow + 1 : null);
                            
          if (rId && anchorRow !== null) {
            console.log(`  -> Encontrada âncora para rId ${rId} na linha ${anchorRow}`);
            anchors.set(rId, anchorRow);
          }
        }
      };

      // Processar ambos os tipos de âncora
      (drawingData['xdr:wsDr']?.['xdr:twoCellAnchor'] || []).forEach(processAnchor);
      (drawingData['xdr:wsDr']?.['xdr:oneCellAnchor'] || []).forEach(processAnchor);

    } else {
      console.warn(`Arquivo de desenho ${drawingPath} não encontrado no ZIP.`);
    }
  } catch (error) {
    console.error(`Erro ao ler âncoras de ${drawingPath}:`, error);
  }
  console.log(`Âncoras de imagem encontradas em ${drawingPath}: ${anchors.size}`);
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

    // *** DESCOBRIR O ARQUIVO DE DESENHO CORRETO ***
    // Assumindo que processamos a primeira planilha (sheet1.xml)
    // Uma implementação mais completa poderia iterar por todas as planilhas
    const sheetXmlPath = 'xl/worksheets/sheet1.xml'; // Caminho comum para a primeira planilha
    const drawingPath = await findDrawingFileForSheet(zip, sheetXmlPath);

    // Ler relacionamentos e âncoras USANDO o drawingPath correto
    const relationships = await getDrawingRelationships(zip); // Rels do desenho ainda são fixos?
    const anchors = await getImageAnchors(zip, drawingPath); // Passa o caminho correto
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
        const mimeType = mime.lookup(entry.name) || 'image/png';
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