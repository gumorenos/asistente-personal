import type { IncomingMessage } from '../core/types.ts';
import type { ObservedChatRepository } from '../database/observed-chat-repository.ts';
import type { ObservationResult, ObservationSink } from './types.ts';

const MAX_OBSERVED_TEXT_CHARS = 4_000;

export class ObserverService {
  private readonly chats: ObservedChatRepository;
  private readonly sink: ObservationSink;

  constructor(chats: ObservedChatRepository, sink: ObservationSink) {
    this.chats = chats;
    this.sink = sink;
  }

  async observe(message: IncomingMessage): Promise<ObservationResult> {
    const chatJid = this.resolveAllowedChat(message);
    if (!chatJid) return { status: 'ignored_not_allowed' };
    if (message.kind !== 'text') return { status: 'ignored_non_text' };

    const text = message.text.trim();
    if (!text) return { status: 'ignored_empty' };
    const boundedText = text.length > MAX_OBSERVED_TEXT_CHARS
      ? `${text.slice(0, MAX_OBSERVED_TEXT_CHARS - 1).trimEnd()}…`
      : text;

    const inserted = await this.sink.save({
      messageId: message.id,
      chatJid,
      senderId: message.senderId,
      timestamp: message.timestamp,
      text: boundedText,
      kind: message.kind,
      isGroup: message.isGroup,
    });
    return inserted ? { status: 'stored', chatJid } : { status: 'duplicate', chatJid };
  }

  private resolveAllowedChat(message: IncomingMessage): string | undefined {
    if (this.chats.isEnabled(message.chatId)) return message.chatId.toLowerCase();
    if (message.chatIdAlt && this.chats.isEnabled(message.chatIdAlt)) return message.chatIdAlt.toLowerCase();
    return undefined;
  }
}
