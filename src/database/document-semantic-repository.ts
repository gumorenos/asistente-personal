import type { AppDatabase } from './db.ts';
import type { DocumentChunk, SemanticDocumentHit } from '../semantic/types.ts';

interface StoredChunkRow {
  id: number | bigint;
  document_id: number | bigint;
  chunk_index: number | bigint;
  char_start: number | bigint;
  char_end: number | bigint;
  text: string;
  text_hash: string;
}

interface EmbeddingRow extends StoredChunkRow {
  provider: string;
  model: string;
  dimensions: number | bigint;
  vector: Uint8Array;
}

function encodeVector(values: number[], dimensions: number): Uint8Array {
  if (values.length !== dimensions) throw new Error('Embedding dimension mismatch');
  const bytes = new Uint8Array(dimensions * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) throw new Error('Embedding contains non-finite value');
    view.setFloat32(index * 4, value, true);
  });
  return bytes;
}

function decodeVector(bytes: Uint8Array, dimensions: number): number[] {
  if (bytes.byteLength !== dimensions * 4) throw new Error('Stored embedding byte length mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: dimensions }, (_, index) => view.getFloat32(index * 4, true));
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class DocumentSemanticRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  replaceDocumentIndex(
    documentId: number,
    chunks: DocumentChunk[],
    embeddings?: { provider: string; model: string; dimensions: number; vectors: number[][] },
  ): void {
    if (!Number.isSafeInteger(documentId) || documentId < 1) throw new Error('Invalid semantic document id');
    if (chunks.length < 1 || chunks.length > 500) throw new Error('Invalid semantic chunk set');
    if (embeddings && embeddings.vectors.length !== chunks.length) throw new Error('Embedding count mismatch');

    this.database.native.exec('BEGIN IMMEDIATE');
    try {
      this.database.native.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);
      const insertChunk = this.database.native.prepare(`
        INSERT INTO document_chunks(document_id, chunk_index, char_start, char_end, text, text_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertEmbedding = embeddings
        ? this.database.native.prepare(`
            INSERT INTO document_embeddings(chunk_id, provider, model, dimensions, vector, text_hash)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
        : undefined;

      chunks.forEach((chunk, index) => {
        const result = insertChunk.run(
          documentId,
          chunk.chunkIndex,
          chunk.charStart,
          chunk.charEnd,
          chunk.text,
          chunk.textHash,
        );
        const chunkId = Number(result.lastInsertRowid);
        if (insertEmbedding && embeddings) {
          insertEmbedding.run(
            chunkId,
            embeddings.provider,
            embeddings.model,
            embeddings.dimensions,
            encodeVector(embeddings.vectors[index]!, embeddings.dimensions),
            chunk.textHash,
          );
        }
      });
      this.database.native.exec('COMMIT');
    } catch (error) {
      this.database.native.exec('ROLLBACK');
      throw error;
    }
  }

  countChunks(documentId: number): number {
    const row = this.database.native.prepare('SELECT COUNT(*) AS count FROM document_chunks WHERE document_id = ?')
      .get(documentId) as { count: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  countEmbeddings(documentId: number): number {
    const row = this.database.native.prepare(`
      SELECT COUNT(*) AS count
      FROM document_embeddings e
      JOIN document_chunks c ON c.id = e.chunk_id
      WHERE c.document_id = ?
    `).get(documentId) as { count: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  listChunks(documentId: number): Array<{ id: number; documentId: number; chunkIndex: number; text: string; textHash: string }> {
    const rows = this.database.native.prepare(`
      SELECT id, document_id, chunk_index, char_start, char_end, text, text_hash
      FROM document_chunks WHERE document_id = ? ORDER BY chunk_index
    `).all(documentId) as unknown as StoredChunkRow[];
    return rows.map((row) => ({
      id: Number(row.id),
      documentId: Number(row.document_id),
      chunkIndex: Number(row.chunk_index),
      text: row.text,
      textHash: row.text_hash,
    }));
  }

  searchByVector(
    queryVector: number[],
    options: { provider: string; model: string; dimensions: number; limit?: number },
  ): SemanticDocumentHit[] {
    const limit = options.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid semantic search limit');
    if (queryVector.length !== options.dimensions) throw new Error('Semantic query dimension mismatch');
    if (queryVector.some((value) => !Number.isFinite(value))) throw new Error('Semantic query contains non-finite value');

    const rows = this.database.native.prepare(`
      SELECT c.id, c.document_id, c.chunk_index, c.char_start, c.char_end, c.text, c.text_hash,
             e.provider, e.model, e.dimensions, e.vector
      FROM document_embeddings e
      JOIN document_chunks c ON c.id = e.chunk_id
      WHERE e.provider = ? AND e.model = ? AND e.dimensions = ?
    `).all(options.provider, options.model, options.dimensions) as unknown as EmbeddingRow[];

    return rows
      .map((row) => ({
        documentId: Number(row.document_id),
        chunkId: Number(row.id),
        chunkIndex: Number(row.chunk_index),
        score: cosineSimilarity(queryVector, decodeVector(row.vector, Number(row.dimensions))),
        text: row.text,
      }))
      .filter((row) => Number.isFinite(row.score) && row.score >= -1 && row.score <= 1)
      .sort((left, right) => right.score - left.score || left.documentId - right.documentId || left.chunkIndex - right.chunkIndex)
      .slice(0, limit);
  }
}
