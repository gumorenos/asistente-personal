import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridPdfExtractor } from '../src/documents/hybrid-pdf-extractor.ts';
import { TesseractPdfOcrExtractor, type OcrCommandRunner } from '../src/documents/tesseract-pdf-ocr-extractor.ts';
import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from '../src/documents/types.ts';

const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic scanned bytes');
const REQUEST: PdfExtractionRequest = {
  data: PDF,
  maxPages: 20,
  maxTextChars: 1_000,
  timeoutMs: 5_000,
};

class FakeExtractor implements DocumentExtractor {
  readonly name: string;
  calls = 0;
  lastRequest?: PdfExtractionRequest;
  result: PdfExtractionResult;

  constructor(name: string, result: PdfExtractionResult) {
    this.name = name;
    this.result = result;
  }

  async extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    this.calls += 1;
    this.lastRequest = request;
    return this.result;
  }
}

test('hybrid extractor keeps text layer and never calls OCR when text exists', async () => {
  const text = new FakeExtractor('poppler', {
    text: 'Texto digital suficiente', pageCount: 2, truncated: false, method: 'text-layer',
  });
  const ocr = new FakeExtractor('tesseract', {
    text: 'NO DEBE USARSE', pageCount: 2, truncated: false, method: 'ocr',
  });
  const hybrid = new HybridPdfExtractor(text, ocr, { ocrTimeoutMs: 60_000 });

  const result = await hybrid.extractPdf(REQUEST);
  assert.equal(result.text, 'Texto digital suficiente');
  assert.equal(result.method, 'text-layer');
  assert.equal(text.calls, 1);
  assert.equal(ocr.calls, 0);
});

test('hybrid extractor falls back to OCR only when text layer is empty', async () => {
  const text = new FakeExtractor('poppler', {
    text: '   ', pageCount: 3, truncated: false, method: 'text-layer',
  });
  const ocr = new FakeExtractor('tesseract', {
    text: 'Contrato escaneado OCR', pageCount: 3, truncated: false, method: 'ocr',
  });
  const hybrid = new HybridPdfExtractor(text, ocr, { ocrTimeoutMs: 42_000 });

  const result = await hybrid.extractPdf(REQUEST);
  assert.equal(result.text, 'Contrato escaneado OCR');
  assert.equal(result.method, 'ocr');
  assert.equal(ocr.calls, 1);
  assert.equal(ocr.lastRequest?.timeoutMs, 42_000);
});

test('hybrid extractor without OCR preserves Stage 4A no-text behavior', async () => {
  const text = new FakeExtractor('poppler', {
    text: '', pageCount: 1, truncated: false, method: 'text-layer',
  });
  const hybrid = new HybridPdfExtractor(text, undefined, { ocrTimeoutMs: 60_000 });

  const result = await hybrid.extractPdf(REQUEST);
  assert.equal(result.text, '');
  assert.equal(result.method, 'text-layer');
});

test('hybrid extractor rejects page-count disagreement between Poppler and OCR', async () => {
  const text = new FakeExtractor('poppler', { text: '', pageCount: 2, truncated: false });
  const ocr = new FakeExtractor('tesseract', { text: 'x', pageCount: 3, truncated: false, method: 'ocr' });
  const hybrid = new HybridPdfExtractor(text, ocr, { ocrTimeoutMs: 60_000 });

  await assert.rejects(() => hybrid.extractPdf(REQUEST), /page count does not match/);
});

test('Tesseract extractor rasterizes one page at a time and uses configured languages', async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const runner: OcrCommandRunner = async (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs });
    if (command === 'pdfinfo') return { stdout: 'Pages:          2\n', stderr: '' };
    if (command === 'pdftoppm') return { stdout: '', stderr: '' };
    if (command === 'tesseract') {
      const page = calls.filter((entry) => entry.command === 'tesseract').length;
      return { stdout: `Página ${page} contrato escaneado`, stderr: '' };
    }
    throw new Error(`unexpected command ${command}`);
  };
  const extractor = new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'spa+eng' }, runner);

  const result = await extractor.extractPdf(REQUEST);
  assert.equal(result.pageCount, 2);
  assert.equal(result.method, 'ocr');
  assert.match(result.text, /Página 1 contrato escaneado/);
  assert.match(result.text, /Página 2 contrato escaneado/);
  assert.deepEqual(calls.map((call) => call.command), ['pdfinfo', 'pdftoppm', 'tesseract', 'pdftoppm', 'tesseract']);

  const rasterCalls = calls.filter((call) => call.command === 'pdftoppm');
  assert.equal(rasterCalls[0]?.args.includes('-singlefile'), true);
  assert.equal(rasterCalls[0]?.args.includes('180'), true);
  const tesseract = calls.find((call) => call.command === 'tesseract');
  assert.equal(tesseract?.args.includes('spa+eng'), true);
  assert.equal(tesseract?.args.includes('--oem'), true);
  assert.equal(tesseract?.args.includes('--psm'), true);
});

test('Tesseract extractor enforces stricter OCR page limit before rasterization', async () => {
  const commands: string[] = [];
  const runner: OcrCommandRunner = async (command) => {
    commands.push(command);
    if (command === 'pdfinfo') return { stdout: 'Pages: 11\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const extractor = new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'spa+eng' }, runner);

  await assert.rejects(() => extractor.extractPdf(REQUEST), /OCR page limit/);
  assert.deepEqual(commands, ['pdfinfo']);
});

test('Tesseract extractor bounds OCR text and stops once max text is reached', async () => {
  let tesseractCalls = 0;
  const runner: OcrCommandRunner = async (command) => {
    if (command === 'pdfinfo') return { stdout: 'Pages: 3\n', stderr: '' };
    if (command === 'pdftoppm') return { stdout: '', stderr: '' };
    if (command === 'tesseract') {
      tesseractCalls += 1;
      return { stdout: 'ABCDEFGHIJKLMN', stderr: '' };
    }
    throw new Error('unexpected command');
  };
  const extractor = new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'spa' }, runner);

  const result = await extractor.extractPdf({ ...REQUEST, maxTextChars: 10 });
  assert.equal(result.text, 'ABCDEFGHIJ');
  assert.equal(result.truncated, true);
  assert.equal(tesseractCalls, 1);
});

test('Tesseract extractor rejects unsafe, unsupported or duplicated languages and invalid resource bounds', () => {
  assert.throws(
    () => new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'spa;rm -rf /' }),
    /Invalid OCR language list/,
  );
  assert.throws(
    () => new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'fra' }),
    /supports only installed languages spa and eng/,
  );
  assert.throws(
    () => new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 180, languages: 'eng+eng' }),
    /supports only installed languages spa and eng/,
  );
  assert.throws(
    () => new TesseractPdfOcrExtractor({ maxPages: 10, dpi: 600, languages: 'spa' }),
    /Invalid OCR DPI/,
  );
  assert.throws(
    () => new TesseractPdfOcrExtractor({ maxPages: 0, dpi: 180, languages: 'spa' }),
    /Invalid OCR max pages/,
  );
});
