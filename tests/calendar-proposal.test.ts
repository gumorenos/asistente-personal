import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionApprovalCapability } from '../src/capabilities/action-approval-capability.ts';
import { CalendarProposalCapability } from '../src/capabilities/calendar-proposal-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

const fixedNow = new Date('2026-08-19T02:42:00.000Z'); // 18 Aug 21:42 Lima

function message(text: string): IncomingMessage {
  return { id: `cal-${text}`, chatId: '51999999999@s.whatsapp.net', timestamp: 1, text, kind: 'text', fromMe: true, isGroup: false };
}

function setup(now: () => Date = () => fixedNow) {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const audit = new AuditRepository(db);
  const proposal = new CalendarProposalCapability(actions, audit, 'America/Lima', now);
  const approval = new ActionApprovalCapability(actions, audit, now);
  return { db, actions, audit, proposal, approval };
}

test('calendar command creates only a pending local proposal with deterministic time and duration', async () => {
  const { db, actions, audit, proposal } = setup();
  const reply = (await proposal.handle(message('agenda mañana a las 10 reunión con Ana por 30 minutos')))?.reply ?? '';
  assert.match(reply, /Propuesta #1/);
  assert.match(reply, /No se creó nada en Google Calendar/);

  const action = actions.getById(1);
  assert.equal(action?.status, 'pending');
  assert.equal(action?.actionType, 'calendar.create_event');
  assert.equal(action?.expiresAt, '2026-08-19T15:00:00.000Z');
  assert.deepEqual(action?.payload, {
    title: 'reunión con Ana',
    startAt: '2026-08-19T15:00:00.000Z',
    durationMinutes: 30,
    timeZone: 'America/Lima',
  });
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /calendar\.proposal\.created/);
  assert.doesNotMatch(auditJson, /reunión con Ana/);
  db.close();
});

test('calendar proposal defaults to 60 minutes and reuses weekday parsing', async () => {
  const { db, actions, proposal } = setup();
  await proposal.handle(message('agenda viernes a las 16 llamada de seguimiento'));
  const action = actions.getById(1);
  assert.equal(action?.payload.durationMinutes, 60);
  assert.equal(action?.payload.startAt, '2026-08-21T21:00:00.000Z');
  db.close();
});

test('invalid schedule or duration does not create an action', async () => {
  const { db, actions, proposal } = setup();
  assert.match((await proposal.handle(message('agenda hoy a las 25 imposible')))?.reply ?? '', /No pude obtener/);
  assert.match((await proposal.handle(message('agenda mañana a las 10 reunión por 999 minutos')))?.reply ?? '', /duración no son válidos/);
  assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);
  db.close();
});

test('approved calendar proposal remains local and no external executor exists', async () => {
  const { db, actions, proposal, approval } = setup();
  await proposal.handle(message('agenda mañana a las 10 reunión'));
  const reply = (await approval.handle(message('aprueba acción #1')))?.reply ?? '';
  assert.match(reply, /NO fue ejecutada/);
  assert.equal(actions.getById(1)?.status, 'approved');
  db.close();
});

test('expired calendar proposal cannot be listed or approved', async () => {
  const creationNow = () => fixedNow;
  const { db, actions, proposal } = setup(creationNow);
  await proposal.handle(message('agenda en 1 horas prueba futura'));
  assert.equal(actions.getById(1)?.expiresAt, '2026-08-19T03:42:00.000Z');

  const later = () => new Date('2026-08-19T04:00:00.000Z');
  const audit = new AuditRepository(db);
  const approvalLater = new ActionApprovalCapability(actions, audit, later);
  assert.match((await approvalLater.handle(message('acciones')))?.reply ?? '', /No hay acciones pendientes/);
  assert.match((await approvalLater.handle(message('aprueba acción #1')))?.reply ?? '', /pendiente y vigente/);
  assert.equal(actions.getById(1)?.status, 'pending');
  db.close();
});
