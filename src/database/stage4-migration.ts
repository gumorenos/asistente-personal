import type { DatabaseSync } from 'node:sqlite';

const VERSION = 14;

const SQL = `
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE CHECK (length(message_id) BETWEEN 1 AND 512),
    received_at INTEGER NOT NULL CHECK (received_at >= 0),
    file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 128),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    page_count INTEGER NOT NULL CHECK (page_count > 0),
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200000),
    truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_documents_received_at ON documents(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);

  INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
  SELECT 'document', CAST(id AS TEXT), received_at, file_name || ' ' || text
  FROM documents;

  CREATE TRIGGER IF NOT EXISTS trg_documents_memory_ai
  AFTER INSERT ON documents
  BEGIN
    INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
    VALUES ('document', CAST(NEW.id AS TEXT), NEW.received_at, NEW.file_name || ' ' || NEW.text);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_documents_memory_ad
  AFTER DELETE ON documents
  BEGIN
    DELETE FROM self_memory_fts
    WHERE source = 'document' AND source_id = CAST(OLD.id AS TEXT);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_documents_memory_au
  AFTER UPDATE OF file_name, text, received_at ON documents
  BEGIN
    DELETE FROM self_memory_fts
    WHERE source = 'document' AND source_id = CAST(OLD.id AS TEXT);
    INSERT INTO self_memory_fts(source, source_id, occurred_at, text)
    VALUES ('document', CAST(NEW.id AS TEXT), NEW.received_at, NEW.file_name || ' ' || NEW.text);
  END;
`;

export function runStage4Migration(db: DatabaseSync): void {
  const applied = db.prepare('SELECT 1 AS found FROM schema_migrations WHERE version = ?').get(VERSION) as { found: number } | undefined;
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
