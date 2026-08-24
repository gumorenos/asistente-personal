import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { DocumentSemanticRepository } from '../src/database/document-semantic-repository.ts';
import { createDatabaseBackup, verifyDatabaseBackup } from '../src/ops/backup-service.ts';
import { runDoctor } from '../src/ops/doctor.ts';

function withTempDir<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-ops-'));
  try { return run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

async function withTempDirAsync<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-ops-'));
  try { return await run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function seedDatabase(path: string): { documentId: number } {
  const db = new AppDatabase(path);
  try {
    const documents = new DocumentRepository(db);
    const semantic = new DocumentSemanticRepository(db);
    const stored = documents.save({
      messageId: 'backup-doc',
      receivedAt: 1_777_000_000,
      fileName: 'backup.pdf',
      mimeType: 'application/pdf',
      sha256: 'b'.repeat(64),
      byteLength: 500,
      pageCount: 1,
      text: 'Documento sintético para validar backup y memoria semántica.',
      truncated: false,
    });
    semantic.replaceDocumentIndex(stored.id, [{
      chunkIndex: 0,
      charStart: 0,
      charEnd: 61,
      text: 'Documento sintético para validar backup y memoria semántica.',
      textHash: 'c'.repeat(64),
    }]);
    return { documentId: stored.id };
  } finally { db.close(); }
}

test('backup service creates a coherent read-only-verifiable SQLite copy including semantic tables', async () => {
  await withTempDirAsync(async (directory) => {
    const source = join(directory, 'source.db');
    const destination = join(directory, 'backup.db');
    seedDatabase(source);

    const report = await createDatabaseBackup(source, destination);
    assert.equal(report.quickCheck, 'ok');
    assert.equal(report.foreignKeyViolations, 0);
    assert.equal(report.maxMigration, 15);
    assert.equal(report.documentCount, 1);
    assert.equal(report.semanticChunkCount, 1);
    assert.equal(report.semanticEmbeddingCount, 0);
    assert.ok(report.bytes > 0);
    assert.equal(statSync(destination).mode & 0o777, 0o600);

    const verified = verifyDatabaseBackup(destination);
    assert.deepEqual(verified, report);
  });
});

test('backup is an independent snapshot and source mutations do not alter it', async () => {
  await withTempDirAsync(async (directory) => {
    const source = join(directory, 'source.db');
    const destination = join(directory, 'backup.db');
    const { documentId } = seedDatabase(source);
    await createDatabaseBackup(source, destination);

    const sourceDb = new AppDatabase(source);
    try { assert.equal(new DocumentRepository(sourceDb).delete(documentId).deleted, true); }
    finally { sourceDb.close(); }

    const verified = verifyDatabaseBackup(destination);
    assert.equal(verified.documentCount, 1);
    assert.equal(verified.semanticChunkCount, 1);
  });
});

test('doctor inspects an existing database without applying writes or requiring optional tools when disabled', () => {
  withTempDir((directory) => {
    const source = join(directory, 'doctor.db');
    seedDatabase(source);
    const beforeSize = statSync(source).size;
    const report = runDoctor({ APP_DB_PATH: source });
    const afterSize = statSync(source).size;

    assert.equal(report.ok, true);
    assert.equal(beforeSize, afterSize);
    assert.equal(report.checks.find((check) => check.name === 'database.migrations')?.detail, 'schema v15');
    assert.equal(report.checks.find((check) => check.name === 'database.fts5')?.status, 'pass');
    assert.equal(report.checks.find((check) => check.name === 'tools.poppler')?.status, 'pass');
    assert.equal(report.checks.find((check) => check.name === 'feature.embeddings')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_read')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_write')?.detail, 'disabled');
  });
});

test('doctor validates and reports Calendar read configuration without network I/O', () => {
  withTempDir((directory) => {
    const source = join(directory, 'doctor-calendar-read.db');
    seedDatabase(source);
    const report = runDoctor({
      APP_DB_PATH: source,
      CALENDAR_READ_ENABLED: 'true',
      CALENDAR_READ_DAY_START: '09:00',
      CALENDAR_READ_DAY_END: '18:30',
      GOOGLE_CALENDAR_CLIENT_ID: 'doctor-client',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'doctor-secret',
      GOOGLE_CALENDAR_REFRESH_TOKEN: 'doctor-refresh',
    });

    assert.equal(report.ok, true);
    assert.equal(
      report.checks.find((check) => check.name === 'feature.calendar_read')?.detail,
      'enabled (09:00-18:30; connectivity not tested)',
    );
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_write')?.detail, 'disabled');
  });
});

test('doctor fails closed on invalid configuration or missing database', () => {
  const badConfig = runDoctor({ SEMANTIC_ENABLED: 'true' });
  assert.equal(badConfig.ok, false);
  assert.equal(badConfig.checks[0]?.name, 'config');

  const badCalendarRead = runDoctor({ CALENDAR_READ_ENABLED: 'true' });
  assert.equal(badCalendarRead.ok, false);
  assert.equal(badCalendarRead.checks[0]?.name, 'config');

  const missing = runDoctor({ APP_DB_PATH: '/tmp/assistant-definitely-missing-doctor.db' });
  assert.equal(missing.ok, false);
  assert.equal(missing.checks.some((check) => check.name === 'database' && check.status === 'fail'), true);
});
