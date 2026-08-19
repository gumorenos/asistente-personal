import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarExecutionResult } from '../src/calendar/calendar-action-executor.ts';
import { CalendarExecutionCapability, type CalendarExecutionService } from '../src/capabilities/calendar-execution-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';

function message(text: string): IncomingMessage {
  return { id: `exec-${text}`, chatId: 'self@s.whatsapp.net', timestamp: 1, text, kind: 'text', fromMe: true, isGroup: false };
}

class FakeExecutor implements CalendarExecutionService {
  calls: number[] = [];
  result: CalendarExecutionResult = { status: 'executed', externalId: 'event-1' };

  async execute(actionId: number): Promise<CalendarExecutionResult> {
    this.calls.push(actionId);
    return this.result;
  }
}

test('calendar execution command is explicit-only', async () => {
  const executor = new FakeExecutor();
  const capability = new CalendarExecutionCapability(true, executor);
  assert.equal(await capability.handle(message('acción #1')), undefined);
  assert.equal(executor.calls.length, 0);
});

test('disabled Calendar execution never calls executor', async () => {
  const executor = new FakeExecutor();
  const capability = new CalendarExecutionCapability(false, executor);
  const result = await capability.handle(message('ejecuta acción #7'));
  assert.match(result?.reply ?? '', /deshabilitados/);
  assert.equal(executor.calls.length, 0);
});

test('enabled explicit execution delegates exact action id and reports success without external id', async () => {
  const executor = new FakeExecutor();
  const capability = new CalendarExecutionCapability(true, executor);
  const result = await capability.handle(message('ejecuta accion 42'));
  assert.deepEqual(executor.calls, [42]);
  assert.match(result?.reply ?? '', /evento creado/);
  assert.doesNotMatch(result?.reply ?? '', /event-1/);
});

test('execution result states are rendered safely', async () => {
  const executor = new FakeExecutor();
  const capability = new CalendarExecutionCapability(true, executor);
  const cases: Array<[CalendarExecutionResult, RegExp]> = [
    [{ status: 'already_executed', externalId: 'secret-id' }, /no se creó un duplicado/],
    [{ status: 'in_progress' }, /ejecución reciente/],
    [{ status: 'not_approved' }, /no está aprobada/],
    [{ status: 'unsupported_action' }, /no es un tipo Calendar soportado/],
    [{ status: 'invalid_payload' }, /evento futuro válido/],
    [{ status: 'failed' }, /retry idempotente/],
  ];
  for (const [state, expected] of cases) {
    executor.result = state;
    const reply = (await capability.handle(message('ejecuta acción #1')))?.reply ?? '';
    assert.match(reply, expected);
    assert.doesNotMatch(reply, /secret-id/);
  }
});
