import type { AppDatabase } from './db.ts';

export type ReminderStatus = 'pending' | 'delivered' | 'completed' | 'cancelled';

export interface ReminderInput {
  body: string;
  dueAt?: string;
  chatId: string;
}

export interface ReminderRecord extends ReminderInput {
  id: number;
  status: ReminderStatus;
  deliveredAt?: string;
}

export class ReminderRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(input: ReminderInput): number {
    const result = this.database.native
      .prepare(`
        INSERT INTO reminders(body, due_at, chat_id)
        VALUES (?, ?, ?)
      `)
      .run(input.body.trim(), input.dueAt ?? null, input.chatId);
    return Number(result.lastInsertRowid);
  }

  listPending(limit = 10): ReminderRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, body, due_at, chat_id, status, delivered_at
        FROM reminders
        WHERE status = 'pending'
        ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, id DESC
        LIMIT ?
      `)
      .all(limit) as unknown as RawReminderRow[];
    return rows.map(mapRow);
  }

  listDue(nowIso: string, limit = 20): ReminderRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, body, due_at, chat_id, status, delivered_at
        FROM reminders
        WHERE status = 'pending'
          AND delivered_at IS NULL
          AND due_at IS NOT NULL
          AND due_at <= ?
        ORDER BY due_at ASC, id ASC
        LIMIT ?
      `)
      .all(nowIso, limit) as unknown as RawReminderRow[];
    return rows.map(mapRow);
  }

  markDelivered(id: number, deliveredAt: string): boolean {
    const result = this.database.native
      .prepare(`
        UPDATE reminders
        SET delivered_at = ?, status = 'delivered', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `)
      .run(deliveredAt, id);
    return result.changes === 1;
  }

  setStatus(id: number, status: 'completed' | 'cancelled'): boolean {
    const result = this.database.native
      .prepare(`
        UPDATE reminders
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `)
      .run(status, id);
    return result.changes === 1;
  }
}

interface RawReminderRow {
  id: number;
  body: string;
  due_at: string | null;
  chat_id: string | null;
  status: ReminderStatus;
  delivered_at: string | null;
}

function mapRow(row: RawReminderRow): ReminderRecord {
  return {
    id: row.id,
    body: row.body,
    dueAt: row.due_at ?? undefined,
    chatId: row.chat_id ?? '',
    status: row.status,
    deliveredAt: row.delivered_at ?? undefined,
  };
}
