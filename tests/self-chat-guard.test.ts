import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from '../src/core/types.ts';
import { AppDatabase } from '../src/database/db.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { BaileysWhatsAppTransport } from '../src/transports/whatsapp/baileys-transport.ts';
import { resolveAllowedSelfChat } from '../src/transports/whatsapp/self-chat-guard.ts';

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'm1',
    chatId: '111@lid',
    chatIdAlt: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text: 'ping',
    kind: 'text',
    fromMe: true,
    isGroup: false,
    ...overrides,
  };
}

test('self-chat guard canonicalizes to the actually allowed alternate JID', () => {
  const result = resolveAllowedSelfChat(message(), new Set(['51999999999@s.whatsapp.net']));
  assert.equal(result?.chatId, '51999999999@s.whatsapp.net');
  assert.equal(result?.chatIdAlt, '111@lid');
});

test('self-chat guard refuses empty allowlist, third parties and groups', () => {
  assert.equal(resolveAllowedSelfChat(message(), new Set()), undefined);
  assert.equal(resolveAllowedSelfChat(message(), new Set(['222@lid'])), undefined);
  assert.equal(resolveAllowedSelfChat(message({ isGroup: true }), new Set(['111@lid'])), undefined);
  assert.equal(resolveAllowedSelfChat(message({ fromMe: false }), new Set(['111@lid'])), undefined);
});

test('transport outbound guard refuses third-party destination before connection check', async () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const transport = new BaileysWhatsAppTransport(
    { selfJids: ['51999999999@s.whatsapp.net'], logMessageContent: false },
    db,
    messages,
  );
  await assert.rejects(
    () => transport.sendText('51911111111@s.whatsapp.net', 'hola'),
    /outside configured self-chat allowlist/,
  );
  await assert.rejects(
    () => transport.sendText('51999999999@s.whatsapp.net', 'hola'),
    /not connected/,
  );
  db.close();
});
