import type { DatabaseSync } from 'node:sqlite';

const VERSION = 16;

const SQL = `
  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_commitments_status_due
    ON commitments(status, due_at, id DESC);

  INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
  SELECT
    'commitment',
    CAST(id AS TEXT),
    CAST(strftime('%s', COALESCE(due_at, created_at)) AS INTEGER),
    body
  FROM commitments
  WHERE length(trim(body)) > 0;

  CREATE TRIGGER IF NOT EXISTS trg_commitments_memory_ai
  AFTER INSERT ON commitments
  WHEN length(trim(NEW.body)) > 0
  BEGIN
    INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
    VALUES (
      'commitment',
      CAST(NEW.id AS TEXT),
      CAST(strftime('%s', COALESCE(NEW.due_at, NEW.created_at)) AS INTEGER),
      NEW.body
    );
  END;

  CREATE TRIGGER IF NOT EXISTS trg_commitments_memory_ad
  AFTER DELETE ON commitments
  BEGIN
    DELETE FROM self_memory_fts
    WHERE source = 'commitment' AND source_id = CAST(OLD.id AS TEXT);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_commitments_memory_au
  AFTER UPDATE OF body, due_at ON commitments
  BEGIN
    DELETE FROM self_memory_fts
    WHERE source = 'commitment' AND source_id = CAST(OLD.id AS TEXT);
    INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
    SELECT
      'commitment',
      CAST(NEW.id AS TEXT),
      CAST(strftime('%s', COALESCE(NEW.due_at, NEW.created_at)) AS INTEGER),
      NEW.body
    WHERE length(trim(NEW.body)) > 0;
  END;
`;

export function runStage6Migration(db: DatabaseSync): void {
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
