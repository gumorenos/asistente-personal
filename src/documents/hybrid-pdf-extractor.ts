import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from './types.ts';

export interface HybridPdfExtractorConfig {
  ocrTimeoutMs: number;
}

export class HybridPdfExtractor implements DocumentExtractor {
  readonly name: string;

  private readonly textExtractor: DocumentExtractor;
  private readonly ocrExtractor?: DocumentExtractor;
  private readonly config: HybridPdfExtractorConfig;

  constructor(
    textExtractor: DocumentExtractor,
    ocrExtractor: DocumentExtractor | undefined,
    config: HybridPdfExtractorConfig,
  ) {
    if (!Number.isInteger(config.ocrTimeoutMs) || config.ocrTimeoutMs < 1_000) {
      throw new Error('Invalid OCR timeout');
    }
    this.textExtractor = textExtractor;
    this.ocrExtractor = ocrExtractor;
    this.config = config;
    this.name = ocrExtractor ? `${textExtractor.name}+${ocrExtractor.name}` : textExtractor.name;
  }

  async extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    const textLayer = await this.textExtractor.extractPdf(request);
    if (textLayer.text.trim() || !this.ocrExtractor) {
      return {
        ...textLayer,
        method: textLayer.method ?? 'text-layer',
      };
    }

    const ocr = await this.ocrExtractor.extractPdf({
      ...request,
      timeoutMs: this.config.ocrTimeoutMs,
    });
    if (ocr.pageCount !== textLayer.pageCount) {
      throw new Error('OCR page count does not match text-layer extractor');
    }
    return {
      ...ocr,
      pageCount: textLayer.pageCount,
      method: 'ocr',
    };
  }
}
