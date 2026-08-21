import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionApprovalCapability } from '../src/capabilities/action-approval-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

function message(text: string): IncomingMessage {
  return {
    id: `action-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function setup() {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const audit = new AuditRepository(db);
  const capability = new ActionApprovalCapability(actions, audit, () => new Date('2026-08-19T04:00:00.000Z'));
  return { db, actions, audit, capability };
}

test('action repository creates bounded pending proposals with opaque payload', () => {
  const { db, actions } = setup();
  const id = actions.create({
    actionType: 'calendar.create_event',
    summary: 'Crear reunión mañana a las 10',
    payload: { title: 'contenido sensible', start: '2026-08-20T15:00:00.000Z' },
  });
  const row = actions.getById(id);
  assert.equal(row?.status, 'pending');
  assert.equal(row?.actionType, 'calendar.create_event');
  assert.deepEqual(row?.payload, { title: 'contenido sensible', start: '2026-08-20T15:00:00.000Z' });
  db.close();
});

test('listing actions exposes summary locally but not payload', async () => {
  const { db, actions, capability } = setup();
  actions.create({ actionType: 'calendar.create_event', summary: 'Crear reunión mañana', payload: { secret: 'NO_MOSTRAR' } });
  const reply = (await capability.handle(message('acciones')))?.reply ?? '';
  assert.match(reply, /Crear reunión mañana/);
  assert.doesNotMatch(reply, /NO_MOSTRAR/);
  assert.match(reply, /NO ejecuta/);
  db.close();
});

test('approving is an atomic local state transition and does not execute anything', async () => {
  const { db, actions, audit, capability } = setup();
  const id = actions.create({
    actionType: 'calendar.create_event',
    summary: 'Crear reunión privada',
    payload: { title: 'secreto de calendario' },
  });

  const reply = (await capability.handle(message(`aprueba acción #${id}`)))?.reply ?? '';
  assert.match(reply, /aprobada/);
  assert.match(reply, /NO fue ejecutada/);
  assert.equal(actions.getById(id)?.status, 'approved');
  assert.equal(actions.getById(id)?.decidedAt, '2026-08-19T04:00:00.000Z');

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /action\.approved/);
  assert.match(auditJson, /calendar\.create_event/);
  assert.doesNotMatch(auditJson, /Crear reunión privada|secreto de calendario/);

  const second = (await capability.handle(message(`aprueba acción #${id}`)))?.reply ?? '';
  assert.match(second, /No encontré una acción pendiente/);
  db.close();
});

test('rejection transitions only pending action and is audited without payload', async () => {
  const { db, actions, audit, capability } = setup();
  const id = actions.create({ actionType: 'calendar.delete_event', summary: 'Eliminar reunión', payload: { eventId: 'secret-id' } });
  const reply = (await capability.handle(message(`rechaza accion ${id}`)))?.reply ?? '';
  assert.match(reply, /rechazada/);
  assert.equal(actions.getById(id)?.status, 'rejected');
  assert.doesNotMatch(JSON.stringify(audit.listRecent()), /secret-id|Eliminar reunión/);
  db.close();
});

test('action input validation rejects malformed type, summary and oversized payload', () => {
  const { db, actions } = setup();
  assert.throws(() => actions.create({ actionType: 'INVALID TYPE', summary: 'x', payload: {} }), /Invalid action type/);
  assert.throws(() => actions.create({ actionType: 'calendar.create', summary: '', payload: {} }), /Invalid action summary/);
  assert.throws(
    () => actions.create({ actionType: 'calendar.create', summary: 'x', payload: { value: 'x'.repeat(20_001) } }),
    /payload is too large/,
  );
  db.close();
});
