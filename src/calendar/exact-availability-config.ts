import type { CalendarReadConfig } from './read-config.ts';

export interface CalendarExactAvailabilityConfig {
  enabled: boolean;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

export function loadCalendarExactAvailabilityConfig(
  calendarRead: CalendarReadConfig,
  env: NodeJS.ProcessEnv = process.env,
): CalendarExactAvailabilityConfig {
  const enabled = parseBoolean(env.CALENDAR_EXACT_AVAILABILITY_ENABLED, false);
  if (enabled && !calendarRead.enabled) {
    throw new Error('CALENDAR_READ_ENABLED=true is required when CALENDAR_EXACT_AVAILABILITY_ENABLED=true');
  }
  return { enabled };
}
