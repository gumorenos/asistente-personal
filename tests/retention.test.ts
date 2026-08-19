import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { RetentionRepository } from '../src/database/retention-repository.ts';
import { RetentionScheduler } from '../src/scheduler/retention-scheduler.ts';

const fixedNow = new Date('2026-08-19T12:00:00.000Z');

function count(db: AppDatabase, table: string): number {
  const row = db.native.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

test('retention purge deletes only operational rows older than independent cutoffs', () => {
  const db = new AppDatabase(':memory:');
  const retention = new RetentionRepository(db);
  const notes = new NoteRepository(db);
  notes.create('dato de dominio que debe permanecer');

  const insertMessage = db.native.prepare(`
    INSERT INTO messages(id, chat_id, timestamp, text, kind, from_me, is_group)
    VALUES (?, 'self@s.whatsapp.net', ?, ?, 'text', 1, 0)
  `);
  insertMessage.run('old-message', Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000), 'viejo');
  insertMessage.run('new-message', Math.floor(new Date('2026-08-18T00:00:00Z').getTime() / 1000), 'nuevo');

  db.native.prepare(`INSERT INTO assistant_outbound(message_id, destination, created_at) VALUES ('old-out', 'self', '2026-06-01 00:00:00')`).run();
  db.native.prepare(`INSERT INTO assistant_outbound(message_id, destination, created_at) VALUES ('new-out', 'self', '2026-08-18 00:00:00')`).run();
  db.native.prepare(`INSERT INTO audit_log(event_type, created_at) VALUES ('old.audit', '2026-04-01 00:00:00')`).run();
  db.native.prepare(`INSERT INTO audit_log(event_type, created_at) VALUES ('new.audit', '2026-08-18 00:00:00')`).run();
  db.native.prepare(`INSERT INTO briefing_deliveries(local_date, destination, delivered_at) VALUES ('2026-04-01', 'self', '2026-04-01T12:00:00.000Z')`).run();
  db.native.prepare(`INSERT INTO briefing_deliveries(local_date, destination, delivered_at) VALUES ('2026-08-18', 'self', '2026-08-18T12:00:00.000Z')`).run();

  const result = retention.purge({
    messageBeforeEpochSeconds: Math.floor(new Date('2026-07-20T00:00:00Z').getTime() / 1000),
    outboundBeforeIso: '2026-07-20T00:00:00.000Z',
    auditBeforeIso: '2026-05-20T00:00:00.000Z',
    briefingBeforeIso: '2026-05-20T00:00:00.000Z',
  });

  assert.deepEqual(result, { messages: 1, outbound: 1, audit: 1, briefings: 1 });
  assert.equal(count(db, 'messages'), 1);
  assert.equal(count(db, 'assistant_outbound'), 1);
  assert.equal(count(db, 'audit_log'), 1);
  assert.equal(count(db, 'briefing_deliveries'), 1);
  assert.equal(notes.listActive().length, 1);
  db.close();
});

test('retention scheduler computes age cutoffs, purges and records aggregate audit only', async () => {
  const db = new AppDatabase(':memory:');
  const retention = new RetentionRepository(db);
  const audit = new AuditRepository(db);
  db.native.prepare(`
    INSERT INTO messages(id, chat_id, timestamp, text, kind, from_me, is_group)
    VALUES ('old', 'self@s.whatsapp.net', ?, 'contenido privado', 'text', 1, 0)
  `).run(Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000));

  const scheduler = new RetentionScheduler(retention, audit, {
    messageDays: 30,
    outboundDays: 30,
    auditDays: 90,
    briefingDays: 90,
  }, () => fixedNow);

  const result = await scheduler.runOnce();
  assert.equal(result?.messages, 1);
  assert.equal(count(db, 'messages'), 0);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /retention\.purged/);
  assert.doesNotMatch(auditJson, /contenido privado/);
  db.close();
});
