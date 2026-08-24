import type { GoogleOAuthAccessTokenProvider } from './google-oauth-token-provider.ts';
import type {
  CalendarBusyInterval,
  CalendarReadEvent,
  CalendarReadProvider,
  CalendarReadRange,
} from './read-types.ts';

export interface GoogleCalendarReadProviderConfig {
  calendarId: string;
  timeoutMs: number;
  apiBaseUrl?: string;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && Number.isFinite(new Date(value).getTime());
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() + 1 === month
    && candidate.getUTCDate() === day;
}

function eventBoundary(value: unknown): { dateTime?: string; date?: string } | undefined {
  if (!isRecord(value)) return undefined;
  if (validIsoInstant(value.dateTime)) return { dateTime: value.dateTime };
  if (validDateOnly(value.date)) return { date: value.date };
  return undefined;
}

function normalizeEvent(value: unknown): CalendarReadEvent | undefined {
  if (!isRecord(value) || value.status === 'cancelled' || typeof value.id !== 'string' || !value.id.trim()) return undefined;
  const start = eventBoundary(value.start);
  const end = eventBoundary(value.end);
  if (!start || !end) return undefined;
  const title = typeof value.summary === 'string' && value.summary.trim()
    ? value.summary.trim().slice(0, 500)
    : '(sin título)';
  return {
    id: value.id.slice(0, 1024),
    title,
    startDateTime: start.dateTime,
    endDateTime: end.dateTime,
    startDate: start.date,
    endDate: end.date,
  };
}

function normalizeBusy(value: unknown): CalendarBusyInterval | undefined {
  if (!isRecord(value) || !validIsoInstant(value.start) || !validIsoInstant(value.end)) return undefined;
  if (new Date(value.end).getTime() <= new Date(value.start).getTime()) return undefined;
  return { startAt: value.start, endAt: value.end };
}

export class GoogleCalendarReadProvider implements CalendarReadProvider {
  readonly name = 'google-calendar-read';

  private readonly config: GoogleCalendarReadProviderConfig;
  private readonly tokenProvider: GoogleOAuthAccessTokenProvider;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    config: GoogleCalendarReadProviderConfig,
    tokenProvider: GoogleOAuthAccessTokenProvider,
    fetchImpl: FetchImplementation = fetch,
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async listEvents(range: CalendarReadRange, maxResults: number): Promise<CalendarReadEvent[]> {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new Error('Invalid Calendar read maxResults');
    this.validateRange(range);
    const baseUrl = this.baseUrl();
    const calendarPath = encodeURIComponent(this.config.calendarId);
    const query = new URLSearchParams({
      timeMin: range.startAt,
      timeMax: range.endAt,
      timeZone: range.timeZone,
      singleEvents: 'true',
      orderBy: 'startTime',
      showDeleted: 'false',
      maxResults: String(maxResults),
      fields: 'items(id,status,summary,start,end)',
    });
    const response = await this.authorizedFetch(`${baseUrl}/calendars/${calendarPath}/events?${query.toString()}`, { method: 'GET' });
    if (!response.ok) throw new Error(`Google Calendar read failed with HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload)) throw new Error('Google Calendar read returned an invalid response');
    const items = payload.items === undefined ? [] : payload.items;
    if (!Array.isArray(items)) throw new Error('Google Calendar read returned an invalid response');
    return items.map(normalizeEvent).filter((event): event is CalendarReadEvent => event !== undefined).slice(0, maxResults);
  }

  async queryBusy(range: CalendarReadRange): Promise<CalendarBusyInterval[]> {
    this.validateRange(range);
    const body = JSON.stringify({
      timeMin: range.startAt,
      timeMax: range.endAt,
      timeZone: range.timeZone,
      items: [{ id: this.config.calendarId }],
    });
    const response = await this.authorizedFetch(`${this.baseUrl()}/freeBusy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!response.ok) throw new Error(`Google Calendar free/busy failed with HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.calendars)) {
      throw new Error('Google Calendar free/busy returned an invalid response');
    }
    const exact = payload.calendars[this.config.calendarId];
    const entries = Object.values(payload.calendars);
    const calendar = isRecord(exact) ? exact : entries.length === 1 && isRecord(entries[0]) ? entries[0] : undefined;
    if (!calendar || (Array.isArray(calendar.errors) && calendar.errors.length > 0) || !Array.isArray(calendar.busy)) {
      throw new Error('Google Calendar free/busy returned calendar errors');
    }
    return calendar.busy.map(normalizeBusy).filter((slot): slot is CalendarBusyInterval => slot !== undefined);
  }

  private validateRange(range: CalendarReadRange): void {
    const start = new Date(range.startAt).getTime();
    const end = new Date(range.endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !range.timeZone) {
      throw new Error('Invalid Calendar read range');
    }
  }

  private baseUrl(): string {
    return (this.config.apiBaseUrl ?? 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');
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
      if (controller.signal.aborted) throw new Error('Google Calendar read request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
