import type { AppDatabase } from './db.ts';

export interface ExpenseInput {
  amountMinor: number;
  currency: string;
  description?: string;
  category?: string;
  occurredAt: string;
}

export interface ExpenseRecord extends ExpenseInput {
  id: number;
}

export interface ExpenseSummary {
  count: number;
  totalMinor: number;
  byCategory: Array<{ category: string; totalMinor: number; count: number }>;
}

export class ExpenseRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(input: ExpenseInput): number {
    const result = this.database.native
      .prepare(`
        INSERT INTO expenses(amount_minor, currency, category, description, occurred_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.amountMinor,
        input.currency,
        input.category ?? null,
        input.description ?? null,
        input.occurredAt,
      );
    return Number(result.lastInsertRowid);
  }

  listRecent(limit = 10): ExpenseRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, amount_minor, currency, category, description, occurred_at
        FROM expenses
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as RawExpenseRow[];
    return rows.map(mapRow);
  }

  listRange(startIso: string, endIso: string, limit = 50): ExpenseRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, amount_minor, currency, category, description, occurred_at
        FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `)
      .all(startIso, endIso, limit) as RawExpenseRow[];
    return rows.map(mapRow);
  }

  setCategory(id: number, category: string): boolean {
    const normalized = category.trim().toLowerCase();
    if (!normalized || normalized.length > 40) return false;
    const result = this.database.native
      .prepare('UPDATE expenses SET category = ? WHERE id = ?')
      .run(normalized, id);
    return result.changes === 1;
  }

  summarizeRange(startIso: string, endIso: string): ExpenseSummary {
    const total = this.database.native
      .prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total_minor
        FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?
      `)
      .get(startIso, endIso) as { count: number; total_minor: number };
    const categories = this.database.native
      .prepare(`
        SELECT COALESCE(category, 'sin categoría') AS category,
               COUNT(*) AS count,
               SUM(amount_minor) AS total_minor
        FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?
        GROUP BY COALESCE(category, 'sin categoría')
        ORDER BY total_minor DESC, category ASC
      `)
      .all(startIso, endIso) as Array<{ category: string; count: number; total_minor: number }>;
    return {
      count: total.count,
      totalMinor: total.total_minor,
      byCategory: categories.map((row) => ({
        category: row.category,
        count: row.count,
        totalMinor: row.total_minor,
      })),
    };
  }
}

interface RawExpenseRow {
  id: number;
  amount_minor: number;
  currency: string;
  category: string | null;
  description: string | null;
  occurred_at: string;
}

function mapRow(row: RawExpenseRow): ExpenseRecord {
  return {
    id: row.id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    category: row.category ?? undefined,
    description: row.description ?? undefined,
    occurredAt: row.occurred_at,
  };
}
