export interface AppConfig {
  nodeEnv: string;
  dbPath: string;
  healthHost: string;
  healthPort: number;
  whatsapp: {
    enabled: boolean;
    phoneNumber?: string;
    selfJids: string[];
    logMessageContent: boolean;
  };
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid HEALTH_PORT: ${value ?? ''}`);
  }
  return parsed;
}

function parseSelfJids(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    dbPath: env.APP_DB_PATH ?? './data/assistant.db',
    healthHost: env.HEALTH_HOST ?? '127.0.0.1',
    healthPort: parsePort(env.HEALTH_PORT, 8787),
    whatsapp: {
      enabled: parseBoolean(env.WHATSAPP_ENABLED, false),
      phoneNumber: env.WHATSAPP_PHONE_NUMBER?.trim() || undefined,
      selfJids: parseSelfJids(env.WHATSAPP_SELF_JIDS),
      logMessageContent: parseBoolean(env.LOG_MESSAGE_CONTENT, false),
    },
  };
}
