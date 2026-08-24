import assert from 'node:assert/strict';
import test from 'node:test';
import { CommitmentCapability } from '../src/capabilities/commitment-capability.ts';
import { MemorySearchCapability } from '../src/capabilities/memory-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { CommitmentRepository } from '../src/database/commitment-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { runStage6Migration } from '../src/database/stage6-migration.ts';

const fixedNow = new Date('2026-08-24T14:17:00.000Z'); // 09:17 Lima

function message(text: string, id = `commit-${text}`): IncomingMessage {
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
  const capability = new CommitmentCapability(commitments, audit, 'America/Lima', () => fixedNow);
  return { db, commitments, audit, capability };
}

test('migration v16 installs commitments table, index and FTS triggers idempotently', () => {
  const db = new AppDatabase(':memory:');
  try {
    const appliedBefore = db.native.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 16').get() as { count: number | bigint };
    assert.equal(Number(appliedBefore.count), 1);

    const table = db.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commitments'").get();
    assert.ok(table);
    const index = db.native.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_commitments_status_due'").get();
    assert.ok(index);

    const commitments = new CommitmentRepository(db);
    const id = commitments.create({ body: 'Enviar informe trimestral' });
    const fts = db.native.prepare(`
      SELECT source, source_id, text FROM self_memory_fts
      WHERE source = 'commitment' AND source_id = ?
    `).get(String(id)) as { source: string; source_id: string; text: string } | undefined;
    assert.equal(fts?.source, 'commitment');
    assert.equal(fts?.source_id, String(id));
    assert.equal(fts?.text, 'Enviar informe trimestral');

    runStage6Migration(db.native);
    const migrationCount = db.native.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 16').get() as { count: number | bigint };
    const ftsCount = db.native.prepare(`
      SELECT COUNT(*) AS count FROM self_memory_fts
      WHERE source = 'commitment' AND source_id = ?
    `).get(String(id)) as { count: number | bigint };
    assert.equal(Number(migrationCount.count), 1);
    assert.equal(Number(ftsCount.count), 1);
  } finally { db.close(); }
});

test('repository validates input, orders open commitments and treats due-at-now as overdue', () => {
  const { db, commitments } = setup();
  try {
    assert.throws(() => commitments.create({ body: '   ' }), /Invalid commitment body/);
    assert.throws(() => commitments.create({ body: 'x', dueAt: 'bad' }), /Invalid commitment due date/);

    const undated = commitments.create({ body: 'Comprar regalo' });
    const later = commitments.create({ body: 'Enviar propuesta', dueAt: '2026-08-25T15:00:00.000Z' });
    const dueNow = commitments.create({ body: 'Responder correo', dueAt: fixedNow.toISOString() });

    assert.deepEqual(commitments.listOpen().map((row) => row.id), [dueNow, later, undated]);
    assert.deepEqual(commitments.listOverdue(fixedNow.toISOString()).map((row) => row.id), [dueNow]);
  } finally { db.close(); }
});

test('commitment lifecycle transitions only an open record once', () => {
  const { db, commitments } = setup();
  try {
    const completed = commitments.create({ body: 'Entregar minuta' });
    assert.equal(commitments.setStatus(completed, 'completed'), true);
    assert.equal(commitments.setStatus(completed, 'completed'), false);
    assert.equal(commitments.setStatus(completed, 'cancelled'), false);
    assert.equal(commitments.getById(completed)?.status, 'completed');

    const cancelled = commitments.create({ body: 'Llamar proveedor' });
    assert.equal(commitments.setStatus(cancelled, 'cancelled'), true);
    assert.equal(commitments.getById(cancelled)?.status, 'cancelled');
    assert.equal(commitments.listOpen().length, 0);
  } finally { db.close(); }
});

test('explicit capability creates dated and undated commitments with content-free audit', async () => {
  const { db, commitments, audit, capability } = setup();
  try {
    const dated = await capability.handle(message('compromiso mañana a las 10 enviar informe a Ana'));
    assert.match(dated?.reply ?? '', /Compromiso #1 guardado/);
    assert.match(dated?.reply ?? '', /25\/08\/(?:20)?26/);
    assert.equal(commitments.getById(1)?.dueAt, '2026-08-25T15:00:00.000Z');
    assert.equal(commitments.getById(1)?.body, 'enviar informe a Ana');

    const undated = await capability.handle(message('me comprometo a revisar presupuesto'));
    assert.match(undated?.reply ?? '', /sin vencimiento/);
    assert.equal(commitments.getById(2)?.body, 'revisar presupuesto');
    assert.equal(commitments.getById(2)?.dueAt, undefined);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /commitment\.created/);
    assert.match(auditJson, /"hasDueAt":true/);
    assert.match(auditJson, /"hasDueAt":false/);
    assert.ok(!auditJson.includes('enviar informe'));
    assert.ok(!auditJson.includes('revisar presupuesto'));
    assert.ok(!auditJson.includes('2026-08-25T15:00'));
  } finally { db.close(); }
});

test('invalid or empty commitment is rejected before persistence and plain text is ignored', async () => {
  const { db, commitments, capability } = setup();
  try {
    assert.equal(await capability.handle(message('hola')), undefined);
    const empty = await capability.handle(message('compromiso'));
    assert.match(empty?.reply ?? '', /vacío o es demasiado largo/);
    const invalid = await capability.handle(message('compromiso hoy a las 8 enviar informe'));
    assert.match(invalid?.reply ?? '', /fecha\/hora futura válida/);
    assert.equal(commitments.listOpen().length, 0);
  } finally { db.close(); }
});

test('list, overdue, complete and cancel commands are deterministic and audited without body', async () => {
  const { db, commitments, audit, capability } = setup();
  try {
    const overdueId = commitments.create({ body: 'OVERDUE_SECRET', dueAt: '2026-08-24T14:00:00.000Z' });
    const futureId = commitments.create({ body: 'FUTURE_SECRET', dueAt: '2026-08-25T15:00:00.000Z' });

    assert.match((await capability.handle(message('compromisos vencidos')))?.reply ?? '', /OVERDUE_SECRET/);
    assert.doesNotMatch((await capability.handle(message('compromisos vencidos')))?.reply ?? '', /FUTURE_SECRET/);
    assert.match((await capability.handle(message('compromisos')))?.reply ?? '', /FUTURE_SECRET/);

    assert.match((await capability.handle(message(`cumplí compromiso #${overdueId}`)))?.reply ?? '', /completado/);
    assert.match((await capability.handle(message(`cancela compromiso #${futureId}`)))?.reply ?? '', /cancelado/);
    assert.equal(commitments.listOpen().length, 0);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /commitment\.completed/);
    assert.match(auditJson, /commitment\.cancelled/);
    assert.ok(!auditJson.includes('OVERDUE_SECRET'));
    assert.ok(!auditJson.includes('FUTURE_SECRET'));
  } finally { db.close(); }
});

test('commitments are searchable through dedicated and generic local FTS without crossing Observer', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const commitments = new CommitmentRepository(db);
    const audit = new AuditRepository(db);
    const search = new LocalMemorySearchRepository(db);
    const capability = new MemorySearchCapability(search, audit, 'America/Lima', () => fixedNow);
    const id = commitments.create({ body: 'confirmar renovación del dominio zafiro' });

    const typed = await capability.handle(message('busca compromisos zafiro', 'search-typed'));
    assert.match(typed?.reply ?? '', new RegExp(`Compromiso #${id}`));
    assert.match(typed?.reply ?? '', /renovación del dominio zafiro/);

    const generic = await capability.handle(message('busca zafiro', 'search-generic'));
    assert.match(generic?.reply ?? '', new RegExp(`Compromiso #${id}`));

    commitments.setStatus(id, 'completed');
    const historical = search.search('zafiro', { source: 'commitment' });
    assert.equal(historical.length, 1);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /"commitments":1/);
    assert.ok(!auditJson.includes('zafiro'));
  } finally { db.close(); }
});

test('creating or listing commitments never creates an action request', async () => {
  const { db, capability } = setup();
  try {
    const actions = new ActionRequestRepository(db);
    await capability.handle(message('prometí enviar la propuesta comercial'));
    await capability.handle(message('compromisos'));
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);
  } finally { db.close(); }
});
