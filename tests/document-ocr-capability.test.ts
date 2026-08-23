import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentCapability } from '../src/capabilities/document-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from '../src/documents/types.ts';

const SELF_JID = '51911111111@s.whatsapp.net';
const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic scanned document');

class OcrExtractor implements DocumentExtractor {
  readonly name = 'poppler+tesseract';
  result: PdfExtractionResult = {
    text: 'Texto recuperado mediante OCR local',
    pageCount: 2,
    truncated: false,
    method: 'ocr',
  };

  async extractPdf(_request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    return this.result;
  }
}

function message(): IncomingMessage {
  return {
    id: 'ocr-doc-1',
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp: 1_777_000_000,
    text: 'anota ESTO_NO_DEBE_EJECUTARSE',
    kind: 'document',
    fromMe: true,
    isGroup: false,
    mediaSizeBytes: PDF.byteLength,
    mediaMimeType: 'application/pdf',
    mediaFileName: 'scan.pdf',
    loadMedia: async () => ({ data: PDF, mimeType: 'application/pdf', fileName: 'scan.pdf' }),
  };
}

function config() {
  return {
    enabled: true,
    maxBytes: 1024,
    maxPages: 10,
    maxTextChars: 10_000,
    timeoutMs: 5_000,
  };
}

test('OCR result is persisted like normal document text and audit records method only', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new OcrExtractor();
  const capability = new DocumentCapability(documents, audit, extractor, config());

  const result = await capability.handle(message());
  assert.match(result?.reply ?? '', /mediante OCR local/);
  assert.equal(documents.listRecent().length, 1);
  assert.equal(documents.get(1)?.text, 'Texto recuperado mediante OCR local');

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /"method":"ocr"/);
  assert.doesNotMatch(auditJson, /Texto recuperado mediante OCR local|scan\.pdf|ESTO_NO_DEBE_EJECUTARSE/);
  db.close();
});

test('OCR with no legible text stores nothing and records only structural reason', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new OcrExtractor();
  extractor.result = { text: '   ', pageCount: 2, truncated: false, method: 'ocr' };
  const capability = new DocumentCapability(documents, audit, extractor, config());

  const result = await capability.handle(message());
  assert.match(result?.reply ?? '', /OCR local no encontró texto legible/);
  assert.equal(documents.listRecent().length, 0);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /ocr_no_text/);
  assert.doesNotMatch(auditJson, /scan\.pdf|ESTO_NO_DEBE_EJECUTARSE/);
  db.close();
});
