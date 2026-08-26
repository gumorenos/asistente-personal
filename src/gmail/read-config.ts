export interface GmailContentReadConfig {
  enabled: boolean;
  maxBodyChars: number;
  maxMessageBytes: number;
  maxThreadMessages: number;
  maxReplyChars: number;
}

export interface GmailReadConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  timeoutMs: number;
  maxMessages: number;
  maxReplyChars: number;
  content?: GmailContentReadConfig;
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

export function loadGmailReadConfig(env: NodeJS.ProcessEnv = process.env): GmailReadConfig {
  const enabled = parseBoolean(env.GMAIL_READ_ENABLED, false);
  const contentEnabled = parseBoolean(env.GMAIL_CONTENT_READ_ENABLED, false);
  const clientId = optionalSecret(env.GMAIL_CLIENT_ID);
  const clientSecret = optionalSecret(env.GMAIL_CLIENT_SECRET);
  const refreshToken = optionalSecret(env.GMAIL_REFRESH_TOKEN);

  if (contentEnabled && !enabled) {
    throw new Error('GMAIL_READ_ENABLED=true is required when GMAIL_CONTENT_READ_ENABLED=true');
  }
  if (enabled && !clientId) throw new Error('GMAIL_CLIENT_ID is required when GMAIL_READ_ENABLED=true');
  if (enabled && !clientSecret) throw new Error('GMAIL_CLIENT_SECRET is required when GMAIL_READ_ENABLED=true');
  if (enabled && !refreshToken) throw new Error('GMAIL_REFRESH_TOKEN is required when GMAIL_READ_ENABLED=true');

  return {
    enabled,
    clientId,
    clientSecret,
    refreshToken,
    timeoutMs: parseInteger(env.GMAIL_TIMEOUT_MS, 20_000, 'GMAIL_TIMEOUT_MS', 1_000, 120_000),
    maxMessages: parseInteger(env.GMAIL_READ_MAX_MESSAGES, 5, 'GMAIL_READ_MAX_MESSAGES', 1, 10),
    maxReplyChars: parseInteger(env.GMAIL_READ_MAX_REPLY_CHARS, 3_500, 'GMAIL_READ_MAX_REPLY_CHARS', 500, 10_000),
    content: {
      enabled: contentEnabled,
      maxBodyChars: parseInteger(env.GMAIL_CONTENT_MAX_BODY_CHARS, 6_000, 'GMAIL_CONTENT_MAX_BODY_CHARS', 500, 50_000),
      maxMessageBytes: parseInteger(env.GMAIL_CONTENT_MAX_MESSAGE_BYTES, 1_048_576, 'GMAIL_CONTENT_MAX_MESSAGE_BYTES', 16_384, 5_242_880),
      maxThreadMessages: parseInteger(env.GMAIL_CONTENT_MAX_THREAD_MESSAGES, 5, 'GMAIL_CONTENT_MAX_THREAD_MESSAGES', 1, 10),
      maxReplyChars: parseInteger(env.GMAIL_CONTENT_MAX_REPLY_CHARS, 3_500, 'GMAIL_CONTENT_MAX_REPLY_CHARS', 500, 10_000),
    },
  };
}
