import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from '../src/core/types.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { ObserverService } from '../src/observer/observer-service.ts';
import type { ObservationRecord, ObservationSink } from '../src/observer/types.ts';

class FakeSink implements ObservationSink {
  readonly rows: ObservationRecord[] = [];
  readonly keys = new Set<string>();

  save(row: ObservationRecord): boolean {
    const key = `${row.chatJid}:${row.messageId}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.rows.push(row);
    return true;
  }
}

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'm1',
    chatId: '51922222222@s.whatsapp.net',
    senderId: '51922222222@s.whatsapp.net',
    timestamp: 1_700_000_000,
    text: 'hola observer',
    kind: 'text',
    fromMe: false,
    isGroup: false,
    ...overrides,
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new FakeSink();
  const service = new ObserverService(chats, sink);
  return { db, chats, sink, service };
}

test('observer ignores non-allowlisted chat without touching sink', async () => {
  const { db, sink, service } = setup();
  assert.deepEqual(await service.observe(message()), { status: 'ignored_not_allowed' });
  assert.equal(sink.rows.length, 0);
  db.close();
});

test('observer stores allowlisted direct text without transport or capability dependencies', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net', 'Trabajo');
  assert.deepEqual(await service.observe(message()), {
    status: 'stored',
    chatJid: '51922222222@s.whatsapp.net',
  });
  assert.deepEqual(sink.rows[0], {
    messageId: 'm1',
    chatJid: '51922222222@s.whatsapp.net',
    senderId: '51922222222@s.whatsapp.net',
    timestamp: 1_700_000_000,
    text: 'hola observer',
    kind: 'text',
    isGroup: false,
  });
  db.close();
});

test('observer canonicalizes to an allowlisted alternate PN/LID identity', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net');
  const result = await service.observe(message({
    chatId: '123456789@lid',
    chatIdAlt: '51922222222@s.whatsapp.net',
  }));
  assert.deepEqual(result, { status: 'stored', chatJid: '51922222222@s.whatsapp.net' });
  assert.equal(sink.rows[0]?.chatJid, '51922222222@s.whatsapp.net');
  db.close();
});

test('observer supports allowlisted group text but does not imply any reply path', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('120363123456789@g.us', 'Familia');
  const result = await service.observe(message({
    chatId: '120363123456789@g.us',
    senderId: '51933333333@s.whatsapp.net',
    isGroup: true,
  }));
  assert.deepEqual(result, { status: 'stored', chatJid: '120363123456789@g.us' });
  assert.equal(sink.rows[0]?.isGroup, true);
  db.close();
});

test('observer ignores media without invoking lazy media loader', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net');
  let mediaLoaded = false;
  const result = await service.observe(message({
    kind: 'audio',
    text: '',
    loadMedia: async () => {
      mediaLoaded = true;
      return { data: new Uint8Array([1]) };
    },
  }));
  assert.deepEqual(result, { status: 'ignored_non_text' });
  assert.equal(mediaLoaded, false);
  assert.equal(sink.rows.length, 0);
  db.close();
});

test('observer bounds text and duplicate sink insertions are idempotent', async () => {
  const { db, chats, sink, service } = setup();
  chats.enable('51922222222@s.whatsapp.net');
  const long = 'x'.repeat(5_000);
  assert.equal((await service.observe(message({ text: long }))).status, 'stored');
  assert.equal(sink.rows[0]?.text.length, 4_000);
  assert.match(sink.rows[0]?.text ?? '', /…$/);
  assert.equal((await service.observe(message({ text: long }))).status, 'duplicate');
  assert.equal(sink.rows.length, 1);
  db.close();
});
