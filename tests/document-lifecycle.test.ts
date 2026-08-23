import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionExecutionCapability } from '../src/capabilities/action-execution-capability.ts';
import { DocumentLifecycleCapability } from '../src/capabilities/document-lifecycle-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionExecutionRepository } from '../src/database/action-execution-repository.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { LocalMemorySearchRepository } from '../src/database/local-memory-search-repository.ts';
import { DocumentActionExecutor } from '../src/documents/document-action-executor.ts';

const NOW = new Date('2026-08-23T19:00:00.000Z');

function message(text: string): IncomingMessage {
  return {
    id: `lifecycle-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function saveDocument(documents: DocumentRepository, idSuffix = '1', text = 'TOKEN_PRIVADO documento sensible') {
  return documents.save({
    messageId: `doc-${idSuffix}`,
    receivedAt: 1_777_000_000,
    fileName: `privado-${idSuffix}.pdf`,
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    byteLength: 123,
    pageCount: 1,
    text,
    truncated: false,
  });
}

test('delete document command creates a short-lived action but does not delete immediately', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const audit = new AuditRepository(db);
  const stored = saveDocument(documents);
  const capability = new DocumentLifecycleCapability(documents, actions, audit, () => NOW);

  const reply = (await capability.handle(message(`borra documento #${stored.id}`)))?.reply ?? '';
  assert.match(reply, /Todavía NO se borró nada/);
  assert.ok(documents.get(stored.id));

  const action = actions.getById(1);
  assert.equal(action?.actionType, 'document.delete');
  assert.deepEqual(action?.payload, { documentId: stored.id });
  assert.equal(action?.expiresAt, '2026-08-23T19:15:00.000Z');
  assert.doesNotMatch(action?.summary ?? '', /privado|TOKEN_PRIVADO/);
  assert.doesNotMatch(JSON.stringify(audit.listRecent()), /privado|TOKEN_PRIVADO|a{64}/);
  db.close();
});

test('unknown document does not create a deletion action', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const audit = new AuditRepository(db);
  const capability = new DocumentLifecycleCapability(documents, actions, audit, () => NOW);

  const reply = (await capability.handle(message('elimina documento #999')))?.reply ?? '';
  assert.match(reply, /No encontré el documento/);
  assert.equal(actions.listPending(NOW.toISOString()).length, 0);
  db.close();
});

test('approved document deletion executes once, removes FTS and is idempotent', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const executions = new ActionExecutionRepository(db);
  const audit = new AuditRepository(db);
  const memory = new LocalMemorySearchRepository(db);
  const stored = saveDocument(documents);
  const proposal = new DocumentLifecycleCapability(documents, actions, audit, () => NOW);
  await proposal.handle(message(`borra documento #${stored.id}`));
  assert.ok(actions.decide(1, 'approved', '2026-08-23T19:01:00.000Z'));

  const executor = new DocumentActionExecutor(actions, executions, documents, audit, () => new Date('2026-08-23T19:02:00.000Z'));
  const execution = new ActionExecutionCapability(actions, false, undefined, executor);
  const reply = (await execution.handle(message('ejecuta acción #1')))?.reply ?? '';
  assert.match(reply, /eliminado del almacenamiento local/);
  assert.equal(documents.get(stored.id), undefined);
  assert.equal(memory.search('TOKEN_PRIVADO', { source: 'document' }).length, 0);
  assert.equal(executions.getByActionId(1)?.status, 'succeeded');

  const repeated = (await execution.handle(message('ejecuta accion 1')))?.reply ?? '';
  assert.match(repeated, /ya había sido ejecutada/);
  assert.equal(executions.getByActionId(1)?.attemptCount, 1);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /document\.delete\.execution\.succeeded/);
  assert.doesNotMatch(auditJson, /privado-1\.pdf|TOKEN_PRIVADO|a{64}/);
  db.close();
});

test('pending document action cannot execute', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const executions = new ActionExecutionRepository(db);
  const audit = new AuditRepository(db);
  const stored = saveDocument(documents);
  const proposal = new DocumentLifecycleCapability(documents, actions, audit, () => NOW);
  await proposal.handle(message(`borra documento #${stored.id}`));

  const executor = new DocumentActionExecutor(actions, executions, documents, audit, () => NOW);
  const capability = new ActionExecutionCapability(actions, false, undefined, executor);
  const reply = (await capability.handle(message('ejecuta acción #1')))?.reply ?? '';
  assert.match(reply, /no está aprobada/);
  assert.ok(documents.get(stored.id));
  assert.equal(executions.getByActionId(1), undefined);
  db.close();
});

test('stale execution can recover when document is already absent', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const executions = new ActionExecutionRepository(db);
  const audit = new AuditRepository(db);
  const stored = saveDocument(documents);
  const actionId = actions.create({
    actionType: 'document.delete',
    summary: `Eliminar documento #${stored.id}`,
    payload: { documentId: stored.id },
    expiresAt: '2026-08-23T20:00:00.000Z',
  });
  actions.decide(actionId, 'approved', '2026-08-23T18:00:00.000Z');
  executions.beginApproved(
    actionId,
    'local-document-store',
    `document-delete-action-${actionId}`,
    '2026-08-23T18:00:00.000Z',
    '2026-08-23T17:55:00.000Z',
  );
  documents.delete(stored.id);

  const executor = new DocumentActionExecutor(actions, executions, documents, audit, () => NOW);
  const result = await executor.execute(actionId);
  assert.equal(result.status, 'executed');
  if (result.status === 'executed') assert.equal(result.alreadyAbsent, true);
  assert.equal(executions.getByActionId(actionId)?.status, 'succeeded');
  assert.equal(executions.getByActionId(actionId)?.attemptCount, 2);
  db.close();
});

test('expired approved document action refuses deletion', async () => {
  const db = new AppDatabase(':memory:');
  const documents = new DocumentRepository(db);
  const actions = new ActionRequestRepository(db);
  const executions = new ActionExecutionRepository(db);
  const audit = new AuditRepository(db);
  const stored = saveDocument(documents);
  const actionId = actions.create({
    actionType: 'document.delete',
    summary: `Eliminar documento #${stored.id}`,
    payload: { documentId: stored.id },
    expiresAt: '2026-08-23T18:30:00.000Z',
  });
  db.native.prepare("UPDATE action_requests SET status='approved', decided_at=? WHERE id=?").run('2026-08-23T18:00:00.000Z', actionId);

  const executor = new DocumentActionExecutor(actions, executions, documents, audit, () => NOW);
  const result = await executor.execute(actionId);
  assert.equal(result.status, 'invalid_payload');
  assert.ok(documents.get(stored.id));
  assert.equal(executions.getByActionId(actionId), undefined);
  db.close();
});
