import assert from 'node:assert/strict';
import test from 'node:test';
import type { WAMessage } from 'baileys';
import { AppDatabase } from '../src/database/db.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { WhatsAppMessageStore } from '../src/database/whatsapp-message-store.ts';
import { BaileysWhatsAppTransport } from '../src/transports/whatsapp/baileys-transport.ts';

interface TransportHarness {
  handleRawMessage(raw: WAMessage, socket: never, baileysLogger: never): Promise<void>;
}

function raw(remoteJid: string, id: string, fromMe: boolean, text = 'hola'): WAMessage {
  return {
    key: { remoteJid, id, fromMe },
    message: { conversation: text },
    messageTimestamp: 1,
  };
}

test('Baileys retry store persists authorized self only and excludes Observer/ignored traffic', async () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const retryStore = new WhatsAppMessageStore(db);
  const selfJid = '51911111111@s.whatsapp.net';
  let observed = 0;
  let selfHandled = 0;

  const transport = new BaileysWhatsAppTransport(
    { selfJids: [selfJid], logMessageContent: false },
    db,
    messages,
    async () => { observed += 1; },
  );
  transport.onMessage(async () => { selfHandled += 1; });
  const harness = transport as unknown as TransportHarness;

  await harness.handleRawMessage(raw('51922222222@s.whatsapp.net', 'third', false), {} as never, {} as never);
  await harness.handleRawMessage(raw('120363123456789@g.us', 'group', false), {} as never, {} as never);

  assert.equal(observed, 2);
  assert.equal(selfHandled, 0);
  assert.equal(retryStore.count(), 0);

  await harness.handleRawMessage(raw(selfJid, 'self-1', true, 'ping'), {} as never, {} as never);
  assert.equal(observed, 2);
  assert.equal(selfHandled, 1);
  assert.equal(retryStore.count(), 1);
  assert.deepEqual(retryStore.get({ remoteJid: selfJid, id: 'self-1' }), { conversation: 'ping' });

  const noObserver = new BaileysWhatsAppTransport(
    { selfJids: [selfJid], logMessageContent: false },
    db,
    messages,
  );
  const ignoredHarness = noObserver as unknown as TransportHarness;
  await ignoredHarness.handleRawMessage(raw('51933333333@s.whatsapp.net', 'ignored', false), {} as never, {} as never);
  assert.equal(retryStore.count(), 1);

  db.close();
});
