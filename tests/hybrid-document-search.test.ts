import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticDocumentCapability } from '../src/capabilities/semantic-document-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { DocumentSemanticRepository } from '../src/database/document-semantic-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { DocumentSemanticService } from '../src/semantic/document-semantic-service.ts';
import { HybridDocumentSearchService } from '../src/semantic/hybrid-document-search-service.ts';
import type { EmbeddingProvider } from '../src/semantic/types.ts';

class HybridFakeProvider implements EmbeddingProvider {
  readonly name = 'hybrid-fake';
  readonly model = 'hybrid-v1';
  readonly dimensions = 2;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => /vacaciones|descanso|tiempo libre/i.test(text) ? [1, 0] : [0, 1]);
  }
}

function save(documents: DocumentRepository, id: string, text: string) {
  return documents.save({
    messageId: id,
    receivedAt: 1_777_100_000,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sha256: 'd'.repeat(64),
    byteLength: 500,
    pageCount: 1,
    text,
    truncated: false,
  });
}

function incoming(text: string): IncomingMessage {
  return {
    id: 'hybrid-command', chatId: '51999999999@s.whatsapp.net', timestamp: 1_777_100_001,
    text, kind: 'text', fromMe: true, isGroup: false,
  };
}

test('hybrid retrieval rewards a document supported by both lexical and semantic signals', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const documents = new DocumentRepository(db);
    const semanticRepository = new DocumentSemanticRepository(db);
    const audit = new AuditRepository(db);
    const semantic = new DocumentSemanticService(documents, semanticRepository, audit, new HybridFakeProvider(), {
      enabled: true, maxChars: 240, overlapChars: 40, maxChunks: 20, embeddingBatchSize: 10,
    });
    const lexical = new LocalMemorySearchRepository(db);
    const hybrid = new HybridDocumentSearchService(lexical, semantic);

    const both = save(documents, 'both', 'La política de vacaciones regula el descanso anual del trabajador. '.repeat(8));
    const semanticOnly = save(documents, 'semantic-only', 'Tiempo libre y pausas prolongadas para recuperación personal. '.repeat(8));
    const unrelated = save(documents, 'unrelated', 'Presupuesto financiero y centros de costo. '.repeat(8));
    await semantic.indexDocument(both.id);
    await semantic.indexDocument(semanticOnly.id);
    await semantic.indexDocument(unrelated.id);

    const hits = await hybrid.search('vacaciones descanso', 3);
    assert.equal(hits[0]?.documentId, both.id);
    assert.ok(hits[0]?.lexicalRank);
    assert.ok(hits[0]?.semanticRank);
    assert.ok(hits.some((hit) => hit.documentId === semanticOnly.id && hit.semanticRank));
  } finally { db.close(); }
});

test('hybrid capability is explicit and audit stores query length but not query text', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const documents = new DocumentRepository(db);
    const semanticRepository = new DocumentSemanticRepository(db);
    const audit = new AuditRepository(db);
    const semantic = new DocumentSemanticService(documents, semanticRepository, audit, new HybridFakeProvider(), {
      enabled: true, maxChars: 240, overlapChars: 40, maxChunks: 20, embeddingBatchSize: 10,
    });
    const lexical = new LocalMemorySearchRepository(db);
    const hybrid = new HybridDocumentSearchService(lexical, semantic);
    const document = save(documents, 'hybrid-cap', 'Vacaciones y descanso anual según política interna. '.repeat(8));
    await semantic.indexDocument(document.id);
    const capability = new SemanticDocumentCapability(documents, semantic, audit, hybrid);
    const secret = 'HYBRID_PRIVATE_QUERY_2026';
    const result = await capability.handle(incoming(`busca híbrida documentos ${secret} vacaciones`));
    assert.match(result?.reply ?? '', /Búsqueda híbrida/);
    assert.match(result?.reply ?? '', new RegExp(`Documento #${document.id}`));
    const metadata = JSON.stringify(audit.listRecent(20).map((row) => row.metadata));
    assert.ok(!metadata.includes(secret));
  } finally { db.close(); }
});

test('hybrid command fails closed without embeddings instead of silently exporting or degrading', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const documents = new DocumentRepository(db);
    const semanticRepository = new DocumentSemanticRepository(db);
    const audit = new AuditRepository(db);
    const semantic = new DocumentSemanticService(documents, semanticRepository, audit, undefined, {
      enabled: true, maxChars: 240, overlapChars: 40, maxChunks: 20, embeddingBatchSize: 10,
    });
    const hybrid = new HybridDocumentSearchService(new LocalMemorySearchRepository(db), semantic);
    const capability = new SemanticDocumentCapability(documents, semantic, audit, hybrid);
    const result = await capability.handle(incoming('busca híbrida documentos vacaciones'));
    assert.match(result?.reply ?? '', /requiere.*embeddings/i);
  } finally { db.close(); }
});
