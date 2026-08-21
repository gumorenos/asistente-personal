import { BufferJSON, type WAMessage, type WAMessageKey } from 'baileys';
import type { AppDatabase } from './db.ts';

type MessageContent = NonNullable<WAMessage['message']>;
type MessageKeyWithAlt = WAMessageKey & { remoteJidAlt?: string | null };

function serialize(value: MessageContent): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize(value: string): MessageContent {
  return JSON.parse(value, BufferJSON.reviver) as MessageContent;
}

function normalizedJid(value: string | null | undefined): string | undefined {
  const jid = value?.trim();
  return jid || undefined;
}

export class WhatsAppMessageStore {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  save(message: WAMessage): boolean {
    const key = message.key as MessageKeyWithAlt;
    const remoteJid = normalizedJid(key.remoteJid);
    const remoteJidAlt = normalizedJid(key.remoteJidAlt);
    const messageId = key.id?.trim();
    const content = message.message;
    if (!remoteJid || !messageId || !content) return false;

    const serialized = serialize(content);
    const alias = remoteJidAlt && remoteJidAlt !== remoteJid ? remoteJidAlt : null;

    const updated = this.database.native.prepare(`
      UPDATE whatsapp_message_store
      SET content_json = ?,
          from_me = ?,
          remote_jid_alt = COALESCE(?, remote_jid_alt),
          updated_at = CURRENT_TIMESTAMP
      WHERE message_id = ?
        AND (
          remote_jid = ? OR remote_jid_alt = ? OR
          (? IS NOT NULL AND (remote_jid = ? OR remote_jid_alt = ?))
        )
    `).run(
      serialized,
      key.fromMe ? 1 : 0,
      alias,
      messageId,
      remoteJid,
      remoteJid,
      alias,
      alias,
      alias,
    );

    if (Number(updated.changes) > 0) return true;

    this.database.native.prepare(`
      INSERT INTO whatsapp_message_store(
        remote_jid, remote_jid_alt, message_id, content_json, from_me, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(remoteJid, alias, messageId, serialized, key.fromMe ? 1 : 0);
    return true;
  }

  get(keyInput: WAMessageKey): MessageContent | undefined {
    const key = keyInput as MessageKeyWithAlt;
    const remoteJid = normalizedJid(key.remoteJid);
    const remoteJidAlt = normalizedJid(key.remoteJidAlt);
    const messageId = key.id?.trim();
    if (!remoteJid || !messageId) return undefined;

    const alias = remoteJidAlt && remoteJidAlt !== remoteJid ? remoteJidAlt : null;
    const row = this.database.native.prepare(`
      SELECT content_json
      FROM whatsapp_message_store
      WHERE message_id = ?
        AND (
          remote_jid = ? OR remote_jid_alt = ? OR
          (? IS NOT NULL AND (remote_jid = ? OR remote_jid_alt = ?))
        )
      ORDER BY CASE WHEN remote_jid = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(
      messageId,
      remoteJid,
      remoteJid,
      alias,
      alias,
      alias,
      remoteJid,
    ) as { content_json: string } | undefined;

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
