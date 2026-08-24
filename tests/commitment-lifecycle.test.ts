import assert from 'node:assert/strict';
import test from 'node:test';
import { CommitmentCapability } from '../src/capabilities/commitment-capability.ts';
import { CommitmentLifecycleCapability } from '../src/capabilities/commitment-lifecycle-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

const fixedNow = new Date('2026-08-24T19:30:00.000Z'); // Monday 14:30 Lima
const selfJid = '51999999999@s.whatsapp.net';

function message(text: string, id = `lifecycle-${text}`): IncomingMessage {
  return {
    id,
    chatId: selfJid,
    timestamp: Math.floor(fixedNow.getTime() / 1_000),
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const commitments = new CommitmentRepository(db);
  const audit = new AuditRepository(db);
  const lifecycle = new CommitmentLifecycleCapability(commitments, audit, 'America/Lima', () => fixedNow);
  return { db, commitments, audit, lifecycle };
}

test('repository temporal range is inclusive-start/exclusive-end and excludes closed commitments', () => {
  const { db, commitments } = setup();
  try {
    const atStart = commitments.create({ body: 'START', dueAt: '2026-08-24T05:00:00.000Z' });
    const inside = commitments.create({ body: 'INSIDE', dueAt: '2026-08-25T04:59:59.000Z' });
    commitments.create({ body: 'END', dueAt: '2026-08-25T05:00:00.000Z' });
    const closed = commitments.create({ body: 'CLOSED', dueAt: '2026-08-24T20:00:00.000Z' });
    assert.equal(commitments.setStatus(closed, 'completed'), true);

    assert.deepEqual(
      commitments.listOpenDueBetween('2026-08-24T05:00:00.000Z', '2026-08-25T05:00:00.000Z').map((row) => row.id),
      [atStart, inside],
    );
    assert.throws(
      () => commitments.listOpenDueBetween('2026-08-25T05:00:00.000Z', '2026-08-24T05:00:00.000Z'),
      /Invalid commitment range/,
    );
  } finally { db.close(); }
});

test('undated view returns only open commitments in deterministic newest-first order', () => {
  const { db, commitments } = setup();
  try {
    const first = commitments.create({ body: 'FIRST' });
    const second = commitments.create({ body: 'SECOND' });
    commitments.create({ body: 'DATED', dueAt: '2026-08-25T15:00:00.000Z' });
    const closed = commitments.create({ body: 'CLOSED_UNDATED' });
    commitments.setStatus(closed, 'cancelled');

    assert.deepEqual(commitments.listOpenUndated().map((row) => row.id), [second, first]);
  } finally { db.close(); }
});

test('reschedule updates only open commitment and clears prior notification state', () => {
  const { db, commitments } = setup();
  try {
    const id = commitments.create({ body: 'Enviar propuesta', dueAt: '2026-08-24T18:00:00.000Z' });
    assert.equal(commitments.markNotified(id, fixedNow.toISOString()), true);
    assert.ok(commitments.getById(id)?.notifiedAt);

    const result = commitments.reschedule(id, '2026-08-25T15:00:00.000Z');
    assert.deepEqual(result, {
      changed: true,
      reason: 'updated',
      hadPreviousDueAt: true,
      notificationReset: true,
    });
    assert.equal(commitments.getById(id)?.dueAt, '2026-08-25T15:00:00.000Z');
    assert.equal(commitments.getById(id)?.notifiedAt, undefined);
  } finally { db.close(); }
});

test('rescheduling to the exact same due time is a no-op and preserves notification state', async () => {
  const { db, commitments, audit, lifecycle } = setup();
  try {
    const dueAt = '2026-08-25T15:00:00.000Z';
    const id = commitments.create({ body: 'NO_DUPLICATE_NOTIFICATION', dueAt });
    assert.equal(commitments.markNotified(id, '2026-08-25T16:00:00.000Z'), true);
    const notifiedAt = commitments.getById(id)?.notifiedAt;

    const repositoryResult = commitments.reschedule(id, dueAt);
    assert.deepEqual(repositoryResult, {
      changed: false,
      reason: 'unchanged',
      hadPreviousDueAt: true,
      notificationReset: false,
    });
    assert.equal(commitments.getById(id)?.notifiedAt, notifiedAt);

    const capabilityResult = await lifecycle.handle(message(`reprograma compromiso #${id} mañana a las 10`));
    assert.match(capabilityResult?.reply ?? '', /ya estaba programado/);
    assert.equal(commitments.getById(id)?.notifiedAt, notifiedAt);
    assert.doesNotMatch(JSON.stringify(audit.listRecent(10)), /commitment\.rescheduled/);
  } finally { db.close(); }
});

test('reschedule does not reopen completed or cancelled commitments', () => {
  const { db, commitments } = setup();
  try {
    for (const status of ['completed', 'cancelled'] as const) {
      const id = commitments.create({ body: `closed-${status}`, dueAt: '2026-08-25T15:00:00.000Z' });
      commitments.setStatus(id, status);
      const before = commitments.getById(id);
      const result = commitments.reschedule(id, '2026-08-26T15:00:00.000Z');
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'not_open');
      assert.equal(commitments.getById(id)?.status, status);
      assert.equal(commitments.getById(id)?.dueAt, before?.dueAt);
    }
  } finally { db.close(); }
});

test('today/week/undated views use America/Lima boundaries and do not mix scopes', async () => {
  const { db, commitments, lifecycle } = setup();
  try {
    commitments.create({ body: 'TODAY_PAST', dueAt: '2026-08-24T13:00:00.000Z' }); // 08:00 Lima
    commitments.create({ body: 'TODAY_FUTURE', dueAt: '2026-08-24T22:00:00.000Z' }); // 17:00 Lima
    commitments.create({ body: 'TOMORROW', dueAt: '2026-08-25T15:00:00.000Z' });
    commitments.create({ body: 'SUNDAY', dueAt: '2026-08-30T15:00:00.000Z' });
    commitments.create({ body: 'NEXT_MONDAY', dueAt: '2026-08-31T05:00:00.000Z' }); // exact next-week boundary
    commitments.create({ body: 'UNDATED' });

    const today = (await lifecycle.handle(message('compromisos hoy')))?.reply ?? '';
    assert.match(today, /TODAY_PAST/);
    assert.match(today, /TODAY_FUTURE/);
    assert.doesNotMatch(today, /TOMORROW|SUNDAY|NEXT_MONDAY|UNDATED/);

    const week = (await lifecycle.handle(message('compromisos esta semana')))?.reply ?? '';
    assert.match(week, /TODAY_PAST/);
    assert.match(week, /TOMORROW/);
    assert.match(week, /SUNDAY/);
    assert.doesNotMatch(week, /NEXT_MONDAY|UNDATED/);

    const undated = (await lifecycle.handle(message('compromisos sin fecha')))?.reply ?? '';
    assert.match(undated, /UNDATED/);
    assert.doesNotMatch(undated, /TODAY_PAST|TOMORROW/);
  } finally { db.close(); }
});

test('temporal view compacts long bodies and enforces strict total reply bound', async () => {
  const { db, commitments, lifecycle } = setup();
  try {
    for (let index = 0; index < 10; index += 1) {
      commitments.create({
        body: `LONG_${index} ${'x'.repeat(1_900)}`,
        dueAt: new Date(Date.parse('2026-08-24T20:00:00.000Z') + index * 60_000).toISOString(),
      });
    }

    const reply = (await lifecycle.handle(message('compromisos hoy', 'bounded-view')))?.reply ?? '';
    assert.ok(reply.length <= 3_500, `reply length was ${reply.length}`);
    assert.match(reply, /LONG_0/);
    assert.ok(reply.includes('…'));
    for (const line of reply.split('\n').slice(1)) {
      assert.ok(line.length < 400, `line length was ${line.length}`);
    }
  } finally { db.close(); }
});

test('explicit reschedule reuses deterministic parser and audits metadata without body or exact due time', async () => {
  const { db, commitments, audit, lifecycle } = setup();
  try {
    const id = commitments.create({ body: 'SECRET_BODY', dueAt: '2026-08-24T18:00:00.000Z' });
    commitments.markNotified(id, fixedNow.toISOString());

    const result = await lifecycle.handle(message(`reprograma compromiso #${id} mañana a las 10`));
    assert.match(result?.reply ?? '', new RegExp(`Compromiso #${id} reprogramado`));
    assert.equal(commitments.getById(id)?.dueAt, '2026-08-25T15:00:00.000Z');
    assert.equal(commitments.getById(id)?.notifiedAt, undefined);

    const auditJson = JSON.stringify(audit.listRecent(10));
    assert.match(auditJson, /commitment\.rescheduled/);
    assert.match(auditJson, /"notificationReset":true/);
    assert.ok(!auditJson.includes('SECRET_BODY'));
    assert.ok(!auditJson.includes('2026-08-25T15:00'));
  } finally { db.close(); }
});

test('invalid or past reschedule is terminal and leaves commitment unchanged', async () => {
  const { db, commitments, lifecycle } = setup();
  try {
    const id = commitments.create({ body: 'NO_CHANGE', dueAt: '2026-08-25T15:00:00.000Z' });

    const invalid = await lifecycle.handle(message(`reprograma compromiso #${id} hoy a las 10`));
    assert.match(invalid?.reply ?? '', /fecha\/hora futura válida/);
    assert.equal(commitments.getById(id)?.dueAt, '2026-08-25T15:00:00.000Z');

    const missing = await lifecycle.handle(message('reprograma compromiso #999 mañana a las 10'));
    assert.match(missing?.reply ?? '', /No encontré un compromiso abierto #999/);
  } finally { db.close(); }
});

test('runtime CommitmentCapability delegates Stage 6C commands before legacy create/list handling', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const capability = new CommitmentCapability(commitments, audit, 'America/Lima', () => fixedNow);
    const id = commitments.create({ body: 'RUNTIME_ROUTE' });

    const undated = await capability.handle(message('compromisos sin fecha', 'runtime-view'));
    assert.match(undated?.reply ?? '', /RUNTIME_ROUTE/);

    const moved = await capability.handle(message(`mueve compromiso #${id} mañana a las 9`, 'runtime-move'));
    assert.match(moved?.reply ?? '', /reprogramado/);
    assert.equal(commitments.getById(id)?.dueAt, '2026-08-25T14:00:00.000Z');
  } finally { db.close(); }
});

test('Stage 6C lifecycle never creates an action request', async () => {
  const { db, commitments, lifecycle } = setup();
  try {
    const actions = new ActionRequestRepository(db);
    const id = commitments.create({ body: 'No external action', dueAt: '2026-08-25T15:00:00.000Z' });
    await lifecycle.handle(message('compromisos semana'));
    await lifecycle.handle(message(`reprograma compromiso #${id} miércoles a las 10`));
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);
  } finally { db.close(); }
});
