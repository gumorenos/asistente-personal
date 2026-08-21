export interface PdfExtractionRequest {
  data: Uint8Array;
  maxPages: number;
  maxTextChars: number;
  timeoutMs: number;
}

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  truncated: boolean;
}

export interface DocumentExtractor {
  readonly name: string;
  extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult>;
}
