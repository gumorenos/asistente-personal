import { execFile } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from './types.ts';

interface ExecResult {
  stdout: string;
  stderr: string;
}

export type OcrCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
  maxBuffer: number,
) => Promise<ExecResult>;

function defaultRunner(command: string, args: string[], timeoutMs: number, maxBuffer: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function parsePageCount(pdfInfo: string): number {
  const match = pdfInfo.match(/^Pages:\s+(\d+)\s*$/m);
  const pages = Number(match?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('Could not determine PDF page count for OCR');
  return pages;
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateLanguages(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{3}(?:\+[a-z]{3})?$/.test(normalized)) {
    throw new Error('Invalid OCR language list');
  }
  const languages = normalized.split('+');
  if (new Set(languages).size !== languages.length || languages.some((language) => language !== 'spa' && language !== 'eng')) {
    throw new Error('OCR supports only installed languages spa and eng');
  }
  return normalized;
}

export interface TesseractPdfOcrConfig {
  maxPages: number;
  dpi: number;
  languages: string;
}

export class TesseractPdfOcrExtractor implements DocumentExtractor {
  readonly name = 'tesseract';

  private readonly config: TesseractPdfOcrConfig;
  private readonly runner: OcrCommandRunner;

  constructor(config: TesseractPdfOcrConfig, runner: OcrCommandRunner = defaultRunner) {
    if (!Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 50) {
      throw new Error('Invalid OCR max pages');
    }
    if (!Number.isInteger(config.dpi) || config.dpi < 100 || config.dpi > 300) {
      throw new Error('Invalid OCR DPI');
    }
    this.config = { ...config, languages: validateLanguages(config.languages) };
    this.runner = runner;
  }

  async extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    if (!(request.data instanceof Uint8Array) || request.data.byteLength === 0) throw new Error('PDF input is empty');
    if (!Number.isInteger(request.maxPages) || request.maxPages < 1) throw new Error('Invalid maxPages');
    if (!Number.isInteger(request.maxTextChars) || request.maxTextChars < 1) throw new Error('Invalid maxTextChars');
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1_000) throw new Error('Invalid timeoutMs');

    const directory = await mkdtemp(join(tmpdir(), 'assistant-ocr-'));
    const inputPath = join(directory, 'input.pdf');
    const deadline = Date.now() + request.timeoutMs;

    const remaining = (): number => {
      const value = deadline - Date.now();
      if (value < 1_000) throw new Error('OCR timeout exceeded');
      return value;
    };

    try {
      await writeFile(inputPath, request.data, { mode: 0o600 });
      const info = await this.runner('pdfinfo', [inputPath], remaining(), 256 * 1024);
      const pageCount = parsePageCount(info.stdout);
      const effectivePageLimit = Math.min(request.maxPages, this.config.maxPages);
      if (pageCount > effectivePageLimit) {
        throw new Error(`PDF exceeds OCR page limit (${pageCount} > ${effectivePageLimit})`);
      }

      const chunks: string[] = [];
      let currentChars = 0;
      let truncated = false;
      const textBufferLimit = Math.max(256 * 1024, Math.min(4 * 1024 * 1024, request.maxTextChars * 4));

      for (let page = 1; page <= pageCount; page += 1) {
        const prefix = join(directory, `page-${page}`);
        const imagePath = `${prefix}.png`;

        await this.runner(
          'pdftoppm',
          [
            '-f', String(page),
            '-l', String(page),
            '-r', String(this.config.dpi),
            '-png',
            '-singlefile',
            inputPath,
            prefix,
          ],
          remaining(),
          256 * 1024,
        );

        try {
          const ocr = await this.runner(
            'tesseract',
            [imagePath, 'stdout', '-l', this.config.languages, '--oem', '1', '--psm', '3'],
            remaining(),
            textBufferLimit,
          );
          const normalized = normalizeOcrText(ocr.stdout);
          if (normalized) {
            const separator = currentChars > 0 ? '\n\n' : '';
            const available = request.maxTextChars - currentChars - separator.length;
            if (available <= 0) {
              truncated = true;
              break;
            }
            const pageText = normalized.length > available ? normalized.slice(0, available).trimEnd() : normalized;
            chunks.push(`${separator}${pageText}`);
            currentChars += separator.length + pageText.length;
            if (normalized.length > available) {
              truncated = true;
              break;
            }
          }
        } finally {
          await unlink(imagePath).catch(() => undefined);
        }
      }

      return {
        text: chunks.join('').trim(),
        pageCount,
        truncated,
        method: 'ocr',
      };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
