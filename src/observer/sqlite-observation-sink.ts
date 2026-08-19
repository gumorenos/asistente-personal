import type { AppDatabase } from '../database/db.ts';
import { normalizeObservedJid } from '../database/observed-chat-repository.ts';
import type { ObservationRecord, ObservationSink } from './types.ts';

export const OBSERVATION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS observations (
    chat_jid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sender_id TEXT,
    timestamp INTEGER NOT NULL,
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
    kind TEXT NOT NULL CHECK (kind = 'text'),
    is_group INTEGER NOT NULL CHECK (is_group IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_jid, message_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_observations_chat_timestamp
    ON observations(chat_jid, timestamp DESC);
`;

export interface StoredObservation extends ObservationRecord {
  createdAt: string;
}

interface RawObservationRow {
  chat_jid: string;
  message_id: string;
  sender_id: string | null;
  timestamp: number;
  text: string;
  kind: 'text';
  is_group: number;
  created_at: string;
}

/**
 * Feature-local schema installer used by tests until Observer activation gets
 * an explicit central migration. Runtime does not instantiate this sink yet.
 */
export function installObservationSchema(database: AppDatabase): void {
  database.native.exec(OBSERVATION_SCHEMA_SQL);
}

export class SqliteObservationSink implements ObservationSink {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  save(observation: ObservationRecord): boolean {
    const chatJid = normalizeObservedJid(observation.chatJid);
    const text = observation.text.trim();
    if (observation.kind !== 'text') throw new Error('Observation sink accepts text only');
    if (!text || text.length > 4_000) throw new Error('Invalid observed text length');
    if (!observation.messageId.trim()) throw new Error('Invalid observed message id');
    if (!Number.isSafeInteger(observation.timestamp) || observation.timestamp < 0) {
      throw new Error('Invalid observed timestamp');
    }

    const result = this.database.native
      .prepare(`
        INSERT OR IGNORE INTO observations(
          chat_jid, message_id, sender_id, timestamp, text, kind, is_group
        ) VALUES (?, ?, ?, ?, ?, 'text', ?)
      `)
      .run(
        chatJid,
        observation.messageId,
        observation.senderId ?? null,
        observation.timestamp,
        text,
        observation.isGroup ? 1 : 0,
      );
    return result.changes === 1;
  }

  listRecent(chatJidInput: string, limit = 50): StoredObservation[] {
    const chatJid = normalizeObservedJid(chatJidInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid observation limit');
    const rows = this.database.native
      .prepare(`
        SELECT chat_jid, message_id, sender_id, timestamp, text, kind, is_group, created_at
        FROM observations
        WHERE chat_jid = ?
        ORDER BY timestamp DESC, message_id DESC
        LIMIT ?
      `)
      .all(chatJid, limit) as unknown as RawObservationRow[];
    return rows.map(mapRow);
  }

  purgeExpired(nowEpochSeconds: number): number {
    if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0) {
      throw new Error('Invalid purge timestamp');
    }
    const result = this.database.native
      .prepare(`
        DELETE FROM observations
        WHERE EXISTS (
          SELECT 1
          FROM observed_chats
          WHERE observed_chats.jid = observations.chat_jid
            AND observations.timestamp < ? - (observed_chats.retention_days * 86400)
        )
      `)
      .run(nowEpochSeconds);
    return result.changes;
  }

  count(chatJidInput: string): number {
    const chatJid = normalizeObservedJid(chatJidInput);
    const row = this.database.native
      .prepare('SELECT COUNT(*) AS count FROM observations WHERE chat_jid = ?')
      .get(chatJid) as { count: number };
    return row.count;
  }
}

function mapRow(row: RawObservationRow): StoredObservation {
  return {
    chatJid: row.chat_jid,
    messageId: row.message_id,
    senderId: row.sender_id ?? undefined,
    timestamp: row.timestamp,
    text: row.text,
    kind: row.kind,
    isGroup: row.is_group === 1,
    createdAt: row.created_at,
  };
}
