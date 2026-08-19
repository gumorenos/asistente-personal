import type { AppDatabase } from './db.ts';

export interface ReminderInput {
  body: string;
  dueAt?: string;
  chatId: string;
}

export interface ReminderRecord extends ReminderInput {
  id: number;
  status: string;
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
      .all(limit) as Array<{
        id: number;
        body: string;
        due_at: string | null;
        chat_id: string;
        status: string;
        delivered_at: string | null;
      }>;
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
      .all(nowIso, limit) as Array<{
        id: number;
        body: string;
        due_at: string | null;
        chat_id: string;
        status: string;
        delivered_at: string | null;
      }>;
    return rows.map(mapRow);
  }

  markDelivered(id: number, deliveredAt: string): void {
    this.database.native
      .prepare(`
        UPDATE reminders
        SET delivered_at = ?, status = 'delivered', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `)
      .run(deliveredAt, id);
  }
}

function mapRow(row: {
  id: number;
  body: string;
  due_at: string | null;
  chat_id: string;
  status: string;
  delivered_at: string | null;
}): ReminderRecord {
  return {
    id: row.id,
    body: row.body,
    dueAt: row.due_at ?? undefined,
    chatId: row.chat_id,
    status: row.status,
    deliveredAt: row.delivered_at ?? undefined,
  };
}
