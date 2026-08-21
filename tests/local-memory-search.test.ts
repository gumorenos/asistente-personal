import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySearchCapability } from '../src/capabilities/memory-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';
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

test('migrations v12/v13 install isolated FTS5 indexes and structured self-memory extension', () => {
  const db = new AppDatabase(':memory:');
  const rows = db.native.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('self_memory_fts', 'observation_fts')
    ORDER BY name
  `).all() as Array<{ name: string }>;
  assert.deepEqual(rows.map((row) => row.name), ['observation_fts', 'self_memory_fts']);
  for (const version of [12, 13]) {
    const migration = db.native.prepare('SELECT 1 AS found FROM schema_migrations WHERE version = ?').get(version) as { found: number } | undefined;
    assert.equal(migration?.found, 1);
  }
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

test('Stage 3B indexes reminders and expenses and updates expense category search', () => {
  const db = new AppDatabase(':memory:');
  const reminders = new ReminderRepository(db);
  const expenses = new ExpenseRepository(db);
  const search = new LocalMemorySearchRepository(db);

  const reminderId = reminders.create({
    body: 'Pagar Visa del banco',
    dueAt: '2026-08-25T15:00:00.000Z',
    chatId: SELF_JID,
  });
  const expenseId = expenses.create({
    amountMinor: 7850,
    currency: 'PEN',
    description: 'Taxi al aeropuerto',
    category: 'transporte',
    occurredAt: '2026-08-21T13:00:00.000Z',
  });

  const reminder = search.search('visa', { source: 'reminder' });
  assert.equal(reminder.length, 1);
  assert.equal(reminder[0]?.sourceId, String(reminderId));

  const expense = search.search('taxi transporte', { source: 'expense' });
  assert.equal(expense.length, 1);
  assert.equal(expense[0]?.sourceId, String(expenseId));
  assert.match(expense[0]?.text ?? '', /PEN 78\.50/);

  assert.equal(expenses.setCategory(expenseId, 'movilidad'), true);
  assert.equal(search.search('transporte', { source: 'expense' }).length, 0);
  assert.equal(search.search('movilidad 78.50', { source: 'expense' }).length, 1);
  db.close();
});

test('source filters prevent same-keyword mixing across self-memory types', () => {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const reminders = new ReminderRepository(db);
  const expenses = new ExpenseRepository(db);
  const search = new LocalMemorySearchRepository(db);

  notes.create('orion nota privada');
  reminders.create({ body: 'orion recordatorio', chatId: SELF_JID });
  expenses.create({
    amountMinor: 2500,
    currency: 'PEN',
    description: 'orion gasto',
    occurredAt: '2026-08-21T13:00:00.000Z',
  });

  assert.deepEqual(search.search('orion', { source: 'note' }).map((row) => row.source), ['note']);
  assert.deepEqual(search.search('orion', { source: 'reminder' }).map((row) => row.source), ['reminder']);
  assert.deepEqual(search.search('orion', { source: 'expense' }).map((row) => row.source), ['expense']);
  assert.equal(search.search('orion').length, 3);
  db.close();
});

test('typed memory commands search only the requested source and audit no query content', async () => {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const expenses = new ExpenseRepository(db);
  const audit = new AuditRepository(db);
  const search = new LocalMemorySearchRepository(db);

  notes.create('aeropuerto nota que no debe salir');
  expenses.create({
    amountMinor: 4200,
    currency: 'PEN',
    description: 'Taxi aeropuerto',
    category: 'movilidad',
    occurredAt: '2026-08-21T13:00:00.000Z',
  });

  const capability = new MemorySearchCapability(search, audit, 'America/Lima');
  const result = await capability.handle(incoming('cmd-expense', 'busca gastos aeropuerto'));
  assert.equal(result?.handled, true);
  assert.match(result?.reply ?? '', /Memoria local · gastos/);
  assert.match(result?.reply ?? '', /Gasto #/);
  assert.match(result?.reply ?? '', /Taxi aeropuerto/);
  assert.doesNotMatch(result?.reply ?? '', /nota que no debe salir/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /memory\.search/);
  assert.match(auditJson, /"source":"expense"/);
  assert.doesNotMatch(auditJson, /aeropuerto|Taxi/);
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
