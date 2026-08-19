export interface AppConfig {
  nodeEnv: string;
  dbPath: string;
  healthHost: string;
  healthPort: number;
  timeZone: string;
  whatsapp: {
    enabled: boolean;
    phoneNumber?: string;
    selfJids: string[];
    logMessageContent: boolean;
  };
  ai: {
    enabled: boolean;
    provider: 'openai-compatible';
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    maxInputChars: number;
    maxReplyChars: number;
    maxOutputTokens: number;
  };
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid HEALTH_PORT: ${value ?? ''}`);
  }
  return parsed;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${value ?? ''}`);
  }
  return parsed;
}

function parseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || 'America/Lima';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid APP_TIMEZONE: ${timeZone}`);
  }
  return timeZone;
}

function parsePhoneNumber(value: string | undefined): string | undefined {
  const phone = value?.trim();
  if (!phone) return undefined;
  if (!/^\d{8,15}$/.test(phone)) {
    throw new Error('WHATSAPP_PHONE_NUMBER must contain 8-15 E.164 digits without + or spaces');
  }
  return phone;
}

function parseSelfJids(value: string | undefined): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  for (const jid of parsed) {
    if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) {
      throw new Error(`Invalid WHATSAPP_SELF_JIDS entry: ${jid}`);
    }
  }
  return [...new Set(parsed)];
}

function parseAiProvider(value: string | undefined): 'openai-compatible' {
  const provider = value?.trim().toLowerCase() || 'openai-compatible';
  if (provider !== 'openai-compatible') throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  return provider;
}

function parseAiBaseUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('AI_BASE_URL must be a valid absolute URL');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('AI_BASE_URL must use HTTPS, except for localhost/loopback HTTP');
  }
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const aiEnabled = parseBoolean(env.AI_ENABLED, false);
  const aiBaseUrl = parseAiBaseUrl(env.AI_BASE_URL);
  const aiModel = env.AI_MODEL?.trim() || undefined;
  const aiApiKey = env.AI_API_KEY?.trim() || undefined;

  if (aiEnabled && !aiBaseUrl) throw new Error('AI_BASE_URL is required when AI_ENABLED=true');
  if (aiEnabled && !aiModel) throw new Error('AI_MODEL is required when AI_ENABLED=true');
  if (aiEnabled && aiBaseUrl) {
    const url = new URL(aiBaseUrl);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (!loopback && !aiApiKey) throw new Error('AI_API_KEY is required for a non-loopback AI_BASE_URL');
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    dbPath: env.APP_DB_PATH ?? './data/assistant.db',
    healthHost: env.HEALTH_HOST ?? '127.0.0.1',
    healthPort: parsePort(env.HEALTH_PORT, 8787),
    timeZone: parseTimeZone(env.APP_TIMEZONE),
    whatsapp: {
      enabled: parseBoolean(env.WHATSAPP_ENABLED, false),
      phoneNumber: parsePhoneNumber(env.WHATSAPP_PHONE_NUMBER),
      selfJids: parseSelfJids(env.WHATSAPP_SELF_JIDS),
      logMessageContent: parseBoolean(env.LOG_MESSAGE_CONTENT, false),
    },
    ai: {
      enabled: aiEnabled,
      provider: parseAiProvider(env.AI_PROVIDER),
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      model: aiModel,
      timeoutMs: parsePositiveInteger(env.AI_TIMEOUT_MS, 20_000, 'AI_TIMEOUT_MS', 1_000, 120_000),
      maxInputChars: parsePositiveInteger(env.AI_MAX_INPUT_CHARS, 4_000, 'AI_MAX_INPUT_CHARS', 100, 20_000),
      maxReplyChars: parsePositiveInteger(env.AI_MAX_REPLY_CHARS, 3_500, 'AI_MAX_REPLY_CHARS', 100, 20_000),
      maxOutputTokens: parsePositiveInteger(env.AI_MAX_OUTPUT_TOKENS, 800, 'AI_MAX_OUTPUT_TOKENS', 32, 8_192),
    },
  };
}
