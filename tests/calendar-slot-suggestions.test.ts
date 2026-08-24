import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarReadService } from '../src/calendar/calendar-read-service.ts';
import { CalendarSlotSuggestionService } from '../src/calendar/calendar-slot-suggestion-service.ts';
import { loadCalendarReadConfig } from '../src/calendar/read-config.ts';
import type {
  CalendarBusyInterval,
  CalendarReadEvent,
  CalendarReadProvider,
  CalendarReadRange,
} from '../src/calendar/read-types.ts';
import { loadCalendarSlotSuggestionConfig } from '../src/calendar/slot-suggestion-config.ts';
import { CalendarSlotSuggestionCapability } from '../src/capabilities/calendar-slot-suggestion-capability.ts';
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
    if (this.fail) throw new Error('PRIVATE_SLOT_PROVIDER_ERROR');
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
  const suggestions = loadCalendarSlotSuggestionConfig(app, read, values);
  return { app, read, suggestions };
}

function message(text: string): IncomingMessage {
  return {
    id: 'slot-command',
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_200_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

const fixedNow = new Date('2026-08-24T14:17:00.000Z'); // 09:17 America/Lima

test('slot suggestions are disabled by default and require Calendar read when enabled', () => {
  const baseApp = loadConfig({});
  const baseRead = loadCalendarReadConfig(baseApp, {});
  const defaults = loadCalendarSlotSuggestionConfig(baseApp, baseRead, {});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.maxSuggestions, 3);
  assert.equal(defaults.alignmentMinutes, 15);

  assert.throws(
    () => loadCalendarSlotSuggestionConfig(baseApp, baseRead, { CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' }),
    /CALENDAR_READ_ENABLED/,
  );

  const enabled = configs({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
  assert.equal(enabled.suggestions.enabled, true);
  assert.equal(enabled.app.calendar.enabled, false);
});

test('slot suggestion config validates bounded count, alignment and reply size', () => {
  assert.throws(() => configs({ CALENDAR_SLOT_ALIGNMENT_MINUTES: '7' }), /divide 60/);
  assert.throws(() => configs({ CALENDAR_SLOT_MAX_SUGGESTIONS: '6' }), /MAX_SUGGESTIONS/);
  assert.throws(() => configs({ CALENDAR_SLOT_MAX_REPLY_CHARS: '299' }), /MAX_REPLY_CHARS/);
});

test('service returns earliest aligned non-overlapping slots deterministically', async () => {
  const provider = new FakeCalendarReadProvider();
  provider.busy = [{ startAt: '2026-08-24T15:00:00.000Z', endAt: '2026-08-24T16:00:00.000Z' }]; // 10-11 Lima
  const { read, suggestions } = configs({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
  const calendarRead = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
  const service = new CalendarSlotSuggestionService(calendarRead, suggestions);

  const result = await service.suggest('today', 30);
  assert.equal(result.windowElapsed, false);
  assert.deepEqual(result.suggestions, [
    { startAt: '2026-08-24T14:30:00.000Z', endAt: '2026-08-24T15:00:00.000Z' },
    { startAt: '2026-08-24T16:00:00.000Z', endAt: '2026-08-24T16:30:00.000Z' },
    { startAt: '2026-08-24T16:30:00.000Z', endAt: '2026-08-24T17:00:00.000Z' },
  ]);
  assert.equal(provider.busyCalls.length, 1);
});

test('service supports tomorrow and rejects unsafe duration/alignment before provider work', async () => {
  const provider = new FakeCalendarReadProvider();
  const { read, suggestions } = configs({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
  const calendarRead = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
  const service = new CalendarSlotSuggestionService(calendarRead, suggestions);

  const tomorrow = await service.suggest('tomorrow', 45);
  assert.equal(tomorrow.suggestions[0]?.startAt, '2026-08-25T13:00:00.000Z'); // 08:00 Lima
  assert.equal(tomorrow.suggestions[0]?.endAt, '2026-08-25T13:45:00.000Z');

  const callsBefore = provider.busyCalls.length;
  await assert.rejects(() => service.suggest('today', 10), /between 15 and 240/);
  await assert.rejects(() => service.suggest('today', 20), /multiple of 15/);
  await assert.rejects(() => service.suggest('today', 245), /between 15 and 240/);
  assert.equal(provider.busyCalls.length, callsBefore);
});

test('capability is explicit and disabled mode performs zero Calendar work', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const baseApp = loadConfig({});
    const baseRead = loadCalendarReadConfig(baseApp, {});
    const disabled = loadCalendarSlotSuggestionConfig(baseApp, baseRead, {});
    const fakeReadConfig = { ...baseRead, enabled: true };
    const readService = new CalendarReadService(provider, fakeReadConfig, 'America/Lima', () => fixedNow);
    const service = new CalendarSlotSuggestionService(readService, { ...disabled, enabled: true });
    const capability = new CalendarSlotSuggestionCapability(service, audit, disabled, 'America/Lima');

    assert.equal(await capability.handle(message('texto normal')), undefined);
    assert.equal(await capability.handle(message('agenda mañana a las 10 reunión')), undefined);
    const response = await capability.handle(message('propón horarios hoy para 30 minutos'));
    assert.match(response?.reply ?? '', /deshabilitadas/);
    assert.equal(provider.busyCalls.length, 0);
  } finally { db.close(); }
});

test('enabled capability suggests only; it creates no action and audit contains no exact slot times', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const provider = new FakeCalendarReadProvider();
    provider.busy = [{ startAt: '2026-08-24T15:00:00.000Z', endAt: '2026-08-24T16:00:00.000Z' }];
    const { read, suggestions } = configs({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
    const readService = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const service = new CalendarSlotSuggestionService(readService, suggestions);
    const capability = new CalendarSlotSuggestionCapability(service, audit, suggestions, 'America/Lima');

    const response = await capability.handle(message('propón horarios hoy para 30 minutos'));
    assert.match(response?.reply ?? '', /1\. 09:30–10:00/);
    assert.match(response?.reply ?? '', /Solo son sugerencias/);
    assert.equal(actions.listPending(fixedNow.toISOString()).length, 0);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /calendar\.slot_suggestions/);
    assert.match(auditJson, /"durationMinutes":30/);
    assert.ok(!auditJson.includes('09:30'));
    assert.ok(!auditJson.includes('2026-08-24T14:30'));
  } finally { db.close(); }
});

test('capability validates duration locally and provider failures stay content-free', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const provider = new FakeCalendarReadProvider();
    const { read, suggestions } = configs({ CALENDAR_SLOT_SUGGESTIONS_ENABLED: 'true' });
    const readService = new CalendarReadService(provider, read, 'America/Lima', () => fixedNow);
    const service = new CalendarSlotSuggestionService(readService, suggestions);
    const capability = new CalendarSlotSuggestionCapability(service, audit, suggestions, 'America/Lima');

    const bad = await capability.handle(message('sugiere horarios hoy para 20 minutos'));
    assert.match(bad?.reply ?? '', /múltiplo de 15/);
    assert.equal(provider.busyCalls.length, 0);

    provider.fail = true;
    const failed = await capability.handle(message('propon horarios mañana para 30 minutos'));
    assert.match(failed?.reply ?? '', /No pude calcular/);
    assert.ok(!JSON.stringify(audit.listRecent(20)).includes('PRIVATE_SLOT_PROVIDER_ERROR'));
  } finally { db.close(); }
});
