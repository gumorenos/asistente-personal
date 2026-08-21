import assert from 'node:assert/strict';
import test from 'node:test';
import type { WAMessage } from 'baileys';
import { AppDatabase } from '../src/database/db.ts';
import { WhatsAppMessageStore } from '../src/database/whatsapp-message-store.ts';

type MessageKeyWithAlt = WAMessage['key'] & { remoteJidAlt?: string };

function rawMessage(remoteJid: string, id: string, text: string, fromMe = true, remoteJidAlt?: string): WAMessage {
  const key: MessageKeyWithAlt = { remoteJid, id, fromMe, remoteJidAlt };
  return {
    key,
    message: { conversation: text },
  };
}

test('central migrations install whatsapp_message_store with PN/LID alias column', () => {
  const db = new AppDatabase(':memory:');
  const row = db.native.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'whatsapp_message_store'
  `).get() as { name: string } | undefined;
  assert.equal(row?.name, 'whatsapp_message_store');
  const columns = db.native.prepare('PRAGMA table_info(whatsapp_message_store)').all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === 'remote_jid_alt'));
  db.close();
});

test('retry store round-trips exact message content by chat and message id', () => {
  const db = new AppDatabase(':memory:');
  const store = new WhatsAppMessageStore(db);
  const jid = '51911111111@s.whatsapp.net';

  assert.equal(store.save(rawMessage(jid, 'm1', 'hola')), true);
  assert.deepEqual(store.get({ remoteJid: jid, id: 'm1' }), { conversation: 'hola' });
  assert.equal(store.get({ remoteJid: jid, id: 'missing' }), undefined);
  assert.equal(store.get({ remoteJid: '51922222222@s.whatsapp.net', id: 'm1' }), undefined);
  db.close();
});

test('retry store resolves the same message through PN or LID alias without duplicating rows', () => {
  const db = new AppDatabase(':memory:');
  const store = new WhatsAppMessageStore(db);
  const pn = '51911111111@s.whatsapp.net';
  const lid = '123456789012345@lid';

  assert.equal(store.save(rawMessage(pn, 'alias-1', 'por alias', true, lid)), true);
  assert.deepEqual(store.get({ remoteJid: pn, id: 'alias-1' }), { conversation: 'por alias' });
  assert.deepEqual(store.get({ remoteJid: lid, id: 'alias-1' }), { conversation: 'por alias' });

  assert.equal(store.save(rawMessage(lid, 'alias-1', 'actualizado por LID', true, pn)), true);
  assert.equal(store.count(), 1);
  assert.deepEqual(store.get({ remoteJid: pn, id: 'alias-1' }), { conversation: 'actualizado por LID' });
  assert.deepEqual(store.get({ remoteJid: lid, id: 'alias-1' }), { conversation: 'actualizado por LID' });
  db.close();
});

test('retry store preserves binary fields via BufferJSON', () => {
  const db = new AppDatabase(':memory:');
  const store = new WhatsAppMessageStore(db);
  const jid = '51911111111@s.whatsapp.net';
  const message: WAMessage = {
    key: { remoteJid: jid, id: 'binary', fromMe: true },
    message: {
      imageMessage: {
        jpegThumbnail: new Uint8Array([1, 2, 3, 255]),
      },
    },
  };

  assert.equal(store.save(message), true);
  const restored = store.get({ remoteJid: jid, id: 'binary' });
  assert.deepEqual(Array.from(restored?.imageMessage?.jpegThumbnail ?? []), [1, 2, 3, 255]);
  db.close();
});

test('retry store refuses incomplete envelopes and updates idempotently', () => {
  const db = new AppDatabase(':memory:');
  const store = new WhatsAppMessageStore(db);
  const jid = '51911111111@s.whatsapp.net';

  assert.equal(store.save({ key: { remoteJid: jid, fromMe: true } }), false);
  assert.equal(store.save({ key: { id: 'm1', fromMe: true } }), false);
  assert.equal(store.save({ key: { remoteJid: jid, id: 'm1', fromMe: true } }), false);

  assert.equal(store.save(rawMessage(jid, 'm1', 'primero')), true);
  assert.equal(store.save(rawMessage(jid, 'm1', 'actualizado')), true);
  assert.equal(store.count(), 1);
  assert.deepEqual(store.get({ remoteJid: jid, id: 'm1' }), { conversation: 'actualizado' });
  db.close();
});
