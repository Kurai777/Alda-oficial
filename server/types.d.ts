/**
 * Declarações de tipos para módulos externos
 */

// Para S3 Service
declare module './s3-service' {
  export function uploadFileToS3(filePath: string, s3Key: string, contentType?: string): Promise<string>;
  export function downloadFileFromS3(s3Key: string): Promise<Uint8Array>;
  export function getSignedUrl(s3Key: string, expiresIn?: number): Promise<string>;
  export function fileExistsInS3(s3Key: string): Promise<boolean>;
  export function deleteFileFromS3(s3Key: string): Promise<void>;
  export function listFilesInS3(prefix: string): Promise<string[]>;
  // Adicione outras funções conforme necessário
}

// Para mime-types
declare module 'mime-types' {
  export function lookup(path: string): string | false;
  export function extension(type: string): string | false;
  export function contentType(type: string): string | false;
  // Adicione outras funções conforme necessário
}

// Para html-pdf
declare module 'html-pdf' {
  interface Options {
    format?: string;
    orientation?: 'portrait' | 'landscape';
    border?: string | { 
      top?: string; 
      right?: string; 
      bottom?: string; 
      left?: string;
    };
    header?: {
      height?: string;
      contents?: string;
    };
    footer?: {
      height?: string;
      contents?: string;
    };
    type?: 'pdf' | 'png' | 'jpeg';
    quality?: string;
    renderDelay?: number;
    timeout?: number;
    [key: string]: any;
  }

  interface PDF {
    toBuffer(callback: (err: Error | null, buffer: Buffer) => void): void;
    toFile(filepath: string, callback: (err: Error | null, filepath: string) => void): void;
    toStream(callback: (err: Error | null, stream: NodeJS.ReadableStream) => void): void;
  }

  export function create(html: string, options?: Options): PDF;
}

// Para outros módulos que possam precisar de tipos
declare module './test-upload.js';
declare module './catalog-s3-manager.js';
declare module './ai-excel-processor.js';
declare module '../client/src/lib/firebase';