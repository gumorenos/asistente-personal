import assert from 'node:assert/strict';
import test from 'node:test';
import { BriefingService } from '../src/briefing/briefing-service.ts';
import { BriefingCapability } from '../src/capabilities/briefing-capability.ts';
import type { IncomingMessage, SendTextResult } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { BriefingDeliveryRepository } from '../src/database/briefing-delivery-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';
import { BriefingScheduler } from '../src/scheduler/briefing-scheduler.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';

const fixedNow = new Date('2026-08-19T13:30:00.000Z'); // 08:30 Lima

function message(text: string): IncomingMessage {
  return { id: `b-${text}`, chatId: 'self@s.whatsapp.net', timestamp: 1, text, kind: 'text', fromMe: true, isGroup: false };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const notes = new NoteRepository(db);
  const reminders = new ReminderRepository(db);
  const commitments = new CommitmentRepository(db);
  const expenses = new ExpenseRepository(db);
  const actions = new ActionRequestRepository(db);
  const audit = new AuditRepository(db);
  const deliveries = new BriefingDeliveryRepository(db);
  const service = new BriefingService(notes, reminders, commitments, expenses, actions, 'America/Lima');
  return { db, notes, reminders, commitments, expenses, actions, audit, deliveries, service };
}

class FakeTransport implements MessageTransport {
  readonly name = 'fake';
  sent: Array<{ destination: string; text: string }> = [];
  failNext = false;
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(_handler: IncomingMessageHandler): void {}
  getState(): string { return 'open'; }
  async sendText(destination: string, text: string): Promise<SendTextResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('offline');
    }
    this.sent.push({ destination, text });
    return { messageId: `out-${this.sent.length}` };
  }
}

test('briefing renders local state including commitments without exposing action payload', () => {
  const { db, notes, reminders, commitments, expenses, actions, service } = setup();
  notes.create('llevar documentos');
  reminders.create({ body: 'pagar tarjeta', dueAt: '2026-08-20T15:00:00.000Z', chatId: 'self@s.whatsapp.net' });
  commitments.create({ body: 'enviar informe', dueAt: '2026-08-19T12:00:00.000Z' });
  expenses.create({ amountMinor: 2500, currency: 'PEN', category: 'comida', description: 'almuerzo', occurredAt: fixedNow.toISOString() });
  actions.create({ actionType: 'calendar.create_event', summary: 'Crear reunión mañana', payload: { secret: 'NO_MOSTRAR' } });

  const text = service.render(fixedNow);
  assert.match(text, /llevar documentos/);
  assert.match(text, /pagar tarjeta/);
  assert.match(text, /enviar informe/);
  assert.match(text, /vencido/);
  assert.match(text, /S\/ 25\.00/);
  assert.match(text, /Crear reunión mañana/);
  assert.doesNotMatch(text, /NO_MOSTRAR/);
  db.close();
});

test('briefing capability is explicit and deterministic', async () => {
  const { db, service } = setup();
  const capability = new BriefingCapability(service, () => fixedNow);
  assert.equal(await capability.handle(message('hola')), undefined);
  assert.match((await capability.handle(message('briefing')))?.reply ?? '', /Briefing personal/);
  db.close();
});

test('scheduler does not deliver before configured local time', async () => {
  const { db, service, deliveries, audit } = setup();
  const transport = new FakeTransport();
  const before = () => new Date('2026-08-19T12:59:00.000Z'); // 07:59 Lima
  const scheduler = new BriefingScheduler(service, deliveries, transport, audit, 'self@s.whatsapp.net', 'America/Lima', { hour: 8, minute: 0 }, before);
  await scheduler.runOnce();
  assert.equal(transport.sent.length, 0);
  assert.equal(deliveries.hasDelivered('2026-08-19'), false);
  db.close();
});

test('scheduler delivers once per local date and persists delivery', async () => {
  const { db, service, deliveries, audit } = setup();
  const transport = new FakeTransport();
  const scheduler = new BriefingScheduler(service, deliveries, transport, audit, 'self@s.whatsapp.net', 'America/Lima', { hour: 8, minute: 0 }, () => fixedNow);
  await scheduler.runOnce();
  await scheduler.runOnce();
  assert.equal(transport.sent.length, 1);
  assert.equal(deliveries.get('2026-08-19')?.messageId, 'out-1');
  assert.match(JSON.stringify(audit.listRecent()), /briefing\.delivered/);
  db.close();
});

test('failed briefing delivery remains eligible for retry', async () => {
  const { db, service, deliveries, audit } = setup();
  const transport = new FakeTransport();
  transport.failNext = true;
  const scheduler = new BriefingScheduler(service, deliveries, transport, audit, 'self@s.whatsapp.net', 'America/Lima', { hour: 8, minute: 0 }, () => fixedNow);
  await scheduler.runOnce();
  assert.equal(deliveries.hasDelivered('2026-08-19'), false);
  await scheduler.runOnce();
  assert.equal(transport.sent.length, 1);
  assert.equal(deliveries.hasDelivered('2026-08-19'), true);
  db.close();
});

test('scheduler can deliver again on the next local date', async () => {
  const { db, service, deliveries, audit } = setup();
  const transport = new FakeTransport();
  let now = fixedNow;
  const scheduler = new BriefingScheduler(service, deliveries, transport, audit, 'self@s.whatsapp.net', 'America/Lima', { hour: 8, minute: 0 }, () => now);
  await scheduler.runOnce();
  now = new Date('2026-08-20T13:30:00.000Z');
  await scheduler.runOnce();
  assert.equal(transport.sent.length, 2);
  assert.equal(deliveries.hasDelivered('2026-08-19'), true);
  assert.equal(deliveries.hasDelivered('2026-08-20'), true);
  db.close();
});
