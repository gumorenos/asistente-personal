import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export interface BackupVerification {
  path: string;
  quickCheck: string;
  foreignKeyViolations: number;
  maxMigration: number;
  documentCount: number;
  semanticChunkCount: number;
  semanticEmbeddingCount: number;
  commitmentCount: number;
  bytes: number;
}

function scalarNumber(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, number | bigint> | undefined;
  if (!row) return 0;
  return Number(Object.values(row)[0] ?? 0);
}

export async function createDatabaseBackup(sourcePath: string, destinationPath: string): Promise<BackupVerification> {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error('Backup destination must differ from source database');

  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5_000 });
  try {
    await backup(sourceDb, destination, { rate: 100 });
  } finally {
    sourceDb.close();
  }
  try { chmodSync(destination, 0o600); } catch { /* deployment filesystem may not support chmod */ }
  return verifyDatabaseBackup(destination);
}

export function verifyDatabaseBackup(path: string): BackupVerification {
  const resolved = resolve(path);
  const db = new DatabaseSync(resolved, { readOnly: true, timeout: 5_000 });
  try {
    const quickRow = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    const quickCheck = quickRow?.quick_check ?? 'unknown';
    const foreignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    const maxMigration = scalarNumber(db, 'SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations');
    const documentCount = scalarNumber(db, 'SELECT COUNT(*) AS value FROM documents');
    const semanticChunkCount = scalarNumber(db, 'SELECT COUNT(*) AS value FROM document_chunks');
    const semanticEmbeddingCount = scalarNumber(db, 'SELECT COUNT(*) AS value FROM document_embeddings');
    const commitmentCount = scalarNumber(db, 'SELECT COUNT(*) AS value FROM commitments');
    // Force real FTS reads so a backup with broken virtual-table state is rejected.
    db.prepare('SELECT COUNT(*) AS value FROM self_memory_fts').get();
    db.prepare('SELECT COUNT(*) AS value FROM observation_fts').get();

    if (quickCheck !== 'ok') throw new Error(`Backup quick_check failed: ${quickCheck}`);
    if (foreignKeyViolations !== 0) throw new Error(`Backup foreign_key_check found ${foreignKeyViolations} violation(s)`);
    if (maxMigration < 16) throw new Error(`Backup schema is too old: migration ${maxMigration}`);

    return {
      path: resolved,
      quickCheck,
      foreignKeyViolations,
      maxMigration,
      documentCount,
      semanticChunkCount,
      semanticEmbeddingCount,
      commitmentCount,
      bytes: statSync(resolved).size,
    };
  } finally {
    db.close();
  }
}
