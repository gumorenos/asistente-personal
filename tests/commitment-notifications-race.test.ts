import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendTextResult } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { CommitmentNotificationScheduler } from '../src/scheduler/commitment-notification-scheduler.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';

const SELF_JID = '51999999999@s.whatsapp.net';
const fixedNow = new Date('2026-08-24T15:00:00.000Z');

class FirstSendBlockingTransport implements MessageTransport {
  readonly name = 'blocking';
  sent: string[] = [];
  started = 0;
  private releaseFirst?: () => void;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(_handler: IncomingMessageHandler): void {}
  getState(): string { return 'open'; }

  async sendText(_destination: string, text: string): Promise<SendTextResult> {
    this.started += 1;
    if (this.started === 1) {
      await new Promise<void>((resolve) => { this.releaseFirst = resolve; });
    }
    this.sent.push(text);
    return { messageId: `out-${this.sent.length}` };
  }

  release(): void { this.releaseFirst?.(); }
}

test('scheduler revalidates later rows from the batch before sending them', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const transport = new FirstSendBlockingTransport();
    const first = commitments.create({ body: 'first', dueAt: '2026-08-24T13:00:00.000Z' });
    const second = commitments.create({ body: 'second', dueAt: '2026-08-24T14:00:00.000Z' });
    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);

    const run = scheduler.runOnce();
    while (transport.started === 0) await new Promise((resolve) => setImmediate(resolve));

    assert.equal(commitments.setStatus(second, 'completed'), true);
    transport.release();
    await run;

    assert.equal(transport.sent.length, 1);
    assert.match(transport.sent[0] ?? '', new RegExp(`#${first} first`));
    assert.doesNotMatch(transport.sent[0] ?? '', /second/);
    assert.equal(commitments.getById(first)?.notifiedAt, fixedNow.toISOString());
    assert.equal(commitments.getById(second)?.notifiedAt, undefined);
  } finally {
    db.close();
  }
});
