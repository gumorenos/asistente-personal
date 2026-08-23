export interface PdfExtractionRequest {
  data: Uint8Array;
  maxPages: number;
  maxTextChars: number;
  timeoutMs: number;
}

export type PdfExtractionMethod = 'text-layer' | 'ocr';

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  truncated: boolean;
  method?: PdfExtractionMethod;
}

export interface DocumentExtractor {
  readonly name: string;
  extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult>;
}
