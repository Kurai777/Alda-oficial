// Definição de tipos para o wrapper do pdf-img-convert

interface PdfConvertOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: string;
  pagesToProcess?: number[];
  [key: string]: any;
}

declare const _default: {
  convert: (filePath: string, options?: PdfConvertOptions) => Promise<Buffer[]>;
};

export default _default;