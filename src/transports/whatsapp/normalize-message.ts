import type { WAMessage } from 'baileys';
import type { IncomingMessage, MessageKind } from '../../core/types.ts';

function toUnixSeconds(value: WAMessage['messageTimestamp']): number {
  if (value === null || value === undefined) return Math.floor(Date.now() / 1000);
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Math.floor(Date.now() / 1000);
}

function toOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined;
  return numeric;
}

function detectKind(message: NonNullable<WAMessage['message']>): MessageKind {
  if (message.audioMessage) return 'audio';
  if (message.imageMessage) return 'image';
  if (message.documentMessage) return 'document';
  if (message.videoMessage) return 'video';
  if (message.conversation || message.extendedTextMessage?.text) return 'text';
  return 'unknown';
}

function extractText(message: NonNullable<WAMessage['message']>): string {
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    ''
  );
}

export function normalizeWhatsAppMessage(raw: WAMessage): IncomingMessage | undefined {
  const id = raw.key.id ?? undefined;
  const chatId = raw.key.remoteJid ?? undefined;
  if (!id || !chatId || !raw.message) return undefined;

  const key = raw.key as WAMessage['key'] & { remoteJidAlt?: string };

  return {
    id,
    chatId,
    chatIdAlt: key.remoteJidAlt ?? undefined,
    senderId: raw.key.participant ?? chatId,
    timestamp: toUnixSeconds(raw.messageTimestamp),
    text: extractText(raw.message),
    kind: detectKind(raw.message),
    fromMe: raw.key.fromMe === true,
    isGroup: chatId.endsWith('@g.us'),
    mediaSizeBytes: raw.message.audioMessage
      ? toOptionalNonNegativeInteger(raw.message.audioMessage.fileLength)
      : undefined,
  };
}
