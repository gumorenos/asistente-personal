import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWhatsAppMessage } from '../src/transports/whatsapp/normalize-message.ts';

test('normalizes a plain self-chat text message', () => {
  const normalized = normalizeWhatsAppMessage({
    key: { id: 'ABC', remoteJid: '123@s.whatsapp.net', fromMe: true },
    messageTimestamp: 1_700_000_000,
    message: { conversation: 'ping' },
  } as never);

  assert.deepEqual(normalized, {
    id: 'ABC',
    chatId: '123@s.whatsapp.net',
    chatIdAlt: undefined,
    senderId: '123@s.whatsapp.net',
    timestamp: 1_700_000_000,
    text: 'ping',
    kind: 'text',
    fromMe: true,
    isGroup: false,
    mediaSizeBytes: undefined,
  });
});

test('keeps LID alternate jid and detects groups', () => {
  const normalized = normalizeWhatsAppMessage({
    key: {
      id: 'DEF',
      remoteJid: '123@g.us',
      remoteJidAlt: '51999999999@s.whatsapp.net',
      fromMe: true,
      participant: '999@lid',
    },
    messageTimestamp: 1_700_000_001,
    message: { extendedTextMessage: { text: 'hola' } },
  } as never);

  assert.equal(normalized?.chatIdAlt, '51999999999@s.whatsapp.net');
  assert.equal(normalized?.senderId, '999@lid');
  assert.equal(normalized?.isGroup, true);
});

test('normalizes declared audio size for pre-download limits', () => {
  const normalized = normalizeWhatsAppMessage({
    key: { id: 'AUDIO', remoteJid: '51999999999@s.whatsapp.net', fromMe: true },
    messageTimestamp: 1_700_000_002,
    message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: 12_345 } },
  } as never);

  assert.equal(normalized?.kind, 'audio');
  assert.equal(normalized?.mediaSizeBytes, 12_345);
  assert.equal(normalized?.text, '');
});
