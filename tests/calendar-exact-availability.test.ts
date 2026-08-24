import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCalendarExactAvailabilityConfig } from '../src/calendar/exact-availability-config.ts';
import { CalendarReadService } from '../src/calendar/calendar-read-service.ts';
import { loadCalendarReadConfig } from '../src/calendar/read-config.ts';
import type {
  CalendarBusyInterval,
  CalendarReadEvent,
  CalendarReadProvider,
  CalendarReadRange,
} from '../src/calendar/read-types.ts';
import { CalendarExactAvailabilityCapability } from '../src/capabilities/calendar-exact-availability-capability.ts';
import { loadConfig } from '../src/config.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

class FakeCalendarReadProvider implements CalendarReadProvider {
  readonly name = 'fake-calendar-read';
  busy: CalendarBusyInterval[] = [];
  busyCalls: CalendarReadRange[] = [];
  fail = false;

  async listEvents(_range: CalendarReadRange, _maxResults: number): Promise<CalendarReadEvent[]> {
    return [];
  }

  async queryBusy(range: CalendarReadRange): Promise<CalendarBusyInterval[]> {
    this.busyCalls.push(range);
    if (this.fail) throw new Error('PRIVATE_EXACT_AVAILABILITY_PROVIDER_ERROR');
    return this.busy;
  }
}

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CALENDAR_READ_ENABLED: 'true',
    GOOGLE_CALENDAR_CLIENT_ID: 'read-client',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'read-secret',
    GOOGLE_CALENDAR_REFRESH_TOKEN: 'read-refresh',
    ...extra,
  };
}

function configs(extra: NodeJS.ProcessEnv = {}) {
  const values = env(extra);
  const app = loadConfig(values);
  const read = loadCalendarReadConfig(app, values);
  const exact = loadCalendarExactAvailabilityConfig(read, values);
  return { app, read, exact };
}

function message(text: string): IncomingMessage {
  return {
    id: 'exact-command',
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_200_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

const fixedNow = new Date('2026-08-24T14:17:00.000Z'); // 09:17 America/Lima

test('exact availability is disabled by default and requires Calendar read when enabled', () => {
  const baseApp = loadConfig({});
  const baseRead = loadCalendarReadConfig(baseApp, {});
  assert.equal(loadCalendarExactAvailabilityConfig(baseRead, {}).enabled, false);
  assert.throws(
    () => loadCalendarExactAvailabilityConfig(baseRead, { CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' }),
    /CALENDAR_READ_ENABLED/,
  );

  const enabled = configs({ CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' });
  assert.equal(enabled.exact.enabled, true);
  assert.equal(enabled.app.calendar.enabled, false);
});

test('Calendar read checks only the exact requested interval and reports free/occupied without event details', async () => {
  const provider = new FakeCalendarReadProvider();
  const { read } = configs();
  const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);

  const free = await service.exactAvailability('2026-08-25T15:00:00.000Z', 30);
  assert.equal(free.isFree, true);
  assert.deepEqual(provider.busyCalls[0], {
    startAt: '2026-08-25T15:00:00.000Z',
    endAt: '2026-08-25T15:30:00.000Z',
    timeZone: 'America/Lima',
  });

  provider.busy = [
    { startAt: '2026-08-25T14:45:00.000Z', endAt: '2026-08-25T15:10:00.000Z' },
    { startAt: '2026-08-25T15:05:00.000Z', endAt: '2026-08-25T15:20:00.000Z' },
    { startAt: '2026-08-25T16:00:00.000Z', endAt: '2026-08-25T17:00:00.000Z' },
  ];
  const occupied = await service.exactAvailability('2026-08-25T15:00:00.000Z', 30);
  assert.equal(occupied.isFree, false);
  assert.deepEqual(occupied.busyIntervals, [
    { startAt: '2026-08-25T15:00:00.000Z', endAt: '2026-08-25T15:20:00.000Z' },
  ]);
});

test('exact availability treats interval boundaries as half-open and ignores adjacent busy events', async () => {
  const provider = new FakeCalendarReadProvider();
  provider.busy = [
    { startAt: '2026-08-25T14:00:00.000Z', endAt: '2026-08-25T15:00:00.000Z' },
    { startAt: '2026-08-25T15:30:00.000Z', endAt: '2026-08-25T16:00:00.000Z' },
  ];
  const { read } = configs();
  const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);

  const result = await service.exactAvailability('2026-08-25T15:00:00.000Z', 30);
  assert.equal(result.isFree, true);
  assert.deepEqual(result.busyIntervals, []);
});

test('exact availability honors an explicit interval outside the configured work window', async () => {
  const provider = new FakeCalendarReadProvider();
  const { read } = configs({
    CALENDAR_READ_DAY_START: '08:00',
    CALENDAR_READ_DAY_END: '20:00',
  });
  const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);

  const result = await service.exactAvailability('2026-08-26T02:00:00.000Z', 30); // 21:00 Lima previous local date
  assert.equal(result.isFree, true);
  assert.deepEqual(provider.busyCalls[0], {
    startAt: '2026-08-26T02:00:00.000Z',
    endAt: '2026-08-26T02:30:00.000Z',
    timeZone: 'America/Lima',
  });
});

test('exact availability rejects invalid duration, past time and over-366-day horizon before provider work', async () => {
  const provider = new FakeCalendarReadProvider();
  const { read } = configs();
  const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);

  await assert.rejects(() => service.exactAvailability('bad-date', 30), /Invalid/);
  await assert.rejects(() => service.exactAvailability('2026-08-25T15:00:00.000Z', 4), /between 5 and 480/);
  await assert.rejects(() => service.exactAvailability('2026-08-24T14:00:00.000Z', 30), /future/);
  await assert.rejects(() => service.exactAvailability('2027-08-26T15:00:00.000Z', 30), /366-day horizon/);
  assert.equal(provider.busyCalls.length, 0);
});

test('capability is explicit and disabled mode performs zero Calendar work', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const { read } = configs();
    const exact = loadCalendarExactAvailabilityConfig(read, env());
    const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const capability = new CalendarExactAvailabilityCapability(service, audit, exact, 'America/Lima', () => fixedNow);

    assert.equal(await capability.handle(message('texto normal')), undefined);
    assert.equal(await capability.handle(message('agenda mañana a las 10 reunión')), undefined);
    const response = await capability.handle(message('libre mañana a las 10 por 30 minutos'));
    assert.match(response?.reply ?? '', /deshabilitada/);
    assert.equal(provider.busyCalls.length, 0);
  } finally { db.close(); }
});

test('enabled capability parses exact future time, reports free and creates no action', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const provider = new FakeCalendarReadProvider();
    const { read, exact } = configs({ CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' });
    const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const capability = new CalendarExactAvailabilityCapability(service, audit, exact, 'America/Lima', () => fixedNow);

    const response = await capability.handle(message('¿estoy libre mañana a las 10 por 30 minutos?'));
    assert.match(response?.reply ?? '', /^📅 Sí\./);
    assert.match(response?.reply ?? '', /10:00–10:30/);
    assert.match(response?.reply ?? '', /No se creó ninguna acción ni evento/);
    assert.deepEqual(provider.busyCalls[0], {
      startAt: '2026-08-25T15:00:00.000Z',
      endAt: '2026-08-25T15:30:00.000Z',
      timeZone: 'America/Lima',
    });
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /calendar\.exact_availability/);
    assert.match(auditJson, /"durationMinutes":30/);
    assert.match(auditJson, /"isFree":true/);
    assert.ok(!auditJson.includes('10:00'));
    assert.ok(!auditJson.includes('2026-08-25T15:00'));
  } finally { db.close(); }
});

test('occupied capability response reveals no conflicting event details or exact conflict interval', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    provider.busy = [{ startAt: '2026-08-25T15:05:00.000Z', endAt: '2026-08-25T15:20:00.000Z' }];
    const { read, exact } = configs({ CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' });
    const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const capability = new CalendarExactAvailabilityCapability(service, audit, exact, 'America/Lima', () => fixedNow);

    const response = await capability.handle(message('tengo libre mañana a las 10 por 30 minutos'));
    assert.match(response?.reply ?? '', /^📅 No\./);
    assert.ok(!(response?.reply ?? '').includes('10:05'));
    assert.ok(!(response?.reply ?? '').includes('10:20'));

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /"conflictCount":1/);
    assert.ok(!auditJson.includes('15:05'));
    assert.ok(!auditJson.includes('15:20'));
  } finally { db.close(); }
});

test('invalid schedule/duration and provider failure fail safely without leaking provider error', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const { read, exact } = configs({ CALENDAR_EXACT_AVAILABILITY_ENABLED: 'true' });
    const service = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const capability = new CalendarExactAvailabilityCapability(service, audit, exact, 'America/Lima', () => fixedNow);

    const badDuration = await capability.handle(message('libre mañana a las 10 por 481 minutos'));
    assert.match(badDuration?.reply ?? '', /entre 5 y 480/);
    const badDate = await capability.handle(message('libre hoy a las 8 por 30 minutos'));
    assert.match(badDate?.reply ?? '', /fecha\/hora futura válida/);
    assert.equal(provider.busyCalls.length, 0);

    provider.fail = true;
    const failed = await capability.handle(message('libre mañana a las 10 por 30 minutos'));
    assert.match(failed?.reply ?? '', /No pude comprobar/);
    assert.ok(!JSON.stringify(audit.listRecent(20)).includes('PRIVATE_EXACT_AVAILABILITY_PROVIDER_ERROR'));
  } finally { db.close(); }
});
