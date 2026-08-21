import { BufferJSON, type WAMessage, type WAMessageKey } from 'baileys';
import type { AppDatabase } from './db.ts';

type MessageContent = NonNullable<WAMessage['message']>;
type MessageKeyWithAlt = WAMessageKey & { remoteJidAlt?: string | null };

interface StoredIdentityRow {
  remote_jid: string;
  remote_jid_alt: string | null;
}

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

function alternateForPrimary(primary: string, values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizedJid(value);
    if (normalized && normalized !== primary) return normalized;
  }
  return null;
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
    const incomingAlt = remoteJidAlt && remoteJidAlt !== remoteJid ? remoteJidAlt : null;
    const existing = this.findIdentity(messageId, remoteJid, incomingAlt);

    if (existing) {
      const retainedAlt = alternateForPrimary(existing.remote_jid, [
        existing.remote_jid_alt,
        remoteJid,
        incomingAlt,
      ]);
      this.database.native.prepare(`
        UPDATE whatsapp_message_store
        SET content_json = ?,
            from_me = ?,
            remote_jid_alt = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE remote_jid = ? AND message_id = ?
      `).run(
        serialized,
        key.fromMe ? 1 : 0,
        retainedAlt,
        existing.remote_jid,
        messageId,
      );
      return true;
    }

    this.database.native.prepare(`
      INSERT INTO whatsapp_message_store(
        remote_jid, remote_jid_alt, message_id, content_json, from_me, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(remoteJid, incomingAlt, messageId, serialized, key.fromMe ? 1 : 0);
    return true;
  }

  get(keyInput: WAMessageKey): MessageContent | undefined {
    const key = keyInput as MessageKeyWithAlt;
    const remoteJid = normalizedJid(key.remoteJid);
    const remoteJidAlt = normalizedJid(key.remoteJidAlt);
    const messageId = key.id?.trim();
    if (!remoteJid || !messageId) return undefined;

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
      remoteJidAlt ?? null,
      remoteJidAlt ?? null,
      remoteJidAlt ?? null,
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

  private findIdentity(messageId: string, remoteJid: string, remoteJidAlt: string | null): StoredIdentityRow | undefined {
    return this.database.native.prepare(`
      SELECT remote_jid, remote_jid_alt
      FROM whatsapp_message_store
      WHERE message_id = ?
        AND (
          remote_jid = ? OR remote_jid_alt = ? OR
          (? IS NOT NULL AND (remote_jid = ? OR remote_jid_alt = ?))
        )
      LIMIT 1
    `).get(
      messageId,
      remoteJid,
      remoteJid,
      remoteJidAlt,
      remoteJidAlt,
      remoteJidAlt,
    ) as StoredIdentityRow | undefined;
  }
}
