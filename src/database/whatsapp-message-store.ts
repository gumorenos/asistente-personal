import { BufferJSON, type WAMessage, type WAMessageKey } from 'baileys';
import type { AppDatabase } from './db.ts';

type MessageContent = NonNullable<WAMessage['message']>;

function serialize(value: MessageContent): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize(value: string): MessageContent {
  return JSON.parse(value, BufferJSON.reviver) as MessageContent;
}

export class WhatsAppMessageStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  save(message: WAMessage): boolean {
    const remoteJid = message.key.remoteJid?.trim();
    const messageId = message.key.id?.trim();
    const content = message.message;
    if (!remoteJid || !messageId || !content) return false;

    this.database.native.prepare(`
      INSERT INTO whatsapp_message_store(remote_jid, message_id, content_json, from_me, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(remote_jid, message_id) DO UPDATE SET
        content_json = excluded.content_json,
        from_me = excluded.from_me,
        updated_at = CURRENT_TIMESTAMP
    `).run(remoteJid, messageId, serialize(content), message.key.fromMe ? 1 : 0);
    return true;
  }

  get(key: WAMessageKey): MessageContent | undefined {
    const remoteJid = key.remoteJid?.trim();
    const messageId = key.id?.trim();
    if (!remoteJid || !messageId) return undefined;

    const row = this.database.native.prepare(`
      SELECT content_json
      FROM whatsapp_message_store
      WHERE remote_jid = ? AND message_id = ?
    `).get(remoteJid, messageId) as { content_json: string } | undefined;

    return row ? deserialize(row.content_json) : undefined;
  }

  count(): number {
    const row = this.database.native.prepare('SELECT COUNT(*) AS count FROM whatsapp_message_store').get() as { count: number };
    return Number(row.count);
  }

  purgeBefore(isoTimestamp: string): number {
    const result = this.database.native.prepare(`
      DELETE FROM whatsapp_message_store
      WHERE datetime(updated_at) < datetime(?)
    `).run(isoTimestamp);
    return Number(result.changes);
  }
}
