import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';

function saveFixture(documents: DocumentRepository, messageId: string, text: string) {
  return documents.save({
    messageId,
    receivedAt: 1_777_000_000,
    fileName: `${messageId}.pdf`,
    mimeType: 'application/pdf',
    sha256: 'c'.repeat(64),
    byteLength: 321,
    pageCount: 1,
    text,
    truncated: false,
  });
}

function filesContain(directory: string, token: string): boolean {
  for (const name of ['assistant.db', 'assistant.db-wal', 'assistant.db-shm']) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    if (readFileSync(path).includes(Buffer.from(token, 'utf8'))) return true;
  }
  return false;
}

test('file-backed delete removes row, FTS and plain token from active SQLite files after checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-stage4c-delete-'));
  try {
    const dbPath = join(directory, 'assistant.db');
    const db = new AppDatabase(dbPath);
    const documents = new DocumentRepository(db);
    const memory = new LocalMemorySearchRepository(db);
    const token = 'STAGE4C_FILE_BACKED_DELETE_TOKEN_8264';
    const stored = saveFixture(documents, 'file-backed-delete', `${token} contenido sintetico privado`);

    db.native.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    assert.equal(filesContain(directory, token), true, 'fixture token should be observable before deletion');
    assert.equal(memory.search(token, { source: 'document' }).length, 1);

    const result = documents.delete(stored.id);
    assert.equal(result.deleted, true);
    assert.equal(result.walCheckpointed, true);
    assert.equal(documents.get(stored.id), undefined);
    assert.equal(memory.search(token, { source: 'document' }).length, 0);

    db.close();
    assert.equal(filesContain(directory, token), false, 'deleted token should not remain in active DB/WAL/SHM after secure_delete + checkpoint');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('pre-delete backup retains document by design while post-delete backup does not', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-stage4c-backup-'));
  try {
    const dbPath = join(directory, 'assistant.db');
    const prePath = join(directory, 'pre-delete.db');
    const postPath = join(directory, 'post-delete.db');
    const db = new AppDatabase(dbPath);
    const documents = new DocumentRepository(db);
    const token = 'STAGE4C_BACKUP_POLICY_TOKEN_8264';
    const stored = saveFixture(documents, 'backup-policy', `${token} documento sintetico`);

    db.native.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    copyFileSync(dbPath, prePath);

    const deletion = documents.delete(stored.id);
    assert.equal(deletion.deleted, true);
    assert.equal(deletion.walCheckpointed, true);
    copyFileSync(dbPath, postPath);
    db.close();

    const pre = new AppDatabase(prePath);
    assert.equal(new DocumentRepository(pre).get(stored.id)?.text.includes(token), true);
    assert.equal(new LocalMemorySearchRepository(pre).search(token, { source: 'document' }).length, 1);
    pre.close();

    const post = new AppDatabase(postPath);
    assert.equal(new DocumentRepository(post).get(stored.id), undefined);
    assert.equal(new LocalMemorySearchRepository(post).search(token, { source: 'document' }).length, 0);
    post.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
