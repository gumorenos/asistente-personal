import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from './types.ts';

interface ExecResult {
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeoutMs: number, maxBuffer: number): Promise<ExecResult> {
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

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePageCount(pdfInfo: string): number {
  const match = pdfInfo.match(/^Pages:\s+(\d+)\s*$/m);
  const pages = Number(match?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('Could not determine PDF page count');
  return pages;
}

export class PopplerPdfExtractor implements DocumentExtractor {
  readonly name = 'poppler';

  async extractPdf(request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    if (!(request.data instanceof Uint8Array) || request.data.byteLength === 0) {
      throw new Error('PDF input is empty');
    }
    if (!Number.isInteger(request.maxPages) || request.maxPages < 1) throw new Error('Invalid maxPages');
    if (!Number.isInteger(request.maxTextChars) || request.maxTextChars < 1) throw new Error('Invalid maxTextChars');
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1_000) throw new Error('Invalid timeoutMs');

    const directory = await mkdtemp(join(tmpdir(), 'assistant-pdf-'));
    const inputPath = join(directory, 'input.pdf');

    try {
      await writeFile(inputPath, request.data, { mode: 0o600 });
      const info = await run('pdfinfo', [inputPath], request.timeoutMs, 256 * 1024);
      const pageCount = parsePageCount(info.stdout);
      if (pageCount > request.maxPages) {
        throw new Error(`PDF exceeds page limit (${pageCount} > ${request.maxPages})`);
      }

      const maxBuffer = Math.max(1_048_576, request.maxTextChars * 4);
      const extracted = await run(
        'pdftotext',
        ['-f', '1', '-l', String(pageCount), '-nopgbrk', inputPath, '-'],
        request.timeoutMs,
        maxBuffer,
      );
      const normalized = normalizeExtractedText(extracted.stdout);
      const truncated = normalized.length > request.maxTextChars;
      const text = truncated ? normalized.slice(0, request.maxTextChars).trimEnd() : normalized;

      return { text, pageCount, truncated };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
