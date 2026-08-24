import type { AppConfig } from '../config.ts';
import type { CalendarReadConfig } from './read-config.ts';

export interface CalendarSlotSuggestionConfig {
  enabled: boolean;
  maxSuggestions: number;
  alignmentMinutes: number;
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

export function loadCalendarSlotSuggestionConfig(
  app: AppConfig,
  calendarRead: CalendarReadConfig,
  env: NodeJS.ProcessEnv = process.env,
): CalendarSlotSuggestionConfig {
  const enabled = parseBoolean(env.CALENDAR_SLOT_SUGGESTIONS_ENABLED, false);
  if (enabled && !calendarRead.enabled) {
    throw new Error('CALENDAR_READ_ENABLED=true is required when CALENDAR_SLOT_SUGGESTIONS_ENABLED=true');
  }

  const alignmentMinutes = parseInteger(
    env.CALENDAR_SLOT_ALIGNMENT_MINUTES,
    15,
    'CALENDAR_SLOT_ALIGNMENT_MINUTES',
    5,
    60,
  );
  if (60 % alignmentMinutes !== 0) {
    throw new Error('CALENDAR_SLOT_ALIGNMENT_MINUTES must divide 60 exactly');
  }

  // Touch shared Calendar config deliberately so this loader remains tied to the
  // same configured calendar identity without introducing a second credential set.
  void app.calendar.calendarId;

  return {
    enabled,
    maxSuggestions: parseInteger(env.CALENDAR_SLOT_MAX_SUGGESTIONS, 3, 'CALENDAR_SLOT_MAX_SUGGESTIONS', 1, 5),
    alignmentMinutes,
    maxReplyChars: parseInteger(env.CALENDAR_SLOT_MAX_REPLY_CHARS, 2_000, 'CALENDAR_SLOT_MAX_REPLY_CHARS', 300, 5_000),
  };
}
