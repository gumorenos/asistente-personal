import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { DocumentSemanticRepository } from '../src/database/document-semantic-repository.ts';
import { createDatabaseBackup, verifyDatabaseBackup } from '../src/ops/backup-service.ts';
import { runDoctor } from '../src/ops/doctor.ts';

const SELF_JID = '51999999999@s.whatsapp.net';

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

function seedDatabase(path: string): { documentId: number; commitmentId: number } {
  const db = new AppDatabase(path);
  try {
    const documents = new DocumentRepository(db);
    const semantic = new DocumentSemanticRepository(db);
    const commitments = new CommitmentRepository(db);
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
    const commitmentId = commitments.create({
      body: 'Compromiso sintético para backup',
      dueAt: '2026-08-24T14:00:00.000Z',
    });
    assert.equal(commitments.markNotified(commitmentId, '2026-08-24T15:00:00.000Z'), true);
    return { documentId: stored.id, commitmentId };
  } finally { db.close(); }
}

test('backup service creates a coherent read-only-verifiable SQLite copy including semantic and commitment notification state', async () => {
  await withTempDirAsync(async (directory) => {
    const source = join(directory, 'source.db');
    const destination = join(directory, 'backup.db');
    seedDatabase(source);

    const report = await createDatabaseBackup(source, destination);
    assert.equal(report.quickCheck, 'ok');
    assert.equal(report.foreignKeyViolations, 0);
    assert.equal(report.maxMigration, 17);
    assert.equal(report.documentCount, 1);
    assert.equal(report.semanticChunkCount, 1);
    assert.equal(report.semanticEmbeddingCount, 0);
    assert.equal(report.commitmentCount, 1);
    assert.equal(report.commitmentNotifiedCount, 1);
    assert.ok(report.bytes > 0);
    assert.equal(statSync(destination).mode & 0o777, 0o600);

    const verified = verifyDatabaseBackup(destination);
    assert.deepEqual(verified, report);
  });
});

test('backup is an independent snapshot and source mutations do not alter notification state', async () => {
  await withTempDirAsync(async (directory) => {
    const source = join(directory, 'source.db');
    const destination = join(directory, 'backup.db');
    const { documentId, commitmentId } = seedDatabase(source);
    await createDatabaseBackup(source, destination);

    const sourceDb = new AppDatabase(source);
    try {
      assert.equal(new DocumentRepository(sourceDb).delete(documentId).deleted, true);
      assert.equal(new CommitmentRepository(sourceDb).setStatus(commitmentId, 'completed'), true);
    } finally { sourceDb.close(); }

    const verified = verifyDatabaseBackup(destination);
    assert.equal(verified.documentCount, 1);
    assert.equal(verified.semanticChunkCount, 1);
    assert.equal(verified.commitmentCount, 1);
    assert.equal(verified.commitmentNotifiedCount, 1);
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
    assert.equal(report.checks.find((check) => check.name === 'database.migrations')?.detail, 'schema v17');
    assert.equal(report.checks.find((check) => check.name === 'database.fts5')?.status, 'pass');
    assert.equal(report.checks.find((check) => check.name === 'local.commitments')?.detail, '1 commitment row(s)');
    assert.equal(report.checks.find((check) => check.name === 'local.commitment_notifications')?.detail, '1 notified commitment row(s)');
    assert.equal(report.checks.find((check) => check.name === 'tools.poppler')?.status, 'pass');
    assert.equal(report.checks.find((check) => check.name === 'feature.embeddings')?.detail, 'disabled');
    assert.equal(
      report.checks.find((check) => check.name === 'feature.commitments')?.detail,
      'local explicit capture enabled; automatic detection disabled',
    );
    assert.equal(report.checks.find((check) => check.name === 'feature.commitment_notifications')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_read')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_slots')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_exact_availability')?.detail, 'disabled');
    assert.equal(report.checks.find((check) => check.name === 'feature.calendar_write')?.detail, 'disabled');
  });
});

test('doctor validates and reports commitment notifications without network I/O', () => {
  withTempDir((directory) => {
    const source = join(directory, 'doctor-commitments.db');
    seedDatabase(source);
    const report = runDoctor({
      APP_DB_PATH: source,
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_SELF_JIDS: SELF_JID,
      COMMITMENT_NOTIFICATIONS_ENABLED: 'true',
      COMMITMENT_NOTIFICATION_DESTINATION_JID: SELF_JID,
    });

    assert.equal(report.ok, true);
    assert.equal(
      report.checks.find((check) => check.name === 'feature.commitment_notifications')?.detail,
      'enabled (allowlisted self destination; WhatsApp delivery not tested)',
    );
  });
});

test('doctor validates and reports Calendar read + slot + exact availability configuration without network I/O', () => {
  withTempDir((directory) => {
    const source = join(directory, 'doctor-calendar-read.db');
    seedDatabase(source);
    const report = runDoctor({
      APP_DB_PATH: source,
      CALENDAR_READ_ENABLED: 'true',
      CALENDAR_READ_DAY_START: '09:00',
      CALENDAR_READ_DAY_END: '18:30',
      CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true',
      CALENDAR_SLOT_MAX_SUGGESTIONS: '4',
      CALENDAR_SLOT_ALIGNMENT_MINUTES: '15',
      CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true',
      GOOGLE_CALENDAR_CLIENT_ID: 'doctor-client',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'doctor-secret',
      GOOGLE_CALENDAR_REFRESH_TOKEN: 'doctor-refresh',
    });

    assert.equal(report.ok, true);
    assert.equal(
      report.checks.find((check) => check.name === 'feature.calendar_read')?.detail,
      'enabled (09:00-18:30; connectivity not tested)',
    );
    assert.equal(
      report.checks.find((check) => check.name === 'feature.calendar_slots')?.detail,
      'enabled (4 max; 15 min alignment)',
    );
    assert.equal(
      report.checks.find((check) => check.name === 'feature.calendar_exact_availability')?.detail,
      'enabled (exact interval only; connectivity not tested)',
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

  const badSlots = runDoctor({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
  assert.equal(badSlots.ok, false);
  assert.equal(badSlots.checks[0]?.name, 'config');

  const badExact = runDoctor({ CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' });
  assert.equal(badExact.ok, false);
  assert.equal(badExact.checks[0]?.name, 'config');

  const badCommitmentNotifications = runDoctor({ COMMITMENT_NOTIFICATIONS_ENABLED: 'true' });
  assert.equal(badCommitmentNotifications.ok, false);
  assert.equal(badCommitmentNotifications.checks[0]?.name, 'config');

  const missing = runDoctor({ APP_DB_PATH: '/tmp/assistant-definitely-missing-doctor.db' });
  assert.equal(missing.ok, false);
  assert.equal(missing.checks.some((check) => check.name === 'database' && check.status === 'fail'), true);
});