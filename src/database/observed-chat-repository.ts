import type { AppDatabase } from './db.ts';

export interface ObservedChatRecord {
  jid: string;
  label?: string;
  retentionDays: number;
  enabled: boolean;
}

interface RawObservedChatRow {
  jid: string;
  label: string | null;
  retention_days: number;
  enabled: number;
}

const OBSERVED_JID_PATTERN = /^[0-9:-]+@(s\.whatsapp\.net|lid|g\.us)$/;

export function normalizeObservedJid(value: string): string {
  const jid = value.trim().toLowerCase();
  if (!OBSERVED_JID_PATTERN.test(jid)) throw new Error('Invalid observed chat JID');
  return jid;
}

export class ObservedChatRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  enable(jidInput: string, label?: string, retentionDays = 7): ObservedChatRecord {
    const jid = normalizeObservedJid(jidInput);
    const normalizedLabel = label?.trim() || undefined;
    if (normalizedLabel && normalizedLabel.length > 100) throw new Error('Observed chat label is too long');
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) throw new Error('Invalid observed chat retention');

    this.database.native
      .prepare(`
        INSERT INTO observed_chats(jid, label, retention_days, enabled)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(jid) DO UPDATE SET
          label = excluded.label,
          retention_days = excluded.retention_days,
          enabled = 1,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(jid, normalizedLabel ?? null, retentionDays);
    return this.get(jid)!;
  }

  disable(jidInput: string): boolean {
    const jid = normalizeObservedJid(jidInput);
    const result = this.database.native
      .prepare(`
        UPDATE observed_chats
        SET enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE jid = ? AND enabled = 1
      `)
      .run(jid);
    return result.changes === 1;
  }

  get(jidInput: string): ObservedChatRecord | undefined {
    const jid = normalizeObservedJid(jidInput);
    const row = this.database.native
      .prepare('SELECT jid, label, retention_days, enabled FROM observed_chats WHERE jid = ?')
      .get(jid) as unknown as RawObservedChatRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listEnabled(limit = 50): ObservedChatRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT jid, label, retention_days, enabled
        FROM observed_chats
        WHERE enabled = 1
        ORDER BY COALESCE(label, jid), jid
        LIMIT ?
      `)
      .all(limit) as unknown as RawObservedChatRow[];
    return rows.map(mapRow);
  }

  isEnabled(jidInput: string): boolean {
    try { return this.get(jidInput)?.enabled === true; }
    catch { return false; }
  }
}

function mapRow(row: RawObservedChatRow): ObservedChatRecord {
  return {
    jid: row.jid,
    label: row.label ?? undefined,
    retentionDays: row.retention_days,
    enabled: row.enabled === 1,
  };
}
