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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
  };
}
