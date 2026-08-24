import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommitmentNotificationConfig } from '../src/commitments/notification-config.ts';
import { loadConfig } from '../src/config.ts';
import type { SendTextResult } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { runStage6bMigration } from '../src/database/stage6b-migration.ts';
import { CommitmentNotificationScheduler } from '../src/scheduler/commitment-notification-scheduler.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';

const SELF_JID = '51999999999@s.whatsapp.net';
const fixedNow = new Date('2026-08-24T15:00:00.000Z');

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
      throw new Error('PRIVATE_NETWORK_ERROR');
    }
    this.sent.push({ destination, text });
    return { messageId: `out-${this.sent.length}` };
  }
}

class BlockingTransport extends FakeTransport {
  private releaseCurrent?: () => void;
  started = 0;

  override async sendText(destination: string, text: string): Promise<SendTextResult> {
    this.started += 1;
    await new Promise<void>((resolve) => { this.releaseCurrent = resolve; });
    return super.sendText(destination, text);
  }

  release(): void { this.releaseCurrent?.(); }
}

function enabledAppConfig() {
  return loadConfig({
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_SELF_JIDS: SELF_JID,
  });
}

test('commitment notifications are disabled by default and validate explicit self destination', () => {
  const disabled = loadCommitmentNotificationConfig(loadConfig({}), {});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.destinationJid, undefined);

  assert.throws(
    () => loadCommitmentNotificationConfig(loadConfig({}), { COMMITMENT_NOTIFICATIONS_ENABLED: 'true' }),
    /WHATSAPP_ENABLED=true/,
  );
  assert.throws(
    () => loadCommitmentNotificationConfig(enabledAppConfig(), { COMMITMENT_NOTIFICATIONS_ENABLED: 'true' }),
    /DESTINATION_JID is required/,
  );
  assert.throws(
    () => loadCommitmentNotificationConfig(enabledAppConfig(), {
      COMMITMENT_NOTIFICATIONS_ENABLED: 'true',
      COMMITMENT_NOTIFICATION_DESTINATION_JID: '51888888888@s.whatsapp.net',
    }),
    /must be present in WHATSAPP_SELF_JIDS/,
  );
  assert.throws(
    () => loadCommitmentNotificationConfig(enabledAppConfig(), {
      COMMITMENT_NOTIFICATION_DESTINATION_JID: '123@g.us',
    }),
    /Invalid COMMITMENT_NOTIFICATION_DESTINATION_JID/,
  );

  const enabled = loadCommitmentNotificationConfig(enabledAppConfig(), {
    COMMITMENT_NOTIFICATIONS_ENABLED: 'true',
    COMMITMENT_NOTIFICATION_DESTINATION_JID: SELF_JID,
  });
  assert.deepEqual(enabled, { enabled: true, destinationJid: SELF_JID });
});

test('migration v17 adds notification state/index and is idempotent', () => {
  const db = new AppDatabase(':memory:');
  try {
    const version = db.native.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | bigint };
    assert.equal(Number(version.version), 17);
    const columns = db.native.prepare("PRAGMA table_info('commitments')").all() as Array<{ name: string }>;
    assert.equal(columns.some((row) => row.name === 'notified_at'), true);
    const index = db.native.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_commitments_due_notification'").get();
    assert.ok(index);

    runStage6bMigration(db.native);
    const count = db.native.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17').get() as { count: number | bigint };
    assert.equal(Number(count.count), 1);
  } finally { db.close(); }
});

test('due queue excludes future, undated, completed, cancelled and already notified commitments', () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const dueA = commitments.create({ body: 'due A', dueAt: '2026-08-24T14:00:00.000Z' });
    const dueB = commitments.create({ body: 'due B', dueAt: fixedNow.toISOString() });
    commitments.create({ body: 'future', dueAt: '2026-08-24T16:00:00.000Z' });
    commitments.create({ body: 'undated' });
    const completed = commitments.create({ body: 'completed', dueAt: '2026-08-24T13:00:00.000Z' });
    const cancelled = commitments.create({ body: 'cancelled', dueAt: '2026-08-24T13:30:00.000Z' });
    const notified = commitments.create({ body: 'notified', dueAt: '2026-08-24T12:00:00.000Z' });
    commitments.setStatus(completed, 'completed');
    commitments.setStatus(cancelled, 'cancelled');
    assert.equal(commitments.markNotified(notified, fixedNow.toISOString()), true);

    assert.deepEqual(commitments.listDueUnnotified(fixedNow.toISOString()).map((row) => row.id), [dueA, dueB]);
    assert.equal(commitments.markNotified(dueA, '2026-08-24T13:00:00.000Z'), false);
    assert.throws(() => commitments.listDueUnnotified('bad-date'), /Invalid commitment notification boundary/);
  } finally { db.close(); }
});

test('scheduler sends a due commitment once in steady state and audits only its id', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const transport = new FakeTransport();
    const id = commitments.create({ body: 'SECRET_COMMITMENT_BODY', dueAt: '2026-08-24T14:00:00.000Z' });
    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);

    await scheduler.runOnce();
    await scheduler.runOnce();

    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0]?.destination, SELF_JID);
    assert.match(transport.sent[0]?.text ?? '', new RegExp(`#${id} SECRET_COMMITMENT_BODY`));
    assert.equal(commitments.getById(id)?.notifiedAt, fixedNow.toISOString());
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);

    const auditJson = JSON.stringify(audit.listRecent(10));
    assert.match(auditJson, /commitment\.notified/);
    assert.match(auditJson, new RegExp(`"entityId":"${id}"`));
    assert.doesNotMatch(auditJson, /SECRET_COMMITMENT_BODY|2026-08-24T14:00/);
  } finally { db.close(); }
});

test('failed send remains eligible and a later run retries successfully', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const transport = new FakeTransport();
    const id = commitments.create({ body: 'retry body', dueAt: '2026-08-24T14:00:00.000Z' });
    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);

    transport.failNext = true;
    await scheduler.runOnce();
    assert.equal(transport.sent.length, 0);
    assert.equal(commitments.getById(id)?.notifiedAt, undefined);
    assert.equal(audit.listRecent(10).some((row) => row.eventType === 'commitment.notified'), false);

    await scheduler.runOnce();
    assert.equal(transport.sent.length, 1);
    assert.equal(commitments.getById(id)?.notifiedAt, fixedNow.toISOString());
  } finally { db.close(); }
});

test('completion or cancellation before notification suppresses delivery', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const transport = new FakeTransport();
    const completed = commitments.create({ body: 'done', dueAt: '2026-08-24T14:00:00.000Z' });
    const cancelled = commitments.create({ body: 'cancel', dueAt: '2026-08-24T14:01:00.000Z' });
    commitments.setStatus(completed, 'completed');
    commitments.setStatus(cancelled, 'cancelled');

    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);
    await scheduler.runOnce();
    assert.equal(transport.sent.length, 0);
  } finally { db.close(); }
});

test('scheduler processes a bounded batch in deterministic due order', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const transport = new FakeTransport();
    for (let index = 0; index < 25; index += 1) {
      commitments.create({
        body: `item-${index}`,
        dueAt: new Date(fixedNow.getTime() - (25 - index) * 60_000).toISOString(),
      });
    }
    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);

    await scheduler.runOnce();
    assert.equal(transport.sent.length, 20);
    assert.match(transport.sent[0]?.text ?? '', /item-0/);
    assert.match(transport.sent[19]?.text ?? '', /item-19/);

    await scheduler.runOnce();
    assert.equal(transport.sent.length, 25);
    assert.match(transport.sent[24]?.text ?? '', /item-24/);
  } finally { db.close(); }
});

test('overlapping runOnce calls are suppressed within one scheduler instance', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const transport = new BlockingTransport();
    commitments.create({ body: 'one', dueAt: '2026-08-24T14:00:00.000Z' });
    const scheduler = new CommitmentNotificationScheduler(commitments, transport, audit, SELF_JID, () => fixedNow);

    const first = scheduler.runOnce();
    while (transport.started === 0) await new Promise((resolve) => setImmediate(resolve));
    await scheduler.runOnce();
    assert.equal(transport.started, 1);
    transport.release();
    await first;
    assert.equal(transport.sent.length, 1);
  } finally { db.close(); }
});
