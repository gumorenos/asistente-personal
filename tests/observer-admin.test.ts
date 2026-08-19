import assert from 'node:assert/strict';
import test from 'node:test';
import { ObserverAdminCapability } from '../src/capabilities/observer-admin-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';

function message(text: string): IncomingMessage {
  return { id: `obs-${text}`, chatId: '51911111111@s.whatsapp.net', timestamp: 1, text, kind: 'text', fromMe: true, isGroup: false };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const audit = new AuditRepository(db);
  const capability = new ObserverAdminCapability(chats, audit);
  return { db, chats, audit, capability };
}

test('observed chat repository validates direct, lid and group JIDs', () => {
  const { db, chats } = setup();
  assert.equal(chats.enable('51922222222@s.whatsapp.net', 'Trabajo').enabled, true);
  assert.equal(chats.enable('123456@lid').enabled, true);
  assert.equal(chats.enable('120363123456789@g.us', 'Familia').enabled, true);
  assert.throws(() => chats.enable('bad@example.com'), /Invalid observed chat JID/);
  assert.throws(() => chats.enable('120363123@g.us', 'x'.repeat(101)), /label is too long/);
  assert.throws(() => chats.enable('120363123@g.us', undefined, 91), /retention/);
  db.close();
});

test('observer admin adds, lists and disables allowlisted chat without activating observer', async () => {
  const { db, chats, capability } = setup();
  const add = (await capability.handle(message('observa chat 120363123456789@g.us como Familia')))?.reply ?? '';
  assert.match(add, /allowlist/);
  assert.match(add, /NO está activo/);
  assert.equal(chats.isEnabled('120363123456789@g.us'), true);

  const list = (await capability.handle(message('chats observados')))?.reply ?? '';
  assert.match(list, /Familia/);
  assert.match(list, /retención 7 días/);
  assert.match(list, /NO activa Observer/);

  const remove = (await capability.handle(message('deja de observar 120363123456789@g.us')))?.reply ?? '';
  assert.match(remove, /retirado/);
  assert.equal(chats.isEnabled('120363123456789@g.us'), false);
  db.close();
});

test('observer audit hashes JID and does not store label or raw JID', async () => {
  const { db, audit, capability } = setup();
  await capability.handle(message('observa chat 51922222222@s.whatsapp.net como Proyecto Secreto'));
  const json = JSON.stringify(audit.listRecent());
  assert.match(json, /observer\.chat\.allowed/);
  assert.doesNotMatch(json, /51922222222|Proyecto Secreto/);
  db.close();
});

test('invalid observer admin input is handled without mutation', async () => {
  const { db, chats, capability } = setup();
  assert.match((await capability.handle(message('observa chat invalid como x')))?.reply ?? '', /inválidos/);
  assert.equal(chats.listEnabled().length, 0);
  db.close();
});
