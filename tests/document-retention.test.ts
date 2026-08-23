import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { DocumentRetentionScheduler } from '../src/scheduler/document-retention-scheduler.ts';

function save(documents: DocumentRepository, suffix: string, text: string) {
  return documents.save({
    messageId: `retention-${suffix}`,
    receivedAt: 1_777_000_000,
    fileName: `${suffix}.pdf`,
    mimeType: 'application/pdf',
    sha256: suffix.padEnd(64, 'b').slice(0, 64).replace(/[^a-f0-9]/g, 'b'),
    byteLength: 100,
    pageCount: 1,
    text,
    truncated: false,
  });
}

test('document retention is opt-in with 90 day default and bounded configuration', () => {
  const defaults = loadConfig({});
  assert.equal(defaults.documents.retention.enabled, false);
  assert.equal(defaults.documents.retention.days, 90);

  const enabled = loadConfig({ DOCUMENT_RETENTION_ENABLED: 'true', DOCUMENT_RETENTION_DAYS: '30' });
  assert.equal(enabled.documents.retention.enabled, true);
  assert.equal(enabled.documents.retention.days, 30);
  assert.throws(() => loadConfig({ DOCUMENT_RETENTION_DAYS: '0' }), /DOCUMENT_RETENTION_DAYS/);
  assert.throws(() => loadConfig({ DOCUMENT_RETENTION_DAYS: '3651' }), /DOCUMENT_RETENTION_DAYS/);
});

test('database enables SQLite secure_delete', () => {
  const db = new AppDatabase(':memory:');
  const row = db.native.prepare('PRAGMA secure_delete').get() as { secure_delete: number } | undefined;
  assert.equal(Number(row?.secure_delete), 1);
  db.close();
});

test('repository retention deletes only older documents and their FTS rows', () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const memory = new LocalMemorySearchRepository(db);
  const oldDoc = save(documents, 'old', 'TOKEN_OLD_RETENTION');
  const newDoc = save(documents, 'new', 'TOKEN_NEW_RETENTION');
  db.native.prepare('UPDATE documents SET created_at=? WHERE id=?').run('2026-01-01 00:00:00', oldDoc.id);
  db.native.prepare('UPDATE documents SET created_at=? WHERE id=?').run('2026-08-20 00:00:00', newDoc.id);

  const result = documents.purgeCreatedBefore('2026-07-01T00:00:00.000Z');
  assert.equal(result.deleted, 1);
  assert.equal(typeof result.walCheckpointed, 'boolean');
  assert.equal(documents.get(oldDoc.id), undefined);
  assert.ok(documents.get(newDoc.id));
  assert.equal(memory.search('TOKEN_OLD_RETENTION', { source: 'document' }).length, 0);
  assert.equal(memory.search('TOKEN_NEW_RETENTION', { source: 'document' }).length, 1);
  db.close();
});

test('document retention scheduler purges by indexing age and audits counts only', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const audit = new AuditRepository(db);
  const oldDoc = save(documents, 'old2', 'VERY_PRIVATE_RETENTION_TOKEN');
  const currentDoc = save(documents, 'current2', 'CURRENT_DOCUMENT_TOKEN');
  db.native.prepare('UPDATE documents SET created_at=? WHERE id=?').run('2026-01-01 00:00:00', oldDoc.id);
  db.native.prepare('UPDATE documents SET created_at=? WHERE id=?').run('2026-08-22 00:00:00', currentDoc.id);

  const scheduler = new DocumentRetentionScheduler(documents, audit, 30, () => new Date('2026-08-23T19:00:00.000Z'));
  const result = await scheduler.runOnce();
  assert.equal(result?.deleted, 1);
  assert.equal(documents.get(oldDoc.id), undefined);
  assert.ok(documents.get(currentDoc.id));

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /document\.retention\.purged/);
  assert.match(auditJson, /"deleted":1/);
  assert.doesNotMatch(auditJson, /VERY_PRIVATE_RETENTION_TOKEN|CURRENT_DOCUMENT_TOKEN|old2\.pdf|current2\.pdf/);
  db.close();
});
