import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionExecutionCapability, type CalendarExecutionService, type DocumentExecutionService } from '../src/capabilities/action-execution-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

function message(text: string): IncomingMessage {
  return {
    id: `dispatch-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

const noopDocument: DocumentExecutionService = {
  async execute() { return { status: 'failed' }; },
};

test('generic action execution keeps Calendar disabled boundary', async () => {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const id = actions.create({ actionType: 'calendar.create_event', summary: 'Evento', payload: {} });
  db.native.prepare("UPDATE action_requests SET status='approved' WHERE id=?").run(id);
  const capability = new ActionExecutionCapability(actions, false, undefined, noopDocument);

  const reply = (await capability.handle(message(`ejecuta acción #${id}`)))?.reply ?? '';
  assert.match(reply, /Calendar están deshabilitados/);
  db.close();
});

test('generic action execution delegates Calendar action when enabled', async () => {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const id = actions.create({ actionType: 'calendar.create_event', summary: 'Evento', payload: {} });
  db.native.prepare("UPDATE action_requests SET status='approved' WHERE id=?").run(id);
  let calls = 0;
  const calendar: CalendarExecutionService = {
    async execute(actionId) {
      calls += 1;
      assert.equal(actionId, id);
      return { status: 'executed', externalId: 'evt-1' };
    },
  };
  const capability = new ActionExecutionCapability(actions, true, calendar, noopDocument);

  const reply = (await capability.handle(message(`ejecuta accion ${id}`)))?.reply ?? '';
  assert.match(reply, /evento creado en Google Calendar/);
  assert.equal(calls, 1);
  db.close();
});

test('generic action execution rejects unsupported approved action type', async () => {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const id = actions.create({ actionType: 'email.send', summary: 'No soportada', payload: {} });
  db.native.prepare("UPDATE action_requests SET status='approved' WHERE id=?").run(id);
  const capability = new ActionExecutionCapability(actions, false, undefined, noopDocument);

  const reply = (await capability.handle(message(`ejecuta acción #${id}`)))?.reply ?? '';
  assert.match(reply, /no tiene un executor soportado/);
  db.close();
});
