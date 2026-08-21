import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySearchCapability } from '../src/capabilities/memory-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';

const SELF_JID = '51911111111@s.whatsapp.net';
const fixedNow = new Date('2026-08-21T15:00:00.000Z'); // 10:00 America/Lima

function command(text: string): IncomingMessage {
  return {
    id: `cmd-${text}`,
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp: Math.floor(fixedNow.getTime() / 1_000),
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function seedExpenses(expenses: ExpenseRepository): void {
  for (const [description, occurredAt] of [
    ['taxi-old', '2026-08-21T04:59:59.000Z'],
    ['taxi-start', '2026-08-21T05:00:00.000Z'],
    ['taxi-end', '2026-08-22T04:59:59.000Z'],
    ['taxi-tomorrow', '2026-08-22T05:00:00.000Z'],
  ] as const) {
    expenses.create({
      amountMinor: 1000,
      currency: 'PEN',
      description,
      category: 'movilidad',
      occurredAt,
    });
  }
}

test('repository temporal bounds are inclusive start and exclusive end', () => {
  const db = new AppDatabase(':memory:');
  const expenses = new ExpenseRepository(db);
  const search = new LocalMemorySearchRepository(db);
  seedExpenses(expenses);

  const start = Math.floor(new Date('2026-08-21T05:00:00.000Z').getTime() / 1_000);
  const end = Math.floor(new Date('2026-08-22T05:00:00.000Z').getTime() / 1_000);
  const rows = search.search('taxi', {
    source: 'expense',
    fromEpochSeconds: start,
    toEpochSeconds: end,
    limit: 10,
  });

  assert.equal(rows.length, 2);
  const text = rows.map((row) => row.text).join('\n');
  assert.match(text, /taxi-start/);
  assert.match(text, /taxi-end/);
  assert.doesNotMatch(text, /taxi-old|taxi-tomorrow/);
  db.close();
});

test('busca gastos hoy uses America/Lima local-day boundaries', async () => {
  const db = new AppDatabase(':memory:');
  const expenses = new ExpenseRepository(db);
  const search = new LocalMemorySearchRepository(db);
  const audit = new AuditRepository(db);
  seedExpenses(expenses);

  const capability = new MemorySearchCapability(search, audit, 'America/Lima', () => fixedNow);
  const result = await capability.handle(command('busca gastos hoy taxi'));
  const reply = result?.reply ?? '';

  assert.match(reply, /gastos · hoy/);
  assert.match(reply, /taxi-start/);
  assert.match(reply, /taxi-end/);
  assert.doesNotMatch(reply, /taxi-old|taxi-tomorrow/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /"temporalScope":"day"/);
  assert.doesNotMatch(auditJson, /taxi|2026-08-21/);
  db.close();
});

test('custom date range is user-inclusive and timezone-aware', async () => {
  const db = new AppDatabase(':memory:');
  const expenses = new ExpenseRepository(db);
  const search = new LocalMemorySearchRepository(db);
  const audit = new AuditRepository(db);
  seedExpenses(expenses);

  const capability = new MemorySearchCapability(search, audit, 'America/Lima', () => fixedNow);
  const result = await capability.handle(command('busca gastos desde 2026-08-20 hasta 2026-08-21 taxi'));
  const reply = result?.reply ?? '';

  assert.match(reply, /2026-08-20 → 2026-08-21/);
  assert.match(reply, /taxi-old/);
  assert.match(reply, /taxi-start/);
  assert.match(reply, /taxi-end/);
  assert.doesNotMatch(reply, /taxi-tomorrow/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /"temporalScope":"custom"/);
  assert.doesNotMatch(auditJson, /2026-08-20|2026-08-21|taxi/);
  db.close();
});

test('invalid and reversed custom date ranges fail without running a search', async () => {
  const db = new AppDatabase(':memory:');
  const search = new LocalMemorySearchRepository(db);
  const audit = new AuditRepository(db);
  const capability = new MemorySearchCapability(search, audit, 'America/Lima', () => fixedNow);

  const invalid = await capability.handle(command('busca desde 2026-02-30 hasta 2026-03-01 prueba'));
  assert.match(invalid?.reply ?? '', /Rango de fechas inválido/);

  const reversed = await capability.handle(command('busca desde 2026-08-22 hasta 2026-08-20 prueba'));
  assert.match(reversed?.reply ?? '', /“desde” debe ser anterior o igual/);

  assert.equal(audit.listRecent().length, 0);
  db.close();
});

test('repository rejects malformed temporal bounds', () => {
  const db = new AppDatabase(':memory:');
  const search = new LocalMemorySearchRepository(db);
  assert.throws(() => search.search('algo', { fromEpochSeconds: -1 }), /Invalid local memory search start/);
  assert.throws(() => search.search('algo', { fromEpochSeconds: 20, toEpochSeconds: 10 }), /Invalid local memory search range/);
  db.close();
});
