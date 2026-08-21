import type { AppDatabase } from './db.ts';

export interface BriefingDeliveryRecord {
  localDate: string;
  destination: string;
  messageId?: string;
  deliveredAt: string;
}

export class BriefingDeliveryRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  hasDelivered(localDate: string): boolean {
    const row = this.database.native
      .prepare('SELECT 1 AS found FROM briefing_deliveries WHERE local_date = ?')
      .get(localDate) as { found: number } | undefined;
    return row?.found === 1;
  }

  markDelivered(record: BriefingDeliveryRecord): boolean {
    const result = this.database.native
      .prepare(`
        INSERT OR IGNORE INTO briefing_deliveries(local_date, destination, message_id, delivered_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(record.localDate, record.destination, record.messageId ?? null, record.deliveredAt);
    return result.changes === 1;
  }

  get(localDate: string): BriefingDeliveryRecord | undefined {
    const row = this.database.native
      .prepare(`
        SELECT local_date, destination, message_id, delivered_at
        FROM briefing_deliveries
        WHERE local_date = ?
      `)
      .get(localDate) as {
        local_date: string;
        destination: string;
        message_id: string | null;
        delivered_at: string;
      } | undefined;
    if (!row) return undefined;
    return {
      localDate: row.local_date,
      destination: row.destination,
      messageId: row.message_id ?? undefined,
      deliveredAt: row.delivered_at,
    };
  }
}
