export interface ExecutivePrioritiesConfig {
  enabled: boolean;
  maxActionItems: number;
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
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${value ?? ''}`);
  }
  return parsed;
}

export function loadExecutivePrioritiesConfig(env: NodeJS.ProcessEnv = process.env): ExecutivePrioritiesConfig {
  return {
    enabled: parseBoolean(env.EXECUTIVE_PRIORITIES_ENABLED, false),
    maxActionItems: parseInteger(env.EXECUTIVE_PRIORITIES_MAX_ACTION_ITEMS, 5, 'EXECUTIVE_PRIORITIES_MAX_ACTION_ITEMS', 1, 10),
    maxGmailMessages: parseInteger(env.EXECUTIVE_PRIORITIES_MAX_GMAIL_MESSAGES, 3, 'EXECUTIVE_PRIORITIES_MAX_GMAIL_MESSAGES', 1, 5),
    maxReplyChars: parseInteger(env.EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS, 2_500, 'EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS', 800, 5_000),
  };
}
