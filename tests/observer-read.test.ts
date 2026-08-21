import assert from 'node:assert/strict';
import test from 'node:test';
import { ObserverReadCapability } from '../src/capabilities/observer-read-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { SqliteObservationSink } from '../src/observer/sqlite-observation-sink.ts';

function message(text: string): IncomingMessage {
  return {
    id: `read-${text}`,
    chatId: '51911111111@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const audit = new AuditRepository(db);
  const capability = new ObserverReadCapability(chats, sink, audit, 'America/Lima');
  return { db, chats, sink, audit, capability };
}

test('observer read capability is explicit-only', async () => {
  const { db, capability } = setup();
  assert.equal(await capability.handle(message('hola')), undefined);
  db.close();
});

test('observer read requires an administratively known exact JID', async () => {
  const { db, capability } = setup();
  assert.match((await capability.handle(message('observaciones invalid')))?.reply ?? '', /JID inválido/);
  assert.match(
    (await capability.handle(message('observaciones 51922222222@s.whatsapp.net')))?.reply ?? '',
    /No existe ese JID/,
  );
  db.close();
});

test('observer read returns recent rows only for the requested chat and audits no content', async () => {
  const { db, chats, sink, audit, capability } = setup();
  const jid = '51922222222@s.whatsapp.net';
  const other = '51933333333@s.whatsapp.net';
  chats.enable(jid, 'Trabajo');
  chats.enable(other, 'Otro');
  sink.save({ messageId: 'm1', chatJid: jid, timestamp: 1_777_000_000, text: 'secreto uno', kind: 'text', isGroup: false });
  sink.save({ messageId: 'm2', chatJid: jid, timestamp: 1_777_000_100, text: 'secreto dos', kind: 'text', isGroup: false });
  sink.save({ messageId: 'm3', chatJid: other, timestamp: 1_777_000_200, text: 'otro secreto', kind: 'text', isGroup: false });

  const reply = (await capability.handle(message(`observaciones ${jid} 1`)))?.reply ?? '';
  assert.match(reply, /Trabajo/);
  assert.match(reply, /secreto dos/);
  assert.doesNotMatch(reply, /secreto uno|otro secreto/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /observer\.read/);
  assert.doesNotMatch(auditJson, /secreto uno|secreto dos|otro secreto|51922222222|Trabajo/);
  db.close();
});

test('observer read rejects oversized row count and bounds individual text', async () => {
  const { db, chats, sink, capability } = setup();
  const jid = '51922222222@s.whatsapp.net';
  chats.enable(jid);
  sink.save({
    messageId: 'long',
    chatJid: jid,
    timestamp: 1_777_000_000,
    text: `inicio ${'x'.repeat(800)}`,
    kind: 'text',
    isGroup: false,
  });

  assert.match((await capability.handle(message(`observaciones ${jid} 11`)))?.reply ?? '', /entre 1 y 10/);
  const reply = (await capability.handle(message(`observaciones ${jid}`)))?.reply ?? '';
  assert.ok(reply.length < 700);
  assert.match(reply, /inicio/);
  assert.match(reply, /…/);
  db.close();
});

test('observer read can inspect retained rows after chat is disabled but reports the state', async () => {
  const { db, chats, sink, capability } = setup();
  const jid = '51922222222@s.whatsapp.net';
  chats.enable(jid, 'Anterior');
  sink.save({ messageId: 'old', chatJid: jid, timestamp: 1_777_000_000, text: 'histórico', kind: 'text', isGroup: false });
  chats.disable(jid);

  const reply = (await capability.handle(message(`observaciones ${jid}`)))?.reply ?? '';
  assert.match(reply, /chat deshabilitado/);
  assert.match(reply, /histórico/);
  db.close();
});
