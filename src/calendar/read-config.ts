import type { AppConfig } from '../config.ts';

export interface CalendarReadConfig {
  enabled: boolean;
  dayStartMinutes: number;
  dayEndMinutes: number;
  minFreeMinutes: number;
  maxEvents: number;
  maxReplyChars: number;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${value ?? ''}`);
  }
  return parsed;
}

function parseClockMinutes(value: string | undefined, fallback: string, name: string): number {
  const raw = value?.trim() || fallback;
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`${name} must use HH:MM 24-hour format`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid ${name}`);
  return hour * 60 + minute;
}

export function loadCalendarReadConfig(app: AppConfig, env: NodeJS.ProcessEnv = process.env): CalendarReadConfig {
  const enabled = parseBoolean(env.CALENDAR_READ_ENABLED, false);
  if (enabled && !app.calendar.clientId) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_ID is required when CALENDAR_READ_ENABLED=true');
  }
  if (enabled && !app.calendar.clientSecret) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET is required when CALENDAR_READ_ENABLED=true');
  }
  if (enabled && !app.calendar.refreshToken) {
    throw new Error('GOOGLE_CALENDAR_REFRESH_TOKEN is required when CALENDAR_READ_ENABLED=true');
  }

  const dayStartMinutes = parseClockMinutes(env.CALENDAR_READ_DAY_START, '08:00', 'CALENDAR_READ_DAY_START');
  const dayEndMinutes = parseClockMinutes(env.CALENDAR_READ_DAY_END, '20:00', 'CALENDAR_READ_DAY_END');
  if (dayEndMinutes <= dayStartMinutes) {
    throw new Error('CALENDAR_READ_DAY_END must be later than CALENDAR_READ_DAY_START');
  }

  return {
    enabled,
    dayStartMinutes,
    dayEndMinutes,
    minFreeMinutes: parseInteger(env.CALENDAR_READ_MIN_FREE_MINUTES, 30, 'CALENDAR_READ_MIN_FREE_MINUTES', 5, 240),
    maxEvents: parseInteger(env.CALENDAR_READ_MAX_EVENTS, 20, 'CALENDAR_READ_MAX_EVENTS', 1, 50),
    maxReplyChars: parseInteger(env.CALENDAR_READ_MAX_REPLY_CHARS, 3_500, 'CALENDAR_READ_MAX_REPLY_CHARS', 500, 10_000),
  };
}
