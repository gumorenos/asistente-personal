import assert from 'node:assert/strict';
import test from 'node:test';
import { AppDatabase } from '../src/database/db.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { ObservedChatRepository } from '../src/database/observed-chat-repository.ts';
import { SqliteObservationSink } from '../src/observer/sqlite-observation-sink.ts';
import { ObserverRetentionScheduler } from '../src/scheduler/observer-retention-scheduler.ts';

const now = new Date('2026-08-20T12:00:00.000Z');

test('observer retention scheduler purges by per-chat policy and audits only counts', async () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const audit = new AuditRepository(db);
  const scheduler = new ObserverRetentionScheduler(sink, audit, () => now);

  const jid = '51922222222@s.whatsapp.net';
  chats.enable(jid, 'Privado', 1);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  sink.save({
    messageId: 'old',
    chatJid: jid,
    timestamp: nowSeconds - 2 * 86400,
    text: 'contenido sensible',
    kind: 'text',
    isGroup: false,
  });

  assert.equal(await scheduler.runOnce(), 1);
  assert.equal(sink.count(jid), 0);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /observer\.retention\.purged/);
  assert.doesNotMatch(auditJson, /contenido sensible|Privado|51922222222/);
  db.close();
});

test('observer retention scheduler safely reports zero when nothing is expired', async () => {
  const db = new AppDatabase(':memory:');
  const chats = new ObservedChatRepository(db);
  const sink = new SqliteObservationSink(db);
  const audit = new AuditRepository(db);
  const scheduler = new ObserverRetentionScheduler(sink, audit, () => now);

  const jid = '51922222222@s.whatsapp.net';
  chats.enable(jid, 'Reciente', 7);
  sink.save({
    messageId: 'recent',
    chatJid: jid,
    timestamp: Math.floor(now.getTime() / 1_000) - 60,
    text: 'reciente',
    kind: 'text',
    isGroup: false,
  });

  assert.equal(await scheduler.runOnce(), 0);
  assert.equal(sink.count(jid), 1);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /observer\.retention\.purged/);
  assert.match(auditJson, /\"purged\":0/);
  assert.doesNotMatch(auditJson, /Reciente|51922222222|reciente/);
  db.close();
});
