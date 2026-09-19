export interface ExecutiveBriefingConfig {
  enabled: boolean;
  maxActionItems: number;
  maxCalendarEvents: number;
  maxGmailMessages: number;
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
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${name}: ${value ?? ''}`);
  return parsed;
}

export function loadExecutiveBriefingConfig(env: NodeJS.ProcessEnv = process.env): ExecutiveBriefingConfig {
  return {
    enabled: parseBoolean(env.EXECUTIVE_BRIEFING_ENABLED, false),
    maxActionItems: parseInteger(env.EXECUTIVE_BRIEFING_MAX_ACTION_ITEMS, 5, 'EXECUTIVE_BRIEFING_MAX_ACTION_ITEMS', 1, 10),
    maxCalendarEvents: parseInteger(env.EXECUTIVE_BRIEFING_MAX_CALENDAR_EVENTS, 5, 'EXECUTIVE_BRIEFING_MAX_CALENDAR_EVENTS', 1, 10),
    maxGmailMessages: parseInteger(env.EXECUTIVE_BRIEFING_MAX_GMAIL_MESSAGES, 3, 'EXECUTIVE_BRIEFING_MAX_GMAIL_MESSAGES', 1, 5),
    maxReplyChars: parseInteger(env.EXECUTIVE_BRIEFING_MAX_REPLY_CHARS, 3_500, 'EXECUTIVE_BRIEFING_MAX_REPLY_CHARS', 1_000, 6_000),
  };
}
