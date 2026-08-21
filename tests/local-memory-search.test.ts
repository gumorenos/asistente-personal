import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySearchCapability } from '../src/capabilities/memory-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { RetentionRepository } from '../src/database/retention-repository.ts';
import { SqliteObservationSink } from '../src/observer/sqlite-observation-sink.ts';
import { compileFtsQuery } from '../src/search/fts-query.ts';

const SELF_JID = '51911111111@s.whatsapp.net';

function incoming(id: string, text: string, timestamp = 1_777_000_000): IncomingMessage {
  return {
    id,
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('migration v12 creates separate self and observer FTS5 indexes', () => {
  const db = new AppDatabase(':memory:');
  const rows = db.native.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('self_memory_fts', 'observation_fts')
    ORDER BY name
  `).all() as Array<{ name: string }>;
  assert.deepEqual(rows.map((row) => row.name), ['observation_fts', 'self_memory_fts']);
  const migration = db.native.prepare('SELECT 1 AS found FROM schema_migrations WHERE version = 12').get() as { found: number } | undefined;
  assert.equal(migration?.found, 1);
  db.close();
});

test('safe FTS compiler strips syntax into bounded literal prefix tokens', () => {
  const compiled = compileFtsQuery('  reunión OR (Álvaro) !!! reunión  ');
  assert.equal(compiled?.tokenCount, 3);
  assert.equal(compiled?.expression, '"reunión"* AND "or"* AND "álvaro"*');
  assert.equal(compileFtsQuery('!!!'), undefined);
  assert.equal(compileFtsQuery('x'.repeat(201)), undefined);
});

test('local memory finds self messages and notes with prefix and diacritic-insensitive matching', () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const notes = new NoteRepository(db);
  const search = new LocalMemorySearchRepository(db);

  messages.saveIncoming(incoming('m1', 'Comprar filtro de agua para la cocina', 1_776_000_000));
  notes.create('Reunión con Álvaro sobre presupuesto anual');

  const filter = search.search('filt agua');
  assert.equal(filter.length, 1);
  assert.equal(filter[0]?.source, 'message');
  assert.match(filter[0]?.text ?? '', /filtro de agua/);

  const meeting = search.search('reun alv');
  assert.equal(meeting.length, 1);
  assert.equal(meeting[0]?.source, 'note');
  assert.match(meeting[0]?.text ?? '', /Álvaro/);
  db.close();
});

test('local memory excludes the current search command and never crosses into Observer index', async () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const notes = new NoteRepository(db);
  const audit = new AuditRepository(db);
  const search = new LocalMemorySearchRepository(db);
  const chats = new ObservedChatRepository(db);
  const observer = new SqliteObservationSink(db);
  const observerJid = '51922222222@s.whatsapp.net';

  notes.create('clavepersonal presupuesto casa');
  chats.enable(observerJid, 'Trabajo');
  observer.save({
    chatJid: observerJid,
    messageId: 'obs-1',
    senderId: observerJid,
    timestamp: 1_776_000_100,
    text: 'secretoobservado presupuesto cliente',
    kind: 'text',
    isGroup: false,
  });

  assert.equal(search.search('secretoobservado').length, 0);

  const command = incoming('search-command', 'busca presupuesto', 1_777_000_100);
  messages.saveIncoming(command);
  const capability = new MemorySearchCapability(search, audit, 'America/Lima');
  const result = await capability.handle(command);

  assert.equal(result?.handled, true);
  assert.match(result?.reply ?? '', /clavepersonal/);
  assert.doesNotMatch(result?.reply ?? '', /busca presupuesto/);
  assert.doesNotMatch(result?.reply ?? '', /secretoobservado/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /memory\.search/);
  assert.doesNotMatch(auditJson, /presupuesto|clavepersonal|secretoobservado/);
  db.close();
});

test('message retention deletion removes its FTS entry through trigger', () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const search = new LocalMemorySearchRepository(db);
  const retention = new RetentionRepository(db);

  messages.saveIncoming(incoming('old', 'datoexpirable antiguo', 1_700_000_000));
  assert.equal(search.search('datoexpirable').length, 1);

  retention.purge({
    messageBeforeEpochSeconds: 1_750_000_000,
    whatsappBeforeIso: '2000-01-01T00:00:00.000Z',
    outboundBeforeIso: '2000-01-01T00:00:00.000Z',
    auditBeforeIso: '2000-01-01T00:00:00.000Z',
    briefingBeforeIso: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(search.search('datoexpirable').length, 0);
  db.close();
});
