import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalCapabilities } from '../src/capabilities/local-capabilities.ts';
import { parseExpense, parseNote, parseReminder } from '../src/capabilities/parsers.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';

const fixedNow = new Date('2026-08-19T02:42:00.000Z'); // 2026-08-18 21:42 America/Lima

function message(text: string): IncomingMessage {
  return {
    id: `m-${text}`,
    chatId: 'self@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('parses notes and PEN expenses deterministically', () => {
  assert.equal(parseNote('anota comprar filtro de agua'), 'comprar filtro de agua');
  assert.deepEqual(parseExpense('gasté S/ 78.50 en supermercado'), {
    amountMinor: 7850,
    currency: 'PEN',
    description: 'supermercado',
  });
});

test('parses mañana reminder in configured timezone', () => {
  assert.deepEqual(
    parseReminder('recuérdame mañana a las 10 pagar la tarjeta', fixedNow, 'America/Lima'),
    {
      body: 'pagar la tarjeta',
      dueAt: '2026-08-19T15:00:00.000Z',
    },
  );
});

test('local capabilities persist note, expense and reminder', async () => {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const expenses = new ExpenseRepository(db);
  const reminders = new ReminderRepository(db);
  const capabilities = new LocalCapabilities(
    notes,
    reminders,
    expenses,
    'America/Lima',
    () => fixedNow,
  );

  assert.match((await capabilities.handle(message('anota comprar café')))?.reply ?? '', /Nota #1 guardada/);
  assert.match((await capabilities.handle(message('gasté 25,50 soles en taxi')))?.reply ?? '', /S\/ 25\.50 en taxi/);
  assert.match((await capabilities.handle(message('recuérdame mañana a las 10 pagar Visa')))?.reply ?? '', /Recordatorio #1 creado/);

  assert.equal(notes.listActive().length, 1);
  assert.equal(expenses.listRecent()[0]?.amountMinor, 2550);
  assert.equal(reminders.listPending()[0]?.dueAt, '2026-08-19T15:00:00.000Z');
  db.close();
});

test('list commands return stored local state', async () => {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const expenses = new ExpenseRepository(db);
  const reminders = new ReminderRepository(db);
  const capabilities = new LocalCapabilities(notes, reminders, expenses, 'America/Lima', () => fixedNow);

  await capabilities.handle(message('anota llevar documentos'));
  await capabilities.handle(message('gasté 12 soles en café'));
  await capabilities.handle(message('recuérdame revisar presupuesto'));

  assert.match((await capabilities.handle(message('notas')))?.reply ?? '', /llevar documentos/);
  assert.match((await capabilities.handle(message('gastos')))?.reply ?? '', /12\.00/);
  assert.match((await capabilities.handle(message('recordatorios')))?.reply ?? '', /revisar presupuesto/);
  db.close();
});
