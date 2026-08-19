import type { AppDatabase } from './db.ts';

export interface AuditInput {
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditRecord {
  id: number;
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export class AuditRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  record(input: AuditInput): number {
    const result = this.database.native
      .prepare(`
        INSERT INTO audit_log(event_type, entity_type, entity_id, metadata_json)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        input.eventType,
        input.entityType ?? null,
        input.entityId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
    return Number(result.lastInsertRowid);
  }

  listRecent(limit = 20): AuditRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, event_type, entity_type, entity_id, metadata_json, created_at
        FROM audit_log
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as Array<{
        id: number;
        event_type: string;
        entity_type: string | null;
        entity_id: string | null;
        metadata_json: string | null;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      entityType: row.entity_type ?? undefined,
      entityId: row.entity_id ?? undefined,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
    }));
  }
}
