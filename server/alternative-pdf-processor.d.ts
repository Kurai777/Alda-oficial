// Definição de tipos para o processador alternativo de PDF

interface PdfProcessOptions {
  width?: number;
  height?: number;
  pagesToProcess?: number[] | null;
  [key: string]: any;
}

export function generateImagesFromPdf(
  filePath: string, 
  options?: PdfProcessOptions
): Promise<Buffer[]>;

declare const _default: {
  convert: (filePath: string, options?: PdfProcessOptions) => Promise<Buffer[]>;
};

export default _default;