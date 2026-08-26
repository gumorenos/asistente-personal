export interface GmailBodyReadConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  timeoutMs: number;
  maxReplyChars: number;
  maxResponseBytes: number;
  selectionTtlMs: number;
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

export function loadGmailBodyReadConfig(
  env: NodeJS.ProcessEnv = process.env,
  metadataReadEnabled = parseBoolean(env.GMAIL_READ_ENABLED, false),
): GmailBodyReadConfig {
  const enabled = parseBoolean(env.GMAIL_BODY_READ_ENABLED, false);
  const clientId = optionalSecret(env.GMAIL_BODY_CLIENT_ID);
  const clientSecret = optionalSecret(env.GMAIL_BODY_CLIENT_SECRET);
  const refreshToken = optionalSecret(env.GMAIL_BODY_REFRESH_TOKEN);

  if (enabled && !metadataReadEnabled) {
    throw new Error('GMAIL_READ_ENABLED=true is required when GMAIL_BODY_READ_ENABLED=true');
  }
  if (enabled && !clientId) throw new Error('GMAIL_BODY_CLIENT_ID is required when GMAIL_BODY_READ_ENABLED=true');
  if (enabled && !clientSecret) throw new Error('GMAIL_BODY_CLIENT_SECRET is required when GMAIL_BODY_READ_ENABLED=true');
  if (enabled && !refreshToken) throw new Error('GMAIL_BODY_REFRESH_TOKEN is required when GMAIL_BODY_READ_ENABLED=true');

  const selectionTtlMinutes = parseInteger(
    env.GMAIL_BODY_SELECTION_TTL_MINUTES,
    15,
    'GMAIL_BODY_SELECTION_TTL_MINUTES',
    1,
    120,
  );

  return {
    enabled,
    clientId,
    clientSecret,
    refreshToken,
    timeoutMs: parseInteger(env.GMAIL_BODY_TIMEOUT_MS, 20_000, 'GMAIL_BODY_TIMEOUT_MS', 1_000, 120_000),
    maxReplyChars: parseInteger(env.GMAIL_BODY_MAX_REPLY_CHARS, 3_500, 'GMAIL_BODY_MAX_REPLY_CHARS', 500, 10_000),
    maxResponseBytes: parseInteger(
      env.GMAIL_BODY_MAX_RESPONSE_BYTES,
      524_288,
      'GMAIL_BODY_MAX_RESPONSE_BYTES',
      16_384,
      2_097_152,
    ),
    selectionTtlMs: selectionTtlMinutes * 60_000,
  };
}
