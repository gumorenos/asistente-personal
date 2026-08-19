import type { IncomingMessage } from '../core/types.ts';
import type { AppDatabase } from './db.ts';

export class MessageRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  saveIncoming(message: IncomingMessage): boolean {
    const result = this.database.native
      .prepare(`
        INSERT OR IGNORE INTO messages (
          id, chat_id, chat_id_alt, sender_id, timestamp, text, kind, from_me, is_group
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        message.id,
        message.chatId,
        message.chatIdAlt ?? null,
        message.senderId ?? null,
        message.timestamp,
        message.text,
        message.kind,
        message.fromMe ? 1 : 0,
        message.isGroup ? 1 : 0,
      );

    return result.changes === 1;
  }

  markAssistantOutbound(messageId: string, destination: string): void {
    this.database.native
      .prepare('INSERT OR IGNORE INTO assistant_outbound(message_id, destination) VALUES (?, ?)')
      .run(messageId, destination);
  }

  isAssistantOutbound(messageId: string): boolean {
    const row = this.database.native
      .prepare('SELECT 1 AS found FROM assistant_outbound WHERE message_id = ?')
      .get(messageId) as { found: number } | undefined;
    return row?.found === 1;
  }

  countMessages(): number {
    const row = this.database.native.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number };
    return row.count;
  }
}
