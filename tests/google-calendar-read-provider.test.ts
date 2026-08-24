import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleCalendarReadProvider } from '../src/calendar/google-calendar-read-provider.ts';
import { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';

function tokenProvider(fetchImpl?: typeof fetch) {
  const tokenFetch = fetchImpl ?? (async () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })) as typeof fetch;
  return new GoogleOAuthAccessTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', timeoutMs: 5_000,
  }, tokenFetch, () => 1_000_000);
}

const range = {
  startAt: '2026-08-24T05:00:00.000Z',
  endAt: '2026-08-25T05:00:00.000Z',
  timeZone: 'America/Lima',
};

test('events.list uses a bounded read-only projection and normalizes timed/all-day events', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const apiFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      items: [
        {
          id: 'timed-1', status: 'confirmed', summary: 'Reunión privada',
          start: { dateTime: '2026-08-24T15:00:00Z' }, end: { dateTime: '2026-08-24T15:30:00Z' },
          description: 'NO_DEBE_USARSE', attendees: [{ email: 'private@example.com' }],
        },
        {
          id: 'all-day', status: 'confirmed', summary: 'Feriado',
          start: { date: '2026-08-24' }, end: { date: '2026-08-25' },
        },
        { id: 'cancelled', status: 'cancelled', summary: 'Cancelado', start: { date: '2026-08-24' }, end: { date: '2026-08-25' } },
      ],
    }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(), apiFetch);

  const events = await provider.listEvents(range, 20);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    id: 'timed-1', title: 'Reunión privada', startDateTime: '2026-08-24T15:00:00Z', endDateTime: '2026-08-24T15:30:00Z',
    startDate: undefined, endDate: undefined,
  });
  assert.equal(events[1]?.startDate, '2026-08-24');
  assert.ok(!JSON.stringify(events).includes('NO_DEBE_USARSE'));
  assert.ok(!JSON.stringify(events).includes('private@example.com'));

  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, '/v3/calendars/primary/events');
  assert.equal(url.searchParams.get('timeMin'), range.startAt);
  assert.equal(url.searchParams.get('timeMax'), range.endAt);
  assert.equal(url.searchParams.get('timeZone'), 'America/Lima');
  assert.equal(url.searchParams.get('singleEvents'), 'true');
  assert.equal(url.searchParams.get('orderBy'), 'startTime');
  assert.equal(url.searchParams.get('maxResults'), '20');
  assert.equal(url.searchParams.get('fields'), 'items(id,status,summary,start,end)');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer token');
});

test('freeBusy sends one calendar and returns only valid busy intervals', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const apiFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      calendars: {
        primary: {
          busy: [
            { start: '2026-08-24T14:00:00Z', end: '2026-08-24T15:00:00Z' },
            { start: 'bad', end: '2026-08-24T16:00:00Z' },
          ],
        },
      },
    }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(), apiFetch);

  const busy = await provider.queryBusy(range);
  assert.deepEqual(busy, [{ startAt: '2026-08-24T14:00:00Z', endAt: '2026-08-24T15:00:00Z' }]);
  assert.equal(calls[0]?.url, 'https://calendar.test/v3/freeBusy');
  const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, { timeMin: range.startAt, timeMax: range.endAt, timeZone: range.timeZone, items: [{ id: 'primary' }] });
});

test('read provider refreshes token once after 401', async () => {
  let tokenCalls = 0;
  const tokenFetch = (async () => {
    tokenCalls += 1;
    return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  let apiCalls = 0;
  const apiFetch = (async () => {
    apiCalls += 1;
    if (apiCalls === 1) return new Response('private expired body', { status: 401 });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(tokenFetch), apiFetch);

  assert.deepEqual(await provider.listEvents(range, 10), []);
  assert.equal(tokenCalls, 2);
  assert.equal(apiCalls, 2);
});

test('HTTP and calendar-level errors never expose upstream bodies/details', async () => {
  const httpProvider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(), (async () => new Response('PRIVATE_CALENDAR_BODY', { status: 403 })) as typeof fetch);
  await assert.rejects(
    () => httpProvider.listEvents(range, 10),
    (error: unknown) => error instanceof Error && /HTTP 403/.test(error.message) && !/PRIVATE_CALENDAR_BODY/.test(error.message),
  );

  const freeBusyProvider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(), (async () => new Response(JSON.stringify({ calendars: { primary: { errors: [{ reason: 'PRIVATE_REASON' }], busy: [] } } }), { status: 200 })) as typeof fetch);
  await assert.rejects(
    () => freeBusyProvider.queryBusy(range),
    (error: unknown) => error instanceof Error && /calendar errors/.test(error.message) && !/PRIVATE_REASON/.test(error.message),
  );
});

test('provider rejects invalid range and event count before network', async () => {
  let calls = 0;
  const provider = new GoogleCalendarReadProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider(), (async () => { calls += 1; return new Response('{}'); }) as typeof fetch);
  await assert.rejects(() => provider.listEvents(range, 51), /maxResults/);
  await assert.rejects(() => provider.queryBusy({ ...range, endAt: range.startAt }), /range/);
  assert.equal(calls, 0);
});
