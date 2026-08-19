import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarActionExecutor } from '../src/calendar/calendar-action-executor.ts';
import type { CalendarCreateEventInput, CalendarCreateEventResult, CalendarProvider } from '../src/calendar/types.ts';
import { ActionExecutionRepository } from '../src/database/action-execution-repository.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

const fixedNow = new Date('2026-08-19T04:00:00.000Z');

class FakeCalendarProvider implements CalendarProvider {
  readonly name = 'fake-calendar';
  readonly calls: Array<{ input: CalendarCreateEventInput; idempotencyKey: string }> = [];
  failNext = false;

  async createEvent(input: CalendarCreateEventInput, idempotencyKey: string): Promise<CalendarCreateEventResult> {
    this.calls.push({ input, idempotencyKey });
    if (this.failNext) {
      this.failNext = false;
      throw new TypeError('private upstream detail');
    }
    return { externalId: `event-${this.calls.length}` };
  }
}

function setup() {
  const db = new AppDatabase(':memory:');
  const actions = new ActionRequestRepository(db);
  const executions = new ActionExecutionRepository(db);
  const audit = new AuditRepository(db);
  const provider = new FakeCalendarProvider();
  const executor = new CalendarActionExecutor(actions, executions, audit, provider, () => fixedNow);
  return { db, actions, executions, audit, provider, executor };
}

function createCalendarAction(actions: ActionRequestRepository, status: 'pending' | 'approved' = 'approved'): number {
  const id = actions.create({
    actionType: 'calendar.create_event',
    summary: 'Crear evento sensible',
    payload: {
      title: 'Título privado',
      startAt: '2026-08-20T15:00:00.000Z',
      durationMinutes: 30,
      timeZone: 'America/Lima',
    },
    expiresAt: '2026-08-20T15:00:00.000Z',
  });
  if (status === 'approved') {
    const approved = actions.decide(id, 'approved', fixedNow.toISOString());
    assert.equal(approved?.status, 'approved');
  }
  return id;
}

test('executor refuses a pending action before provider or execution ledger', async () => {
  const { db, actions, executions, provider, executor } = setup();
  const id = createCalendarAction(actions, 'pending');
  assert.deepEqual(await executor.execute(id), { status: 'not_approved' });
  assert.equal(provider.calls.length, 0);
  assert.equal(executions.getByActionId(id), undefined);
  db.close();
});

test('approved action executes once and persists idempotent success', async () => {
  const { db, actions, executions, audit, provider, executor } = setup();
  const id = createCalendarAction(actions);
  assert.deepEqual(await executor.execute(id), { status: 'executed', externalId: 'event-1' });
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.idempotencyKey, `calendar-create-action-${id}`);
  assert.equal(executions.getByActionId(id)?.status, 'succeeded');
  assert.equal(executions.getByActionId(id)?.attemptCount, 1);

  const second = await executor.execute(id);
  assert.deepEqual(second, { status: 'already_executed', externalId: 'event-1' });
  assert.equal(provider.calls.length, 1);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /calendar\.execution\.succeeded/);
  assert.doesNotMatch(auditJson, /Título privado|Crear evento sensible/);
  db.close();
});

test('failed execution can retry with the same idempotency key and incremented attempt', async () => {
  const { db, actions, executions, audit, provider, executor } = setup();
  const id = createCalendarAction(actions);
  provider.failNext = true;
  assert.deepEqual(await executor.execute(id), { status: 'failed' });
  assert.equal(executions.getByActionId(id)?.status, 'failed');
  assert.equal(executions.getByActionId(id)?.errorCode, 'TypeError');

  assert.deepEqual(await executor.execute(id), { status: 'executed', externalId: 'event-2' });
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]?.idempotencyKey, provider.calls[1]?.idempotencyKey);
  assert.equal(executions.getByActionId(id)?.attemptCount, 2);
  assert.doesNotMatch(JSON.stringify(audit.listRecent()), /private upstream detail/);
  db.close();
});

test('executor revalidates event time immediately before execution', async () => {
  const { db, actions, executions, provider } = setup();
  const id = createCalendarAction(actions);
  const laterExecutor = new CalendarActionExecutor(
    actions,
    executions,
    new AuditRepository(db),
    provider,
    () => new Date('2026-08-21T00:00:00.000Z'),
  );
  assert.deepEqual(await laterExecutor.execute(id), { status: 'invalid_payload' });
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('executor rejects unsupported action types and malformed payloads', async () => {
  const { db, actions, executions, audit, provider, executor } = setup();
  const unsupported = actions.create({ actionType: 'calendar.delete_event', summary: 'x', payload: {} });
  actions.decide(unsupported, 'approved', fixedNow.toISOString());
  assert.deepEqual(await executor.execute(unsupported), { status: 'unsupported_action' });

  const malformed = actions.create({ actionType: 'calendar.create_event', summary: 'x', payload: { title: 'x' } });
  actions.decide(malformed, 'approved', fixedNow.toISOString());
  assert.deepEqual(await executor.execute(malformed), { status: 'invalid_payload' });

  assert.equal(provider.calls.length, 0);
  assert.equal(executions.getByActionId(unsupported), undefined);
  assert.equal(executions.getByActionId(malformed), undefined);
  assert.equal(audit.listRecent().length, 0);
  db.close();
});
