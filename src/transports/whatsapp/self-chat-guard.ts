import type { IncomingMessage } from '../../core/types.ts';

export function resolveAllowedSelfChat(
  message: IncomingMessage,
  allowedJids: ReadonlySet<string>,
): IncomingMessage | undefined {
  if (!message.fromMe || message.isGroup || allowedJids.size === 0) return undefined;

  if (allowedJids.has(message.chatId)) return message;

  if (message.chatIdAlt && allowedJids.has(message.chatIdAlt)) {
    return {
      ...message,
      chatId: message.chatIdAlt,
      chatIdAlt: message.chatId,
    };
  }

  return undefined;
}
