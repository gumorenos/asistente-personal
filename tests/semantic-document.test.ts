import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticDocumentCapability } from '../src/capabilities/semantic-document-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { DocumentSemanticRepository } from '../src/database/document-semantic-repository.ts';
import { chunkDocumentText } from '../src/semantic/document-chunker.ts';
import { DocumentSemanticService } from '../src/semantic/document-semantic-service.ts';
import type { EmbeddingProvider } from '../src/semantic/types.ts';

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake';
  readonly model = 'fake-v1';
  readonly dimensions = 3;
  calls: string[][] = [];

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map((text) => {
      const normalized = text.toLowerCase();
      if (normalized.includes('vacaciones')) return [1, 0, 0];
      if (normalized.includes('presupuesto')) return [0, 1, 0];
      return [0, 0, 1];
    });
  }
}

class FailingEmbeddingProvider extends FakeEmbeddingProvider {
  override async embed(texts: string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    throw new Error('private upstream body should never reach audit');
  }
}

function saveDocument(documents: DocumentRepository, messageId: string, text: string) {
  return documents.save({
    messageId,
    receivedAt: 1_777_000_000,
    fileName: `${messageId}.pdf`,
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteLength: 1_000,
    pageCount: 2,
    text,
    truncated: false,
  });
}

function message(text: string): IncomingMessage {
  return {
    id: 'self-command-1',
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_000_100,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function createService(database: AppDatabase, provider?: EmbeddingProvider, enabled = true) {
  const documents = new DocumentRepository(database);
  const semantic = new DocumentSemanticRepository(database);
  const audit = new AuditRepository(database);
  const service = new DocumentSemanticService(documents, semantic, audit, provider, {
    enabled,
    maxChars: 240,
    overlapChars: 40,
    maxChunks: 20,
    embeddingBatchSize: 2,
  });
  return { documents, semantic, audit, service };
}

test('migration v15 creates chunk and embedding tables with cascade foreign keys', () => {
  const db = new AppDatabase(':memory:');
  try {
    const versions = db.native.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert.equal(versions.at(-1)?.version, 15);
    const tables = db.native.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
    assert.ok(tables.some((row) => row.name === 'document_chunks'));
    assert.ok(tables.some((row) => row.name === 'document_embeddings'));
  } finally { db.close(); }
});

test('chunker is deterministic, bounded, overlapping and accepts an exact final max chunk', () => {
  const text = Array.from({ length: 24 }, (_, index) => `Párrafo ${index} con vacaciones y contenido suficientemente largo.`).join(' ');
  const config = { maxChars: 240, overlapChars: 40, maxChunks: 20 };
  const first = chunkDocumentText(text, config);
  const second = chunkDocumentText(text, config);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.every((chunk) => chunk.text.length <= 240));
  assert.ok(first.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.textHash)));
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(first[index]!.charStart < first[index - 1]!.charEnd);
  }

  const exact = chunkDocumentText('x'.repeat(400), { maxChars: 200, overlapChars: 0, maxChunks: 2 });
  assert.equal(exact.length, 2);
});

test('semantic service can create local chunks without any external embedding provider', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const { documents, semantic, service } = createService(db);
    const stored = saveDocument(documents, 'local-only', 'vacaciones '.repeat(80));
    const result = await service.indexDocument(stored.id);
    assert.equal(result.status, 'indexed');
    assert.ok(result.chunks > 1);
    assert.equal(result.embeddings, 0);
    assert.equal(semantic.countChunks(stored.id), result.chunks);
    assert.equal(semantic.countEmbeddings(stored.id), 0);
  } finally { db.close(); }
});

test('semantic indexing stores embeddings and vector search ranks the matching chunk', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const provider = new FakeEmbeddingProvider();
    const { documents, semantic, service } = createService(db, provider);
    const vacation = saveDocument(documents, 'vacaciones', 'Política de vacaciones y descanso anual. '.repeat(12));
    const budget = saveDocument(documents, 'presupuesto', 'Presupuesto anual y control financiero. '.repeat(12));
    await service.indexDocument(vacation.id);
    await service.indexDocument(budget.id);

    assert.equal(semantic.countEmbeddings(vacation.id), semantic.countChunks(vacation.id));
    const hits = await service.search('¿cómo funcionan las vacaciones?', 5);
    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.documentId, vacation.id);
    assert.equal(hits[0]?.score, 1);
  } finally { db.close(); }
});

test('failed reindex preserves the previous complete semantic index and does not audit upstream text', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const goodProvider = new FakeEmbeddingProvider();
    const base = createService(db, goodProvider);
    const stored = saveDocument(base.documents, 'stable-index', 'vacaciones '.repeat(80));
    await base.service.indexDocument(stored.id);
    const beforeChunks = base.semantic.listChunks(stored.id).map((row) => row.textHash);
    const beforeEmbeddings = base.semantic.countEmbeddings(stored.id);

    const failing = new FailingEmbeddingProvider();
    const failedService = new DocumentSemanticService(base.documents, base.semantic, base.audit, failing, {
      enabled: true,
      maxChars: 240,
      overlapChars: 40,
      maxChunks: 20,
      embeddingBatchSize: 2,
    });
    await assert.rejects(() => failedService.indexDocument(stored.id));
    assert.deepEqual(base.semantic.listChunks(stored.id).map((row) => row.textHash), beforeChunks);
    assert.equal(base.semantic.countEmbeddings(stored.id), beforeEmbeddings);
    assert.ok(!JSON.stringify(base.audit.listRecent(20)).includes('private upstream body'));
  } finally { db.close(); }
});

test('document deletion cascades through semantic chunks and embeddings', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const provider = new FakeEmbeddingProvider();
    const { documents, semantic, service } = createService(db, provider);
    const stored = saveDocument(documents, 'cascade', 'vacaciones '.repeat(80));
    await service.indexDocument(stored.id);
    assert.ok(semantic.countChunks(stored.id) > 0);
    assert.ok(semantic.countEmbeddings(stored.id) > 0);
    assert.equal(documents.delete(stored.id).deleted, true);
    assert.equal(semantic.countChunks(stored.id), 0);
    assert.equal(semantic.countEmbeddings(stored.id), 0);
  } finally { db.close(); }
});

test('semantic capability is explicit, bounded and never audits query content', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const provider = new FakeEmbeddingProvider();
    const { documents, semantic, audit, service } = createService(db, provider);
    const stored = saveDocument(documents, 'capability', 'vacaciones '.repeat(80));
    await service.indexDocument(stored.id);
    const capability = new SemanticDocumentCapability(documents, service, audit);

    assert.equal(await capability.handle(message('hola')), undefined);
    const status = await capability.handle(message('semántica status'));
    assert.match(status?.reply ?? '', /habilitado/i);

    const query = 'SECRET_QUERY_VACACIONES_991';
    const searched = await capability.handle(message(`busca semántica documentos ${query} vacaciones`));
    assert.match(searched?.reply ?? '', /Documento #/);
    const auditJson = JSON.stringify(audit.listRecent(30).map((row) => row.metadata));
    assert.ok(!auditJson.includes(query));
  } finally { db.close(); }
});
