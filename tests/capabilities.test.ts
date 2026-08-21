import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalCapabilities } from '../src/capabilities/local-capabilities.ts';
import { parseExpense, parseNote, parseReminder } from '../src/capabilities/parsers.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';

const fixedNow = new Date('2026-08-19T02:42:00.000Z'); // 2026-08-18 21:42 America/Lima

function message(text: string): IncomingMessage {
  return {
    id: `m-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const expenses = new ExpenseRepository(db);
  const reminders = new ReminderRepository(db);
  const audit = new AuditRepository(db);
  const capabilities = new LocalCapabilities(notes, reminders, expenses, audit, 'America/Lima', () => fixedNow);
  return { db, notes, expenses, reminders, audit, capabilities };
}

test('parses notes and categorized PEN expenses deterministically', () => {
  assert.equal(parseNote('anota comprar filtro de agua'), 'comprar filtro de agua');
  assert.deepEqual(parseExpense('gasté S/ 78.50 en taxi al aeropuerto #transporte'), {
    amountMinor: 7850,
    currency: 'PEN',
    description: 'taxi al aeropuerto',
    category: 'transporte',
  });
});

test('parses future reminders in configured timezone', () => {
  assert.deepEqual(
    parseReminder('recuérdame mañana a las 10 pagar la tarjeta', fixedNow, 'America/Lima'),
    { body: 'pagar la tarjeta', dueAt: '2026-08-19T15:00:00.000Z' },
  );
  assert.deepEqual(
    parseReminder('recuérdame en 30 minutos revisar horno', fixedNow, 'America/Lima'),
    { body: 'revisar horno', dueAt: '2026-08-19T03:12:00.000Z' },
  );
  assert.deepEqual(
    parseReminder('recuérdame viernes a las 16 llamar a Pedro', fixedNow, 'America/Lima'),
    { body: 'llamar a Pedro', dueAt: '2026-08-21T21:00:00.000Z' },
  );
});

test('invalid or past explicit schedule is not silently stored as an undated reminder', () => {
  assert.equal(parseReminder('recuérdame hoy a las 25 pagar Visa', fixedNow, 'America/Lima')?.invalidSchedule, true);
  assert.equal(parseReminder('recuérdame 2026-02-31 10:00 imposible', fixedNow, 'America/Lima')?.invalidSchedule, true);
});

test('local capabilities persist note, expense and reminder and audit mutations', async () => {
  const { db, notes, expenses, reminders, audit, capabilities } = setup();
  assert.match((await capabilities.handle(message('anota comprar café')))?.reply ?? '', /Nota #1 guardada/);
  assert.match((await capabilities.handle(message('gasté 25,50 soles en taxi #transporte')))?.reply ?? '', /S\/ 25\.50 en taxi \[transporte\]/);
  assert.match((await capabilities.handle(message('recuérdame mañana a las 10 pagar Visa')))?.reply ?? '', /Recordatorio #1 creado/);
  assert.equal(notes.listActive().length, 1);
  assert.equal(expenses.listRecent()[0]?.category, 'transporte');
  assert.equal(reminders.listPending()[0]?.dueAt, '2026-08-19T15:00:00.000Z');
  assert.deepEqual(audit.listRecent().map((row) => row.eventType), ['reminder.created', 'expense.created', 'note.created']);
  db.close();
});

test('note and reminder lifecycle commands are soft state transitions', async () => {
  const { db, notes, reminders, capabilities } = setup();
  await capabilities.handle(message('anota llevar documentos'));
  await capabilities.handle(message('recuérdame revisar presupuesto'));
  assert.match((await capabilities.handle(message('completa nota #1')))?.reply ?? '', /completada/);
  assert.match((await capabilities.handle(message('cancela recordatorio #1')))?.reply ?? '', /cancelado/);
  assert.equal(notes.listActive().length, 0);
  assert.equal(reminders.listPending().length, 0);
  db.close();
});

test('expense can be categorized after capture', async () => {
  const { db, expenses, capabilities } = setup();
  await capabilities.handle(message('gasté 12 soles en café'));
  assert.match((await capabilities.handle(message('categoriza gasto #1 como comida')))?.reply ?? '', /comida/);
  assert.equal(expenses.listRecent()[0]?.category, 'comida');
  db.close();
});

test('expense period listing and monthly summary use local timezone boundaries', async () => {
  const { db, expenses, capabilities } = setup();
  expenses.create({ amountMinor: 1000, currency: 'PEN', category: 'comida', occurredAt: '2026-08-18T04:30:00.000Z' });
  expenses.create({ amountMinor: 2000, currency: 'PEN', category: 'transporte', occurredAt: '2026-08-19T02:30:00.000Z' });
  const today = (await capabilities.handle(message('gastos hoy')))?.reply ?? '';
  assert.doesNotMatch(today, /10\.00/);
  assert.match(today, /20\.00/);
  const summary = (await capabilities.handle(message('resumen gastos mes')))?.reply ?? '';
  assert.match(summary, /Total: S\/ 30\.00 en 2 gastos/);
  assert.match(summary, /comida: S\/ 10\.00/);
  assert.match(summary, /transporte: S\/ 20\.00/);
  db.close();
});

test('list commands return only active local state', async () => {
  const { db, capabilities } = setup();
  await capabilities.handle(message('anota llevar documentos'));
  await capabilities.handle(message('gasté 12 soles en café'));
  await capabilities.handle(message('recuérdame revisar presupuesto'));
  assert.match((await capabilities.handle(message('notas')))?.reply ?? '', /llevar documentos/);
  assert.match((await capabilities.handle(message('gastos')))?.reply ?? '', /12\.00/);
  assert.match((await capabilities.handle(message('recordatorios')))?.reply ?? '', /revisar presupuesto/);
  db.close();
});

test('oversized local command is rejected without persistence', async () => {
  const { db, notes, capabilities } = setup();
  const reply = (await capabilities.handle(message(`anota ${'x'.repeat(2_100)}`)))?.reply ?? '';
  assert.match(reply, /demasiado largo/);
  assert.equal(notes.listActive().length, 0);
  db.close();
});

test('local command bound does not intercept an explicit AI request owned by the next capability', async () => {
  const { db, capabilities } = setup();
  assert.equal(await capabilities.handle(message(`ia ${'x'.repeat(2_100)}`)), undefined);
  db.close();
});
