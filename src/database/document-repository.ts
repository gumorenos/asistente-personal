import type { AppDatabase } from './db.ts';

export interface StoredDocument {
  id: number;
  messageId: string;
  receivedAt: number;
  fileName: string;
  mimeType: string;
  sha256: string;
  byteLength: number;
  pageCount: number;
  text: string;
  truncated: boolean;
  createdAt: string;
}

export interface SaveDocumentInput {
  messageId: string;
  receivedAt: number;
  fileName: string;
  mimeType: string;
  sha256: string;
  byteLength: number;
  pageCount: number;
  text: string;
  truncated: boolean;
}

export interface DocumentDeleteResult {
  deleted: boolean;
  walCheckpointed: boolean;
}

export interface DocumentPurgeResult {
  deleted: number;
  walCheckpointed: boolean;
}

function bounded(value: string, max: number, name: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error(`Invalid ${name}`);
  return trimmed;
}

export class DocumentRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  save(input: SaveDocumentInput): StoredDocument {
    const messageId = bounded(input.messageId, 512, 'document message id');
    const fileName = bounded(input.fileName, 255, 'document file name');
    const mimeType = bounded(input.mimeType, 128, 'document mime type');
    const sha256 = input.sha256.trim().toLowerCase();
    const text = input.text.trim();

    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid document SHA-256');
    if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) throw new Error('Invalid document timestamp');
    if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1) throw new Error('Invalid document byte length');
    if (!Number.isInteger(input.pageCount) || input.pageCount < 1) throw new Error('Invalid document page count');
    if (!text || text.length > 200_000) throw new Error('Invalid document text');

    this.database.native.prepare(`
      INSERT INTO documents(
        message_id, received_at, file_name, mime_type, sha256, byte_length,
        page_count, text, truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING
    `).run(
      messageId,
      input.receivedAt,
      fileName,
      mimeType,
      sha256,
      input.byteLength,
      input.pageCount,
      text,
      input.truncated ? 1 : 0,
    );

    const row = this.database.native.prepare(`
      SELECT id, message_id, received_at, file_name, mime_type, sha256, byte_length,
             page_count, text, truncated, created_at
      FROM documents WHERE message_id = ?
    `).get(messageId) as DocumentRow | undefined;
    if (!row) throw new Error('Document persistence failed');
    return mapRow(row);
  }

  get(id: number): StoredDocument | undefined {
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    const row = this.database.native.prepare(`
      SELECT id, message_id, received_at, file_name, mime_type, sha256, byte_length,
             page_count, text, truncated, created_at
      FROM documents WHERE id = ?
    `).get(id) as DocumentRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listRecent(limit = 10): StoredDocument[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid document list limit');
    const rows = this.database.native.prepare(`
      SELECT id, message_id, received_at, file_name, mime_type, sha256, byte_length,
             page_count, text, truncated, created_at
      FROM documents ORDER BY id DESC LIMIT ?
    `).all(limit) as unknown as DocumentRow[];
    return rows.map(mapRow);
  }

  delete(id: number): DocumentDeleteResult {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid document id');
    const result = this.database.native.prepare('DELETE FROM documents WHERE id = ?').run(id);
    const deleted = result.changes === 1;
    return {
      deleted,
      walCheckpointed: deleted ? this.checkpointWal() : true,
    };
  }

  purgeCreatedBefore(cutoffIso: string): DocumentPurgeResult {
    if (!Number.isFinite(new Date(cutoffIso).getTime())) throw new Error('Invalid document retention cutoff');
    const result = this.database.native.prepare(`
      DELETE FROM documents
      WHERE datetime(created_at) < datetime(?)
    `).run(cutoffIso);
    const deleted = Number(result.changes);
    return {
      deleted,
      walCheckpointed: deleted > 0 ? this.checkpointWal() : true,
    };
  }

  private checkpointWal(): boolean {
    try {
      const row = this.database.native.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        | { busy?: number | bigint }
        | undefined;
      return Number(row?.busy ?? 1) === 0;
    } catch {
      // Logical deletion has already committed. WAL truncation is privacy hardening,
      // not a reason to resurrect domain data or report the delete as failed.
      return false;
    }
  }
}

interface DocumentRow {
  id: number | bigint;
  message_id: string;
  received_at: number | bigint;
  file_name: string;
  mime_type: string;
  sha256: string;
  byte_length: number | bigint;
  page_count: number | bigint;
  text: string;
  truncated: number | bigint;
  created_at: string;
}

function mapRow(row: DocumentRow): StoredDocument {
  return {
    id: Number(row.id),
    messageId: row.message_id,
    receivedAt: Number(row.received_at),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    pageCount: Number(row.page_count),
    text: row.text,
    truncated: Number(row.truncated) === 1,
    createdAt: row.created_at,
  };
}
