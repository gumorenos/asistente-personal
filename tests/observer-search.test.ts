import assert from 'node:assert/strict';
import test from 'node:test';
import { ObserverSearchCapability } from '../src/capabilities/observer-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { SqliteObservationSink } from '../src/observer/sqlite-observation-sink.ts';

const SELF_JID = '51911111111@s.whatsapp.net';
const CHAT_A = '51922222222@s.whatsapp.net';
const CHAT_B = '51933333333@s.whatsapp.net';

function command(text: string): IncomingMessage {
  return {
    id: 'cmd-1',
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp: 1_777_000_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function saveObservation(sink: SqliteObservationSink, chatJid: string, id: string, text: string, timestamp: number): void {
  sink.save({
    chatJid,
    messageId: id,
    senderId: chatJid,
    timestamp,
    text,
    kind: 'text',
    isGroup: false,
  });
}

test('observer FTS search is scoped to one exact JID', () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  chats.upsert(CHAT_A, 'A');
  chats.upsert(CHAT_B, 'B');

  saveObservation(sink, CHAT_A, 'a1', 'proyecto orion presupuesto aprobado', 1_776_000_001);
  saveObservation(sink, CHAT_B, 'b1', 'proyecto orion secreto chat b', 1_776_000_002);

  const results = sink.search(CHAT_A, 'orion');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.chatJid, CHAT_A);
  assert.match(results[0]?.text ?? '', /presupuesto aprobado/);
  assert.doesNotMatch(results[0]?.text ?? '', /secreto chat b/);
  db.close();
});

test('observer search capability requires an administratively known exact JID and audits no query content', async () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const audit = new AuditRepository(db);
  chats.upsert(CHAT_A, 'Trabajo');
  saveObservation(sink, CHAT_A, 'a1', 'palabrasecreta contrato cliente', 1_776_000_001);

  const capability = new ObserverSearchCapability(chats, sink, audit, 'America/Lima');
  const unknown = await capability.handle(command('busca observaciones 51999999999@s.whatsapp.net contrato'));
  assert.match(unknown?.reply ?? '', /No existe ese JID/);

  const found = await capability.handle(command(`busca observaciones ${CHAT_A} palabrasecreta`));
  assert.equal(found?.handled, true);
  assert.match(found?.reply ?? '', /palabrasecreta/);
  assert.match(found?.reply ?? '', /Trabajo/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /observer\.search/);
  assert.doesNotMatch(auditJson, /palabrasecreta|contrato cliente|51922222222/);
  db.close();
});

test('disabled observed chat remains searchable only for retained local rows', async () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const audit = new AuditRepository(db);
  chats.upsert(CHAT_A, 'Archivado');
  saveObservation(sink, CHAT_A, 'a1', 'historial retenido alfa', 1_776_000_001);
  chats.disable(CHAT_A);

  const capability = new ObserverSearchCapability(chats, sink, audit, 'America/Lima');
  const result = await capability.handle(command(`busca observaciones ${CHAT_A} historial`));
  assert.match(result?.reply ?? '', /historial retenido/);
  assert.match(result?.reply ?? '', /chat deshabilitado/);
  db.close();
});

test('observer purge removes matching FTS rows through trigger', () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  chats.upsert(CHAT_A, 'Temporal', 1);
  saveObservation(sink, CHAT_A, 'old', 'expirafts mañana', 1_700_000_000);
  assert.equal(sink.search(CHAT_A, 'expirafts').length, 1);

  sink.purgeExpired(1_800_000_000);
  assert.equal(sink.search(CHAT_A, 'expirafts').length, 0);
  db.close();
});
