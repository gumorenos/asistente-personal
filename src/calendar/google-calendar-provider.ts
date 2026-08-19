import { createHash } from 'node:crypto';
import type { CalendarCreateEventInput, CalendarCreateEventResult, CalendarProvider } from './types.ts';
import type { GoogleOAuthAccessTokenProvider } from './google-oauth-token-provider.ts';

export interface GoogleCalendarProviderConfig {
  calendarId: string;
  timeoutMs: number;
  apiBaseUrl?: string;
}

type FetchImplementation = typeof fetch;

const BASE32HEX_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function googleEventIdFromIdempotencyKey(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey, 'utf8').digest();
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32HEX_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32HEX_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google-calendar';

  private readonly config: GoogleCalendarProviderConfig;
  private readonly tokenProvider: GoogleOAuthAccessTokenProvider;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    config: GoogleCalendarProviderConfig,
    tokenProvider: GoogleOAuthAccessTokenProvider,
    fetchImpl: FetchImplementation = fetch,
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async createEvent(
    input: CalendarCreateEventInput,
    idempotencyKey: string,
  ): Promise<CalendarCreateEventResult> {
    const eventId = googleEventIdFromIdempotencyKey(idempotencyKey);
    const startMs = new Date(input.startAt).getTime();
    const endAt = new Date(startMs + input.durationMinutes * 60_000).toISOString();
    const calendarPath = encodeURIComponent(this.config.calendarId);
    const baseUrl = (this.config.apiBaseUrl ?? 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
    const collectionUrl = `${baseUrl}/calendars/${calendarPath}/events`;

    const body = JSON.stringify({
      id: eventId,
      summary: input.title,
      start: { dateTime: input.startAt, timeZone: input.timeZone },
      end: { dateTime: endAt, timeZone: input.timeZone },
    });

    const insert = await this.authorizedFetch(collectionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    if (insert.status === 409) {
      const existing = await this.authorizedFetch(`${collectionUrl}/${encodeURIComponent(eventId)}`, { method: 'GET' });
      if (!existing.ok) throw new Error(`Google Calendar duplicate recovery failed with HTTP ${existing.status}`);
      const payload: unknown = await existing.json();
      const externalId = isRecord(payload) && typeof payload.id === 'string' ? payload.id : '';
      if (!externalId) throw new Error('Google Calendar duplicate recovery returned no event id');
      return { externalId };
    }

    if (!insert.ok) throw new Error(`Google Calendar create failed with HTTP ${insert.status}`);
    const payload: unknown = await insert.json();
    const externalId = isRecord(payload) && typeof payload.id === 'string' ? payload.id : '';
    if (!externalId) throw new Error('Google Calendar create returned no event id');
    return { externalId };
  }

  private async authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    let token = await this.tokenProvider.getAccessToken();
    let response = await this.fetchWithTimeout(url, init, token);
    if (response.status !== 401) return response;

    token = await this.tokenProvider.getAccessToken(true);
    response = await this.fetchWithTimeout(url, init, token);
    return response;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, accessToken: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref();
    try {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${accessToken}`);
      return await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Google Calendar request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
