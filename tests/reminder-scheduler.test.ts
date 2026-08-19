import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendTextResult } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';
import { ReminderScheduler } from '../src/scheduler/reminder-scheduler.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';

class FakeTransport implements MessageTransport {
  readonly name = 'fake';
  sent: Array<{ destination: string; text: string }> = [];
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(_handler: IncomingMessageHandler): void {}
  getState(): string { return 'open'; }
  async sendText(destination: string, text: string): Promise<SendTextResult> {
    this.sent.push({ destination, text });
    return { messageId: `out-${this.sent.length}` };
  }
}

test('scheduler delivers due reminder once, marks it delivered and audits delivery', async () => {
  const db = new AppDatabase(':memory:');
  const reminders = new ReminderRepository(db);
  const audit = new AuditRepository(db);
  reminders.create({
    body: 'pagar tarjeta',
    dueAt: '2026-08-19T15:00:00.000Z',
    chatId: '51999999999@s.whatsapp.net',
  });
  const transport = new FakeTransport();
  const scheduler = new ReminderScheduler(
    reminders,
    transport,
    () => new Date('2026-08-19T15:01:00.000Z'),
    audit,
  );
  await scheduler.runOnce();
  await scheduler.runOnce();
  assert.deepEqual(transport.sent, [
    { destination: '51999999999@s.whatsapp.net', text: '⏰ Recordatorio: pagar tarjeta' },
  ]);
  assert.equal(reminders.listPending().length, 0);
  assert.equal(audit.listRecent()[0]?.eventType, 'reminder.delivered');
  db.close();
});

test('failed delivery remains pending for retry', async () => {
  const db = new AppDatabase(':memory:');
  const reminders = new ReminderRepository(db);
  reminders.create({
    body: 'llamar a Juan',
    dueAt: '2026-08-19T15:00:00.000Z',
    chatId: '51999999999@s.whatsapp.net',
  });
  const transport: MessageTransport = {
    name: 'failing',
    connect: async () => undefined,
    disconnect: async () => undefined,
    onMessage: () => undefined,
    getState: () => 'closed',
    sendText: async () => { throw new Error('offline'); },
  };
  const scheduler = new ReminderScheduler(reminders, transport, () => new Date('2026-08-19T15:01:00.000Z'));
  await scheduler.runOnce();
  assert.equal(reminders.listPending().length, 1);
  db.close();
});
