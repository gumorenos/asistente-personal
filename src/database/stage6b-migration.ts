import type { DatabaseSync } from 'node:sqlite';

const VERSION = 17;

const SQL = `
  ALTER TABLE commitments ADD COLUMN notified_at TEXT;

  CREATE INDEX IF NOT EXISTS idx_commitments_due_notification
    ON commitments(status, due_at, notified_at, id)
    WHERE status = 'open' AND due_at IS NOT NULL AND notified_at IS NULL;
`;

export function runStage6bMigration(db: DatabaseSync): void {
  const applied = db.prepare('SELECT 1 AS found FROM schema_migrations WHERE version = ?').get(VERSION) as
    | { found: number }
    | undefined;
  if (applied?.found === 1) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SQL);
    db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(VERSION);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
