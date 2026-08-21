import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleCalendarProvider, googleEventIdFromIdempotencyKey } from '../src/calendar/google-calendar-provider.ts';
import { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';

const input = {
  title: 'Reunión privada',
  startAt: '2026-08-20T15:00:00.000Z',
  durationMinutes: 30,
  timeZone: 'America/Lima',
};

test('deterministic Google event id uses valid base32hex characters and is stable', () => {
  const first = googleEventIdFromIdempotencyKey('calendar-create-action-123');
  const second = googleEventIdFromIdempotencyKey('calendar-create-action-123');
  const other = googleEventIdFromIdempotencyKey('calendar-create-action-124');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-v]{5,1024}$/);
});

test('OAuth refresh uses form-encoded offline credential material and caches access token', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const provider = new GoogleOAuthAccessTokenProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    timeoutMs: 5_000,
  }, fakeFetch, () => 1_000_000);

  assert.equal(await provider.getAccessToken(), 'access-1');
  assert.equal(await provider.getAccessToken(), 'access-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://oauth2.googleapis.com/token');
  const body = requests[0]?.init?.body as URLSearchParams;
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('client_id'), 'client-id');
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.equal(body.get('refresh_token'), 'refresh-token');
});

test('OAuth forced refresh bypasses cache and errors never expose response body', async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), { status: 200 });
    return new Response('private oauth body', { status: 401 });
  }) as typeof fetch;
  const provider = new GoogleOAuthAccessTokenProvider({
    clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token', timeoutMs: 5_000,
  }, fakeFetch, () => 1_000_000);

  assert.equal(await provider.getAccessToken(), 'access-1');
  await assert.rejects(
    () => provider.getAccessToken(true),
    (error: unknown) => error instanceof Error && /HTTP 401/.test(error.message) && !/private oauth body/.test(error.message),
  );
});

test('Google provider inserts deterministic event id and computes end time', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tokenFetch = (async () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })) as typeof fetch;
  const tokenProvider = new GoogleOAuthAccessTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', timeoutMs: 5_000,
  }, tokenFetch);
  const apiFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = JSON.parse(String(init?.body)) as { id: string };
    return new Response(JSON.stringify({ id: body.id }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider, apiFetch);

  const result = await provider.createEvent(input, 'calendar-create-action-1');
  const eventId = googleEventIdFromIdempotencyKey('calendar-create-action-1');
  assert.deepEqual(result, { externalId: eventId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://calendar.test/v3/calendars/primary/events');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer token');
  const body = JSON.parse(String(calls[0]?.init?.body)) as {
    id: string;
    summary: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  };
  assert.equal(body.id, eventId);
  assert.equal(body.summary, 'Reunión privada');
  assert.equal(body.start.dateTime, '2026-08-20T15:00:00.000Z');
  assert.equal(body.end.dateTime, '2026-08-20T15:30:00.000Z');
  assert.equal(body.start.timeZone, 'America/Lima');
  assert.equal(body.end.timeZone, 'America/Lima');
});

test('409 duplicate is recovered by GET of the deterministic event id', async () => {
  const tokenFetch = (async () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })) as typeof fetch;
  const tokenProvider = new GoogleOAuthAccessTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', timeoutMs: 5_000,
  }, tokenFetch);
  const calls: string[] = [];
  const apiFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    if (init?.method === 'POST') return new Response('duplicate private body', { status: 409 });
    return new Response(JSON.stringify({ id: googleEventIdFromIdempotencyKey('calendar-create-action-1') }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider, apiFetch);

  const result = await provider.createEvent(input, 'calendar-create-action-1');
  assert.equal(result.externalId, googleEventIdFromIdempotencyKey('calendar-create-action-1'));
  assert.equal(calls.length, 2);
  assert.match(calls[1] ?? '', /^GET .*\/events\/[0-9a-v]+$/);
});

test('Calendar provider refreshes token once on 401 and never exposes upstream body', async () => {
  let tokenCalls = 0;
  const tokenFetch = (async () => {
    tokenCalls += 1;
    return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const tokenProvider = new GoogleOAuthAccessTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', timeoutMs: 5_000,
  }, tokenFetch);
  let apiCalls = 0;
  const apiFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    apiCalls += 1;
    if (apiCalls === 1) return new Response('expired private body', { status: 401 });
    const body = JSON.parse(String(init?.body)) as { id: string };
    return new Response(JSON.stringify({ id: body.id }), { status: 200 });
  }) as typeof fetch;
  const provider = new GoogleCalendarProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider, apiFetch);

  await provider.createEvent(input, 'calendar-create-action-1');
  assert.equal(tokenCalls, 2);
  assert.equal(apiCalls, 2);
});

test('Calendar HTTP failure exposes only status, not remote body', async () => {
  const tokenFetch = (async () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })) as typeof fetch;
  const tokenProvider = new GoogleOAuthAccessTokenProvider({
    clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', timeoutMs: 5_000,
  }, tokenFetch);
  const apiFetch = (async () => new Response('calendar private body', { status: 403 })) as typeof fetch;
  const provider = new GoogleCalendarProvider({
    calendarId: 'primary', timeoutMs: 5_000, apiBaseUrl: 'https://calendar.test/v3',
  }, tokenProvider, apiFetch);

  await assert.rejects(
    () => provider.createEvent(input, 'calendar-create-action-1'),
    (error: unknown) => error instanceof Error && /HTTP 403/.test(error.message) && !/calendar private body/.test(error.message),
  );
});
