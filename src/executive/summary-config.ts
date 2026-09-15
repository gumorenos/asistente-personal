export interface ExecutiveSummaryConfig {
  enabled: boolean;
  maxGmailMessages: number;
  maxCalendarEvents: number;
  maxLocalItems: number;
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

export function loadExecutiveSummaryConfig(env: NodeJS.ProcessEnv = process.env): ExecutiveSummaryConfig {
  return {
    enabled: parseBoolean(env.EXECUTIVE_SUMMARY_ENABLED, false),
    maxGmailMessages: parseInteger(env.EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES, 3, 'EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES', 1, 5),
    maxCalendarEvents: parseInteger(env.EXECUTIVE_SUMMARY_MAX_CALENDAR_EVENTS, 5, 'EXECUTIVE_SUMMARY_MAX_CALENDAR_EVENTS', 1, 10),
    maxLocalItems: parseInteger(env.EXECUTIVE_SUMMARY_MAX_LOCAL_ITEMS, 3, 'EXECUTIVE_SUMMARY_MAX_LOCAL_ITEMS', 1, 5),
    maxReplyChars: parseInteger(env.EXECUTIVE_SUMMARY_MAX_REPLY_CHARS, 3_500, 'EXECUTIVE_SUMMARY_MAX_REPLY_CHARS', 1_000, 6_000),
  };
}
