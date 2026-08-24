import assert from 'node:assert/strict';
import test from 'node:test';
import { CommitmentCapability } from '../src/capabilities/commitment-capability.ts';
import { CommitmentDashboardCapability } from '../src/capabilities/commitment-dashboard-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

const fixedNow = new Date('2026-08-24T19:30:00.000Z'); // Monday 14:30 Lima

function message(text: string, id = `dashboard-${text}`): IncomingMessage {
  return {
    id,
    chatId: '51999999999@s.whatsapp.net',
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
  const dashboard = new CommitmentDashboardCapability(commitments, audit, 'America/Lima', () => fixedNow);
  return { db, commitments, audit, dashboard };
}

test('summary buckets are mutually exclusive and add up to every open commitment', () => {
  const { db, commitments } = setup();
  try {
    commitments.create({ body: 'DUE_NOW', dueAt: fixedNow.toISOString() });
    commitments.create({ body: 'TODAY', dueAt: '2026-08-24T20:00:00.000Z' });
    commitments.create({ body: 'WEEK', dueAt: '2026-08-25T05:00:00.000Z' }); // exact local day-end
    commitments.create({ body: 'LATER', dueAt: '2026-08-31T05:00:00.000Z' }); // exact week-end
    commitments.create({ body: 'UNDATED' });
    const closed = commitments.create({ body: 'CLOSED', dueAt: '2026-08-24T21:00:00.000Z' });
    commitments.setStatus(closed, 'completed');

    const summary = commitments.summarizeOpen(
      fixedNow.toISOString(),
      '2026-08-25T05:00:00.000Z',
      '2026-08-31T05:00:00.000Z',
    );
    assert.deepEqual(summary, { total: 5, overdue: 1, today: 1, thisWeek: 1, later: 1, undated: 1 });
    assert.equal(summary.overdue + summary.today + summary.thisWeek + summary.later + summary.undated, summary.total);
  } finally { db.close(); }
});

test('summary counts are not truncated by list limits', () => {
  const { db, commitments } = setup();
  try {
    for (let index = 0; index < 125; index += 1) commitments.create({ body: `UNDATED_${index}` });
    const summary = commitments.summarizeOpen(
      fixedNow.toISOString(),
      '2026-08-25T05:00:00.000Z',
      '2026-08-31T05:00:00.000Z',
    );
    assert.equal(summary.total, 125);
    assert.equal(summary.undated, 125);
  } finally { db.close(); }
});

test('summary rejects inconsistent temporal boundaries', () => {
  const { db, commitments } = setup();
  try {
    assert.throws(
      () => commitments.summarizeOpen(fixedNow.toISOString(), fixedNow.toISOString(), '2026-08-31T05:00:00.000Z'),
      /Invalid commitment summary boundaries/,
    );
    assert.throws(
      () => commitments.summarizeOpen(fixedNow.toISOString(), '2026-09-01T05:00:00.000Z', '2026-08-31T05:00:00.000Z'),
      /Invalid commitment summary boundaries/,
    );
  } finally { db.close(); }
});

test('upcoming list is strictly future and deterministic', () => {
  const { db, commitments } = setup();
  try {
    commitments.create({ body: 'DUE_NOW', dueAt: fixedNow.toISOString() });
    const later = commitments.create({ body: 'LATER', dueAt: '2026-08-24T21:00:00.000Z' });
    const first = commitments.create({ body: 'FIRST', dueAt: '2026-08-24T20:00:00.000Z' });
    assert.deepEqual(commitments.listOpenUpcoming(fixedNow.toISOString()).map((row) => row.id), [first, later]);
  } finally { db.close(); }
});

test('dashboard renders counts plus bounded overdue/upcoming priorities and content-free audit', async () => {
  const { db, commitments, audit, dashboard } = setup();
  try {
    commitments.create({ body: `OVERDUE_SECRET ${'x'.repeat(1_500)}`, dueAt: '2026-08-24T18:00:00.000Z' });
    commitments.create({ body: 'UPCOMING_SECRET', dueAt: '2026-08-24T20:00:00.000Z' });
    commitments.create({ body: 'UNDATED_SECRET' });

    const reply = (await dashboard.handle(message('resumen compromisos')))?.reply ?? '';
    assert.match(reply, /Abiertos: 3/);
    assert.match(reply, /Vencidos: 1/);
    assert.match(reply, /Hoy, aún por vencer: 1/);
    assert.match(reply, /Sin fecha: 1/);
    assert.match(reply, /OVERDUE_SECRET/);
    assert.match(reply, /UPCOMING_SECRET/);
    assert.doesNotMatch(reply, /UNDATED_SECRET/);
    assert.ok(reply.length <= 3_500);
    assert.ok(reply.includes('…'));

    const auditJson = JSON.stringify(audit.listRecent(10));
    assert.match(auditJson, /commitment\.summary/);
    assert.match(auditJson, /"total":3/);
    assert.ok(!auditJson.includes('OVERDUE_SECRET'));
    assert.ok(!auditJson.includes('UPCOMING_SECRET'));
    assert.ok(!auditJson.includes('2026-08-24T18:00'));
  } finally { db.close(); }
});

test('dashboard handles empty state and explicit aliases only', async () => {
  const { db, dashboard } = setup();
  try {
    assert.equal(await dashboard.handle(message('hola')), undefined);
    for (const command of ['resumen compromisos', 'estado compromisos', 'panel compromisos']) {
      const reply = (await dashboard.handle(message(command, `alias-${command}`)))?.reply ?? '';
      assert.match(reply, /Abiertos: 0/);
      assert.match(reply, /No tienes compromisos abiertos/);
    }
  } finally { db.close(); }
});

test('runtime CommitmentCapability delegates Stage 6D dashboard command', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const capability = new CommitmentCapability(commitments, audit, 'America/Lima', () => fixedNow);
    commitments.create({ body: 'RUNTIME_DASHBOARD' });
    const reply = (await capability.handle(message('resumen compromisos', 'runtime-dashboard')))?.reply ?? '';
    assert.match(reply, /Resumen de compromisos/);
    assert.match(reply, /Abiertos: 1/);
  } finally { db.close(); }
});

test('Stage 6D dashboard never creates action requests', async () => {
  const { db, commitments, dashboard } = setup();
  try {
    const actions = new ActionRequestRepository(db);
    commitments.create({ body: 'No action', dueAt: '2026-08-24T20:00:00.000Z' });
    await dashboard.handle(message('resumen compromisos'));
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);
  } finally { db.close(); }
});
