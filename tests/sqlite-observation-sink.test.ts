import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from '../src/core/types.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { ObserverService } from '../src/observer/observer-service.ts';
import { SqliteObservationSink } from '../src/observer/sqlite-observation-sink.ts';

function message(chatJid: string, id = 'm1', text = 'hola'): IncomingMessage {
  return {
    id,
    chatId: chatJid,
    senderId: '51933333333@s.whatsapp.net',
    timestamp: 1_700_000_000,
    text,
    kind: 'text',
    fromMe: false,
    isGroup: chatJid.endsWith('@g.us'),
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const service = new ObserverService(chats, sink);
  return { db, chats, sink, service };
}

test('central migrations install the dedicated observations table', () => {
  const { db } = setup();
  const row = db.native
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observations'")
    .get() as { name: string } | undefined;
  assert.equal(row?.name, 'observations');
  const migration = db.native
    .prepare('SELECT version FROM schema_migrations WHERE version = 9')
    .get() as { version: number } | undefined;
  assert.equal(migration?.version, 9);
  db.close();
});

test('persistent sink stores allowlisted text idempotently in its dedicated table', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net', 'Trabajo');

  assert.equal((await service.observe(message('51922222222@s.whatsapp.net'))).status, 'stored');
  assert.equal((await service.observe(message('51922222222@s.whatsapp.net'))).status, 'duplicate');
  assert.equal(sink.count('51922222222@s.whatsapp.net'), 1);
  assert.equal(sink.listRecent('51922222222@s.whatsapp.net')[0]?.text, 'hola');

  const stage1Messages = db.native.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number };
  assert.equal(stage1Messages.count, 0);
  db.close();
});

test('disabled chat stops future observer writes immediately', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net');
  assert.equal((await service.observe(message('51922222222@s.whatsapp.net', 'm1'))).status, 'stored');
  chats.disable('51922222222@s.whatsapp.net');
  assert.equal((await service.observe(message('51922222222@s.whatsapp.net', 'm2'))).status, 'ignored_not_allowed');
  assert.equal(sink.count('51922222222@s.whatsapp.net'), 1);
  db.close();
});

test('persistent sink enforces text-only and bounded content independently of service', () => {
  const { db, chats, sink } = setup();
  chats.enable('51922222222@s.whatsapp.net');
  assert.throws(() => sink.save({
    messageId: 'audio-1',
    chatJid: '51922222222@s.whatsapp.net',
    timestamp: 1,
    text: 'caption',
    kind: 'audio',
    isGroup: false,
  }), /text only/);
  assert.throws(() => sink.save({
    messageId: 'long-1',
    chatJid: '51922222222@s.whatsapp.net',
    timestamp: 1,
    text: 'x'.repeat(4_001),
    kind: 'text',
    isGroup: false,
  }), /text length/);
  assert.equal(sink.count('51922222222@s.whatsapp.net'), 0);
  db.close();
});

test('per-chat purge uses each allowlist retention window independently', () => {
  const { db, chats, sink } = setup();
  const shortJid = '51922222222@s.whatsapp.net';
  const longJid = '120363123456789@g.us';
  chats.enable(shortJid, 'Corto', 1);
  chats.enable(longJid, 'Largo', 30);

  const now = Math.floor(new Date('2026-08-19T12:00:00.000Z').getTime() / 1_000);
  const twoDaysAgo = now - 2 * 86400;
  sink.save({ messageId: 'short-old', chatJid: shortJid, timestamp: twoDaysAgo, text: 'old short', kind: 'text', isGroup: false });
  sink.save({ messageId: 'long-old', chatJid: longJid, timestamp: twoDaysAgo, text: 'old long', kind: 'text', isGroup: true });

  assert.equal(sink.purgeExpired(now), 1);
  assert.equal(sink.count(shortJid), 0);
  assert.equal(sink.count(longJid), 1);
  db.close();
});

test('listRecent is chat-scoped and bounded', () => {
  const { db, chats, sink } = setup();
  const jid = '51922222222@s.whatsapp.net';
  chats.enable(jid);
  for (let i = 0; i < 3; i += 1) {
    sink.save({ messageId: `m${i}`, chatJid: jid, timestamp: 100 + i, text: `text-${i}`, kind: 'text', isGroup: false });
  }
  const rows = sink.listRecent(jid, 2);
  assert.deepEqual(rows.map((row) => row.messageId), ['m2', 'm1']);
  assert.throws(() => sink.listRecent(jid, 0), /Invalid observation limit/);
  assert.throws(() => sink.listRecent(jid, 501), /Invalid observation limit/);
  db.close();
});
