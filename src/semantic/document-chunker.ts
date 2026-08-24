import { createHash } from 'node:crypto';
import type { DocumentChunk } from './types.ts';

export interface DocumentChunkerConfig {
  maxChars: number;
  overlapChars: number;
  maxChunks: number;
}

function validateConfig(config: DocumentChunkerConfig): void {
  if (!Number.isInteger(config.maxChars) || config.maxChars < 200 || config.maxChars > 4_000) {
    throw new Error('Invalid semantic chunk size');
  }
  if (!Number.isInteger(config.overlapChars) || config.overlapChars < 0 || config.overlapChars >= Math.floor(config.maxChars / 2)) {
    throw new Error('Invalid semantic chunk overlap');
  }
  if (!Number.isInteger(config.maxChunks) || config.maxChunks < 1 || config.maxChunks > 500) {
    throw new Error('Invalid semantic max chunks');
  }
}

function findChunkEnd(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;
  const lowerBound = Math.max(start + Math.floor((targetEnd - start) * 0.65), start + 1);
  for (let index = targetEnd; index >= lowerBound; index -= 1) {
    const char = text[index - 1];
    if (char === '\n' || char === '.' || char === ';' || char === ':' || char === ' ') return index;
  }
  return targetEnd;
}

export function chunkDocumentText(text: string, config: DocumentChunkerConfig): DocumentChunk[] {
  validateConfig(config);
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let finished = false;
  while (start < normalized.length && chunks.length < config.maxChunks) {
    const targetEnd = Math.min(start + config.maxChars, normalized.length);
    const end = findChunkEnd(normalized, start, targetEnd);
    const raw = normalized.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const charStart = start + leading;
    const charEnd = end - trailing;
    const chunkText = normalized.slice(charStart, charEnd);

    if (chunkText) {
      chunks.push({
        chunkIndex: chunks.length,
        charStart,
        charEnd,
        text: chunkText,
        textHash: createHash('sha256').update(chunkText).digest('hex'),
      });
    }

    if (end >= normalized.length) {
      finished = true;
      break;
    }
    start = Math.max(end - config.overlapChars, start + 1);
  }

  if (!finished) throw new Error('Document exceeds semantic chunk limit');
  return chunks;
}
