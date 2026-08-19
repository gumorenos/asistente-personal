import type { AppDatabase } from './db.ts';

export interface ExpenseInput {
  amountMinor: number;
  currency: string;
  description?: string;
  occurredAt: string;
}

export interface ExpenseRecord extends ExpenseInput {
  id: number;
}

export class ExpenseRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(input: ExpenseInput): number {
    const result = this.database.native
      .prepare(`
        INSERT INTO expenses(amount_minor, currency, description, occurred_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(input.amountMinor, input.currency, input.description ?? null, input.occurredAt);
    return Number(result.lastInsertRowid);
  }

  listRecent(limit = 10): ExpenseRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, amount_minor, currency, description, occurred_at
        FROM expenses
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as Array<{
        id: number;
        amount_minor: number;
        currency: string;
        description: string | null;
        occurred_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      description: row.description ?? undefined,
      occurredAt: row.occurred_at,
    }));
  }
}
