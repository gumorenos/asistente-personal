import type { AppDatabase } from './db.ts';
import { compileFtsQuery } from '../search/fts-query.ts';

export type LocalMemorySource = 'message' | 'note';

export interface LocalMemorySearchResult {
  source: LocalMemorySource;
  sourceId: string;
  occurredAt: number;
  text: string;
}

interface SearchOptions {
  limit?: number;
  excludeMessageId?: string;
}

export class LocalMemorySearchRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  search(query: string, options: SearchOptions = {}): LocalMemorySearchResult[] {
    const compiled = compileFtsQuery(query);
    if (!compiled) return [];

    const limit = options.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid local memory search limit');

    const excludeMessageId = options.excludeMessageId?.trim() || null;
    const rows = this.database.native.prepare(`
      SELECT source, source_id, CAST(occurred_at AS INTEGER) AS occurred_at, text
      FROM self_memory_fts
      WHERE self_memory_fts MATCH ?
        AND (? IS NULL OR NOT (source = 'message' AND source_id = ?))
      ORDER BY bm25(self_memory_fts), CAST(occurred_at AS INTEGER) DESC
      LIMIT ?
    `).all(
      compiled.expression,
      excludeMessageId,
      excludeMessageId,
      limit,
    ) as unknown as Array<{
      source: LocalMemorySource;
      source_id: string;
      occurred_at: number | bigint | null;
      text: string;
    }>;

    return rows.map((row) => ({
      source: row.source,
      sourceId: row.source_id,
      occurredAt: Number(row.occurred_at ?? 0),
      text: row.text,
    }));
  }
}
