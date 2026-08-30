export interface GmailSearchConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  timeoutMs: number;
  maxMessages: number;
  maxReplyChars: number;
  maxTermChars: number;
  maxDateRangeDays: number;
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

function optionalSecret(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function loadGmailSearchConfig(env: NodeJS.ProcessEnv = process.env): GmailSearchConfig {
  const enabled = parseBoolean(env.GMAIL_SEARCH_ENABLED, false);
  const clientId = optionalSecret(env.GMAIL_SEARCH_CLIENT_ID);
  const clientSecret = optionalSecret(env.GMAIL_SEARCH_CLIENT_SECRET);
  const refreshToken = optionalSecret(env.GMAIL_SEARCH_REFRESH_TOKEN);

  if (enabled && !clientId) throw new Error('GMAIL_SEARCH_CLIENT_ID is required when GMAIL_SEARCH_ENABLED=true');
  if (enabled && !clientSecret) throw new Error('GMAIL_SEARCH_CLIENT_SECRET is required when GMAIL_SEARCH_ENABLED=true');
  if (enabled && !refreshToken) throw new Error('GMAIL_SEARCH_REFRESH_TOKEN is required when GMAIL_SEARCH_ENABLED=true');

  if (enabled && refreshToken) {
    const metadataToken = optionalSecret(env.GMAIL_REFRESH_TOKEN);
    const bodyToken = optionalSecret(env.GMAIL_BODY_REFRESH_TOKEN);
    if (metadataToken && refreshToken === metadataToken) {
      throw new Error('GMAIL_SEARCH_REFRESH_TOKEN must differ from GMAIL_REFRESH_TOKEN');
    }
    if (bodyToken && refreshToken === bodyToken) {
      throw new Error('GMAIL_SEARCH_REFRESH_TOKEN must differ from GMAIL_BODY_REFRESH_TOKEN');
    }
  }

  return {
    enabled,
    clientId,
    clientSecret,
    refreshToken,
    timeoutMs: parseInteger(env.GMAIL_SEARCH_TIMEOUT_MS, 20_000, 'GMAIL_SEARCH_TIMEOUT_MS', 1_000, 120_000),
    maxMessages: parseInteger(env.GMAIL_SEARCH_MAX_MESSAGES, 5, 'GMAIL_SEARCH_MAX_MESSAGES', 1, 10),
    maxReplyChars: parseInteger(env.GMAIL_SEARCH_MAX_REPLY_CHARS, 3_500, 'GMAIL_SEARCH_MAX_REPLY_CHARS', 500, 10_000),
    maxTermChars: parseInteger(env.GMAIL_SEARCH_MAX_TERM_CHARS, 200, 'GMAIL_SEARCH_MAX_TERM_CHARS', 20, 500),
    maxDateRangeDays: parseInteger(env.GMAIL_SEARCH_MAX_DATE_RANGE_DAYS, 366, 'GMAIL_SEARCH_MAX_DATE_RANGE_DAYS', 1, 3660),
  };
}
