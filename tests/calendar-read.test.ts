import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarReadService } from '../src/calendar/calendar-read-service.ts';
import { loadCalendarReadConfig } from '../src/calendar/read-config.ts';
import type {
  CalendarBusyInterval,
  CalendarReadEvent,
  CalendarReadProvider,
  CalendarReadRange,
} from '../src/calendar/read-types.ts';
import { CalendarReadCapability } from '../src/capabilities/calendar-read-capability.ts';
import { loadConfig } from '../src/config.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

class FakeCalendarReadProvider implements CalendarReadProvider {
  readonly name = 'fake-calendar-read';
  listCalls: Array<{ range: CalendarReadRange; maxResults: number }> = [];
  busyCalls: CalendarReadRange[] = [];
  events: CalendarReadEvent[] = [];
  busy: CalendarBusyInterval[] = [];
  fail = false;

  async listEvents(range: CalendarReadRange, maxResults: number): Promise<CalendarReadEvent[]> {
    this.listCalls.push({ range, maxResults });
    if (this.fail) throw new Error('PRIVATE_CALENDAR_READ_ERROR');
    return this.events;
  }

  async queryBusy(range: CalendarReadRange): Promise<CalendarBusyInterval[]> {
    this.busyCalls.push(range);
    if (this.fail) throw new Error('PRIVATE_CALENDAR_READ_ERROR');
    return this.busy;
  }
}

function baseAppEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GOOGLE_CALENDAR_CLIENT_ID: 'read-client',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'read-secret',
    GOOGLE_CALENDAR_REFRESH_TOKEN: 'read-refresh',
    ...extra,
  };
}

function readConfig(extra: NodeJS.ProcessEnv = {}) {
  const env = baseAppEnv({ CALENDAR_READ_ENABLED: 'true', ...extra });
  return loadCalendarReadConfig(loadConfig(env), env);
}

function message(text: string): IncomingMessage {
  return {
    id: 'calendar-read-command',
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_200_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

const fixedNow = new Date('2026-08-24T14:15:00.000Z'); // 09:15 America/Lima

test('Calendar read is disabled by default and independent from Calendar writes', () => {
  const defaults = loadCalendarReadConfig(loadConfig({}), {});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.dayStartMinutes, 8 * 60);
  assert.equal(defaults.dayEndMinutes, 20 * 60);
  assert.equal(defaults.minFreeMinutes, 30);
  assert.equal(defaults.maxEvents, 20);

  const env = baseAppEnv({ CALENDAR_READ_ENABLED: 'true', CALENDAR_ENABLED: 'false' });
  const app = loadConfig(env);
  const config = loadCalendarReadConfig(app, env);
  assert.equal(app.calendar.enabled, false);
  assert.equal(config.enabled, true);
});

test('Calendar read requires OAuth material but not write enablement and validates bounds', () => {
  const app = loadConfig({});
  assert.throws(() => loadCalendarReadConfig(app, { CALENDAR_READ_ENABLED: 'true' }), /CLIENT_ID/);

  const env = baseAppEnv({ CALENDAR_READ_ENABLED: 'true', CALENDAR_READ_DAY_START: '20:00', CALENDAR_READ_DAY_END: '08:00' });
  assert.throws(() => loadCalendarReadConfig(loadConfig(env), env), /DAY_END/);

  const invalidClock = baseAppEnv({ CALENDAR_READ_DAY_START: '25:00' });
  assert.throws(() => loadCalendarReadConfig(loadConfig(invalidClock), invalidClock), /DAY_START/);

  const invalidLimit = baseAppEnv({ CALENDAR_READ_MAX_EVENTS: '51' });
  assert.throws(() => loadCalendarReadConfig(loadConfig(invalidLimit), invalidLimit), /MAX_EVENTS/);
});

test('agenda tomorrow/week uses deterministic America/Lima boundaries', async () => {
  const provider = new FakeCalendarReadProvider();
  const config = readConfig();
  const service = new CalendarReadService(provider, config, 'America/Lima', () => fixedNow);

  await service.agenda('tomorrow');
  assert.equal(provider.listCalls[0]?.range.startAt, '2026-08-25T05:00:00.000Z');
  assert.equal(provider.listCalls[0]?.range.endAt, '2026-08-26T05:00:00.000Z');

  await service.agenda('week');
  assert.equal(provider.listCalls[1]?.range.startAt, '2026-08-24T05:00:00.000Z');
  assert.equal(provider.listCalls[1]?.range.endAt, '2026-08-31T05:00:00.000Z');
  assert.equal(provider.listCalls[1]?.maxResults, 20);
});

test('availability today clamps past time, merges busy intervals and returns only useful free gaps', async () => {
  const provider = new FakeCalendarReadProvider();
  provider.busy = [
    { startAt: '2026-08-24T15:00:00.000Z', endAt: '2026-08-24T16:00:00.000Z' },
    { startAt: '2026-08-24T15:30:00.000Z', endAt: '2026-08-24T17:00:00.000Z' },
    { startAt: '2026-08-24T20:00:00.000Z', endAt: '2026-08-24T20:15:00.000Z' },
  ];
  const service = new CalendarReadService(provider, readConfig(), 'America/Lima', () => fixedNow);
  const result = await service.availability('today');

  assert.ok(result);
  assert.equal(provider.busyCalls[0]?.startAt, fixedNow.toISOString());
  assert.equal(provider.busyCalls[0]?.endAt, '2026-08-25T01:00:00.000Z');
  assert.deepEqual(result?.busyIntervals, [
    { startAt: '2026-08-24T15:00:00.000Z', endAt: '2026-08-24T17:00:00.000Z' },
    { startAt: '2026-08-24T20:00:00.000Z', endAt: '2026-08-24T20:15:00.000Z' },
  ]);
  assert.deepEqual(result?.freeSlots, [
    { startAt: '2026-08-24T14:15:00.000Z', endAt: '2026-08-24T15:00:00.000Z' },
    { startAt: '2026-08-24T17:00:00.000Z', endAt: '2026-08-24T20:00:00.000Z' },
    { startAt: '2026-08-24T20:15:00.000Z', endAt: '2026-08-25T01:00:00.000Z' },
  ]);
});

test('availability today returns no provider call after the configured day has ended', async () => {
  const provider = new FakeCalendarReadProvider();
  const late = new Date('2026-08-25T02:00:00.000Z'); // 21:00 local on Aug 24
  const service = new CalendarReadService(provider, readConfig(), 'America/Lima', () => late);
  assert.equal(await service.availability('today'), undefined);
  assert.equal(provider.busyCalls.length, 0);
});

test('capability is explicit, does not steal create-event syntax and disabled mode makes no provider calls', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const disabledConfig = loadCalendarReadConfig(loadConfig({}), {});
    const service = new CalendarReadService(provider, { ...disabledConfig, enabled: true }, 'America/Lima', () => fixedNow);
    const capability = new CalendarReadCapability(service, audit, disabledConfig, 'America/Lima');

    assert.equal(await capability.handle(message('texto normal')), undefined);
    assert.equal(await capability.handle(message('agenda mañana a las 10 reunión con Ana')), undefined);
    const disabled = await capability.handle(message('agenda hoy'));
    assert.match(disabled?.reply ?? '', /deshabilitada/);
    assert.equal(provider.listCalls.length, 0);
  } finally { db.close(); }
});

test('agenda output is bounded and audit never stores event titles', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const secret = 'QA_PRIVATE_CALENDAR_TITLE_991';
    provider.events = [
      { id: 'e1', title: secret, startDateTime: '2026-08-24T15:00:00Z', endDateTime: '2026-08-24T15:30:00Z' },
      { id: 'e2', title: 'Feriado', startDate: '2026-08-24', endDate: '2026-08-25' },
    ];
    const config = readConfig({ CALENDAR_READ_MAX_REPLY_CHARS: '500' });
    const service = new CalendarReadService(provider, config, 'America/Lima', () => fixedNow);
    const capability = new CalendarReadCapability(service, audit, config, 'America/Lima');
    const result = await capability.handle(message('agenda hoy'));

    assert.match(result?.reply ?? '', /10:00–10:30/);
    assert.match(result?.reply ?? '', /Todo el día/);
    assert.ok((result?.reply ?? '').length <= 500);
    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /calendar\.read\.agenda/);
    assert.ok(!auditJson.includes(secret));
  } finally { db.close(); }
});

test('availability rendering and failures are safe and content-free in audit', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    provider.busy = [{ startAt: '2026-08-24T15:00:00Z', endAt: '2026-08-24T16:00:00Z' }];
    const config = readConfig();
    const service = new CalendarReadService(provider, config, 'America/Lima', () => fixedNow);
    const capability = new CalendarReadCapability(service, audit, config, 'America/Lima');
    const result = await capability.handle(message('disponibilidad hoy'));
    assert.match(result?.reply ?? '', /Disponibilidad hoy/);
    assert.match(result?.reply ?? '', /11:00–20:00/);

    provider.fail = true;
    const failed = await capability.handle(message('agenda mañana'));
    assert.match(failed?.reply ?? '', /No pude consultar/);
    assert.ok(!JSON.stringify(audit.listRecent(20)).includes('PRIVATE_CALENDAR_READ_ERROR'));
  } finally { db.close(); }
});
