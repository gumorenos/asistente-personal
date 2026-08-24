import type { DatabaseSync } from 'node:sqlite';

const VERSION = 15;

const SQL = `
  CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    char_start INTEGER NOT NULL CHECK (char_start >= 0),
    char_end INTEGER NOT NULL CHECK (char_end > char_start),
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
    text_hash TEXT NOT NULL CHECK (length(text_hash) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, chunk_index)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_document_chunks_document
  ON document_chunks(document_id, chunk_index);

  CREATE TABLE IF NOT EXISTS document_embeddings (
    chunk_id INTEGER PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 255),
    dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 1 AND 8192),
    vector BLOB NOT NULL,
    text_hash TEXT NOT NULL CHECK (length(text_hash) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_document_embeddings_model
  ON document_embeddings(provider, model);
`;

export function runStage4dMigration(db: DatabaseSync): void {
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
