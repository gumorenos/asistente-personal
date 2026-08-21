import type { AppDatabase } from './db.ts';
import { compileFtsQuery } from '../search/fts-query.ts';

export type LocalMemorySource = 'message' | 'note' | 'reminder' | 'expense';

export interface LocalMemorySearchResult {
  source: LocalMemorySource;
  sourceId: string;
  occurredAt: number;
  text: string;
}

interface SearchOptions {
  limit?: number;
  excludeMessageId?: string;
  source?: LocalMemorySource;
  fromEpochSeconds?: number;
  toEpochSeconds?: number;
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

    const fromEpochSeconds = options.fromEpochSeconds ?? null;
    const toEpochSeconds = options.toEpochSeconds ?? null;
    if (fromEpochSeconds !== null && (!Number.isSafeInteger(fromEpochSeconds) || fromEpochSeconds < 0)) {
      throw new Error('Invalid local memory search start');
    }
    if (toEpochSeconds !== null && (!Number.isSafeInteger(toEpochSeconds) || toEpochSeconds < 0)) {
      throw new Error('Invalid local memory search end');
    }
    if (fromEpochSeconds !== null && toEpochSeconds !== null && fromEpochSeconds >= toEpochSeconds) {
      throw new Error('Invalid local memory search range');
    }

    const excludeMessageId = options.excludeMessageId?.trim() || null;
    const source = options.source ?? null;
    const rows = this.database.native.prepare(`
      SELECT source, source_id, CAST(occurred_at AS INTEGER) AS occurred_at, text
      FROM self_memory_fts
      WHERE self_memory_fts MATCH ?
        AND (? IS NULL OR source = ?)
        AND (? IS NULL OR CAST(occurred_at AS INTEGER) >= ?)
        AND (? IS NULL OR CAST(occurred_at AS INTEGER) < ?)
        AND (? IS NULL OR NOT (source = 'message' AND source_id = ?))
      ORDER BY bm25(self_memory_fts), CAST(occurred_at AS INTEGER) DESC
      LIMIT ?
    `).all(
      compiled.expression,
      source,
      source,
      fromEpochSeconds,
      fromEpochSeconds,
      toEpochSeconds,
      toEpochSeconds,
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
