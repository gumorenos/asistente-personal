import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentCapability } from '../src/capabilities/document-capability.ts';
import { MemorySearchCapability } from '../src/capabilities/memory-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import type { DocumentExtractor, PdfExtractionRequest, PdfExtractionResult } from '../src/documents/types.ts';

const SELF_JID = '51911111111@s.whatsapp.net';
const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic test bytes');

class FakeExtractor implements DocumentExtractor {
  readonly name = 'fake-pdf';
  calls = 0;
  result: PdfExtractionResult = {
    text: 'Contrato de alquiler con garantía y fecha de pago mensual.',
    pageCount: 3,
    truncated: false,
  };
  error?: Error;

  async extractPdf(_request: PdfExtractionRequest): Promise<PdfExtractionResult> {
    this.calls += 1;
    if (this.error) throw this.error;
    return this.result;
  }
}

function documentMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'doc-msg-1',
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp: 1_777_000_000,
    text: 'anota esto no debe ejecutarse',
    kind: 'document',
    fromMe: true,
    isGroup: false,
    mediaSizeBytes: PDF.byteLength,
    mediaMimeType: 'application/pdf',
    mediaFileName: 'contrato-privado.pdf',
    loadMedia: async () => ({
      data: PDF,
      mimeType: 'application/pdf',
      fileName: 'contrato-privado.pdf',
    }),
    ...overrides,
  };
}

function config(overrides: Partial<ConstructorParameters<typeof DocumentCapability>[3]> = {}) {
  return {
    enabled: true,
    maxBytes: 1024,
    maxPages: 10,
    maxTextChars: 10_000,
    timeoutMs: 5_000,
    ...overrides,
  };
}

test('migration v14 creates document storage and FTS integration', () => {
  const db = new AppDatabase(':memory:');
  const migration = db.native.prepare('SELECT 1 AS found FROM schema_migrations WHERE version = 14').get() as { found: number } | undefined;
  const table = db.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get() as { name: string } | undefined;
  assert.equal(migration?.found, 1);
  assert.equal(table?.name, 'documents');
  db.close();
});

test('disabled document ingestion is terminal and never downloads media', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  let loads = 0;
  const capability = new DocumentCapability(documents, audit, extractor, config({ enabled: false }));

  const result = await capability.handle(documentMessage({
    loadMedia: async () => {
      loads += 1;
      return { data: PDF, mimeType: 'application/pdf', fileName: 'secret.pdf' };
    },
  }));

  assert.equal(result?.handled, true);
  assert.match(result?.reply ?? '', /deshabilitada/);
  assert.equal(loads, 0);
  assert.equal(extractor.calls, 0);
  assert.equal(documents.listRecent().length, 0);
  db.close();
});

test('declared size and non-PDF mime are rejected before download', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  let loads = 0;
  const capability = new DocumentCapability(documents, audit, extractor, config({ maxBytes: 20 }));
  const lazy = async () => {
    loads += 1;
    return { data: PDF, mimeType: 'application/pdf', fileName: 'x.pdf' };
  };

  const oversized = await capability.handle(documentMessage({ mediaSizeBytes: 21, loadMedia: lazy }));
  assert.match(oversized?.reply ?? '', /no fue descargado/);

  const wrongMime = await capability.handle(documentMessage({
    id: 'doc-msg-2',
    mediaSizeBytes: 10,
    mediaMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    loadMedia: lazy,
  }));
  assert.match(wrongMime?.reply ?? '', /únicamente archivos PDF/);
  assert.equal(loads, 0);
  assert.equal(extractor.calls, 0);
  db.close();
});

test('actual size and PDF magic are revalidated after lazy download', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  const capability = new DocumentCapability(documents, audit, extractor, config({ maxBytes: 30 }));

  const oversized = await capability.handle(documentMessage({
    mediaSizeBytes: undefined,
    loadMedia: async () => ({
      data: new Uint8Array(31).fill(65),
      mimeType: 'application/pdf',
      fileName: 'oversize.pdf',
    }),
  }));
  assert.match(oversized?.reply ?? '', /no fue procesado/);

  const invalid = await capability.handle(documentMessage({
    id: 'doc-msg-2',
    loadMedia: async () => ({
      data: new TextEncoder().encode('not-a-real-pdf'),
      mimeType: 'application/pdf',
      fileName: 'fake.pdf',
    }),
  }));
  assert.match(invalid?.reply ?? '', /PDF válido/);
  assert.equal(extractor.calls, 0);
  assert.equal(documents.listRecent().length, 0);
  db.close();
});

test('successful PDF extraction stores text only, indexes it and audits no content', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  const capability = new DocumentCapability(documents, audit, extractor, config());

  const result = await capability.handle(documentMessage());
  assert.equal(result?.handled, true);
  assert.match(result?.reply ?? '', /Documento #1 indexado localmente/);
  assert.equal(extractor.calls, 1);

  const stored = documents.get(1);
  assert.equal(stored?.fileName, 'contrato-privado.pdf');
  assert.equal(stored?.pageCount, 3);
  assert.equal(stored?.text, extractor.result.text);
  assert.equal(stored?.byteLength, PDF.byteLength);
  assert.match(stored?.sha256 ?? '', /^[a-f0-9]{64}$/);

  const search = new LocalMemorySearchRepository(db);
  const matches = search.search('garantia pago', { source: 'document' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.sourceId, '1');

  const memory = new MemorySearchCapability(search, audit, 'America/Lima');
  const searchReply = await memory.handle({
    ...documentMessage(),
    id: 'search-doc',
    kind: 'text',
    text: 'busca documentos contrato',
    loadMedia: undefined,
  });
  assert.match(searchReply?.reply ?? '', /Memoria local · documentos/);
  assert.match(searchReply?.reply ?? '', /Documento #1/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /document\.ingest\.succeeded/);
  assert.doesNotMatch(auditJson, /Contrato de alquiler|contrato-privado\.pdf/);
  assert.doesNotMatch(auditJson, /[a-f0-9]{64}/);
  db.close();
});

test('PDF without text layer is not persisted and suggests future OCR', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  extractor.result = { text: '   ', pageCount: 2, truncated: false };
  const capability = new DocumentCapability(documents, audit, extractor, config());

  const result = await capability.handle(documentMessage());
  assert.match(result?.reply ?? '', /requiera OCR/);
  assert.equal(documents.listRecent().length, 0);
  assert.match(JSON.stringify(audit.listRecent()), /no_text_layer/);
  db.close();
});

test('extractor failure is safe and never persists partial document state', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  extractor.error = new Error('private parser detail /tmp/secret.pdf');
  const capability = new DocumentCapability(documents, audit, extractor, config());

  const result = await capability.handle(documentMessage());
  assert.match(result?.reply ?? '', /No pude extraer texto/);
  assert.doesNotMatch(result?.reply ?? '', /private parser detail|secret\.pdf/);
  assert.equal(documents.listRecent().length, 0);
  assert.doesNotMatch(JSON.stringify(audit.listRecent()), /private parser detail|secret\.pdf/);
  db.close();
});

test('document repository is message-id idempotent and document commands expose bounded local state', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const extractor = new FakeExtractor();
  const capability = new DocumentCapability(documents, audit, extractor, config());

  await capability.handle(documentMessage());
  await capability.handle(documentMessage());
  assert.equal(documents.listRecent().length, 1);

  const list = await capability.handle({ ...documentMessage(), kind: 'text', text: 'documentos', loadMedia: undefined });
  assert.match(list?.reply ?? '', /Documentos recientes/);
  assert.match(list?.reply ?? '', /#1 contrato-privado\.pdf/);

  const detail = await capability.handle({ ...documentMessage(), kind: 'text', text: 'documento #1', loadMedia: undefined });
  assert.match(detail?.reply ?? '', /Documento #1/);
  assert.match(detail?.reply ?? '', /Contrato de alquiler/);
  db.close();
});
