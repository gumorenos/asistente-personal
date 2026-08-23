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
  transcription: {
    enabled: boolean;
    provider: 'openai-compatible';
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
    maxBytes: number;
    maxTranscriptChars: number;
  };
  documents: {
    enabled: boolean;
    maxBytes: number;
    maxPages: number;
    maxTextChars: number;
    timeoutMs: number;
    ocr: {
      enabled: boolean;
      maxPages: number;
      dpi: number;
      languages: string;
      timeoutMs: number;
    };
    retention: {
      enabled: boolean;
      days: number;
    };
  };
  calendar: {
    enabled: boolean;
    provider: 'google';
    calendarId: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    timeoutMs: number;
  };
  briefing: {
    enabled: boolean;
    hour: number;
    minute: number;
    destinationJid?: string;
  };
  observer: {
    enabled: boolean;
  };
  retention: {
    enabled: boolean;
    messageDays: number;
    outboundDays: number;
    auditDays: number;
    briefingDays: number;
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

function parsePositiveInteger(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${name}: ${value ?? ''}`);
  return parsed;
}

function parseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || 'America/Lima';
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0)); }
  catch { throw new Error(`Invalid APP_TIMEZONE: ${timeZone}`); }
  return timeZone;
}

function parsePhoneNumber(value: string | undefined): string | undefined {
  const phone = value?.trim();
  if (!phone) return undefined;
  if (!/^\d{8,15}$/.test(phone)) throw new Error('WHATSAPP_PHONE_NUMBER must contain 8-15 E.164 digits without + or spaces');
  return phone;
}

function isValidSelfJid(jid: string): boolean {
  return /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid);
}

function parseSelfJids(value: string | undefined): string[] {
  const parsed = (value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const jid of parsed) if (!isValidSelfJid(jid)) throw new Error(`Invalid WHATSAPP_SELF_JIDS entry: ${jid}`);
  return [...new Set(parsed)];
}

function parseProvider(value: string | undefined, name: string): 'openai-compatible' {
  const provider = value?.trim().toLowerCase() || 'openai-compatible';
  if (provider !== 'openai-compatible') throw new Error(`Unsupported ${name}: ${provider}`);
  return provider;
}

function parseCalendarProvider(value: string | undefined): 'google' {
  const provider = value?.trim().toLowerCase() || 'google';
  if (provider !== 'google') throw new Error(`Unsupported CALENDAR_PROVIDER: ${provider}`);
  return provider;
}

function parseCalendarId(value: string | undefined): string {
  const calendarId = value?.trim() || 'primary';
  if (!calendarId || calendarId.length > 512 || /\s/.test(calendarId)) throw new Error('Invalid GOOGLE_CALENDAR_ID');
  return calendarId;
}

function parseOcrLanguages(value: string | undefined): string {
  const languages = value?.trim().toLowerCase() || 'spa+eng';
  const parts = languages.split('+');
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !['spa', 'eng'].includes(part)) || new Set(parts).size !== parts.length) {
    throw new Error('Invalid DOCUMENTS_OCR_LANGUAGES: supports only spa and eng');
  }
  return languages;
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function parseExternalBaseUrl(value: string | undefined, name: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`${name} must be a valid absolute URL`); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error(`${name} must use HTTPS, except for localhost/loopback HTTP`);
  }
  return url.toString().replace(/\/$/, '');
}

function validateExternalProvider(enabled: boolean, baseUrl: string | undefined, model: string | undefined, apiKey: string | undefined, prefix: 'AI' | 'TRANSCRIPTION'): void {
  if (!enabled) return;
  if (!baseUrl) throw new Error(`${prefix}_BASE_URL is required when ${prefix}_ENABLED=true`);
  if (!model) throw new Error(`${prefix}_MODEL is required when ${prefix}_ENABLED=true`);
  const url = new URL(baseUrl);
  if (!isLoopback(url.hostname) && !apiKey) throw new Error(`${prefix}_API_KEY is required for a non-loopback ${prefix}_BASE_URL`);
}

function requiredSecret(value: string | undefined, name: string, enabled: boolean): string | undefined {
  const trimmed = value?.trim() || undefined;
  if (enabled && !trimmed) throw new Error(`${name} is required when CALENDAR_ENABLED=true`);
  return trimmed;
}

function parseDailyTime(value: string | undefined): { hour: number; minute: number } {
  const raw = value?.trim() || '08:00';
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error('BRIEFING_TIME must use HH:MM 24-hour format');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Invalid BRIEFING_TIME');
  return { hour, minute };
}

function parseOptionalSelfJid(value: string | undefined, name: string): string | undefined {
  const jid = value?.trim().toLowerCase();
  if (!jid) return undefined;
  if (!isValidSelfJid(jid)) throw new Error(`Invalid ${name}`);
  return jid;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const whatsappEnabled = parseBoolean(env.WHATSAPP_ENABLED, false);
  const selfJids = parseSelfJids(env.WHATSAPP_SELF_JIDS);

  const aiEnabled = parseBoolean(env.AI_ENABLED, false);
  const aiBaseUrl = parseExternalBaseUrl(env.AI_BASE_URL, 'AI_BASE_URL');
  const aiModel = env.AI_MODEL?.trim() || undefined;
  const aiApiKey = env.AI_API_KEY?.trim() || undefined;
  validateExternalProvider(aiEnabled, aiBaseUrl, aiModel, aiApiKey, 'AI');

  const transcriptionEnabled = parseBoolean(env.TRANSCRIPTION_ENABLED, false);
  const transcriptionBaseUrl = parseExternalBaseUrl(env.TRANSCRIPTION_BASE_URL, 'TRANSCRIPTION_BASE_URL');
  const transcriptionModel = env.TRANSCRIPTION_MODEL?.trim() || undefined;
  const transcriptionApiKey = env.TRANSCRIPTION_API_KEY?.trim() || undefined;
  validateExternalProvider(transcriptionEnabled, transcriptionBaseUrl, transcriptionModel, transcriptionApiKey, 'TRANSCRIPTION');

  const documentsEnabled = parseBoolean(env.DOCUMENTS_ENABLED, false);
  const documentOcrEnabled = parseBoolean(env.DOCUMENTS_OCR_ENABLED, false);
  if (documentOcrEnabled && !documentsEnabled) {
    throw new Error('DOCUMENTS_ENABLED=true is required when DOCUMENTS_OCR_ENABLED=true');
  }
  const documentRetentionEnabled = parseBoolean(env.DOCUMENT_RETENTION_ENABLED, false);

  const calendarEnabled = parseBoolean(env.CALENDAR_ENABLED, false);
  const calendarClientId = requiredSecret(env.GOOGLE_CALENDAR_CLIENT_ID, 'GOOGLE_CALENDAR_CLIENT_ID', calendarEnabled);
  const calendarClientSecret = requiredSecret(env.GOOGLE_CALENDAR_CLIENT_SECRET, 'GOOGLE_CALENDAR_CLIENT_SECRET', calendarEnabled);
  const calendarRefreshToken = requiredSecret(env.GOOGLE_CALENDAR_REFRESH_TOKEN, 'GOOGLE_CALENDAR_REFRESH_TOKEN', calendarEnabled);

  const briefingEnabled = parseBoolean(env.BRIEFING_ENABLED, false);
  const briefingTime = parseDailyTime(env.BRIEFING_TIME);
  const briefingDestinationJid = parseOptionalSelfJid(env.BRIEFING_DESTINATION_JID, 'BRIEFING_DESTINATION_JID');
  if (briefingEnabled && !whatsappEnabled) throw new Error('WHATSAPP_ENABLED=true is required when BRIEFING_ENABLED=true');
  if (briefingEnabled && !briefingDestinationJid) throw new Error('BRIEFING_DESTINATION_JID is required when BRIEFING_ENABLED=true');
  if (briefingEnabled && briefingDestinationJid && !selfJids.includes(briefingDestinationJid)) {
    throw new Error('BRIEFING_DESTINATION_JID must be present in WHATSAPP_SELF_JIDS');
  }

  const observerEnabled = parseBoolean(env.OBSERVER_ENABLED, false);
  if (observerEnabled && !whatsappEnabled) throw new Error('WHATSAPP_ENABLED=true is required when OBSERVER_ENABLED=true');
  if (observerEnabled && selfJids.length === 0) {
    throw new Error('WHATSAPP_SELF_JIDS must contain an administrative self-chat when OBSERVER_ENABLED=true');
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    dbPath: env.APP_DB_PATH ?? './data/assistant.db',
    healthHost: env.HEALTH_HOST ?? '127.0.0.1',
    healthPort: parsePort(env.HEALTH_PORT, 8787),
    timeZone: parseTimeZone(env.APP_TIMEZONE),
    whatsapp: {
      enabled: whatsappEnabled,
      phoneNumber: parsePhoneNumber(env.WHATSAPP_PHONE_NUMBER),
      selfJids,
      logMessageContent: parseBoolean(env.LOG_MESSAGE_CONTENT, false),
    },
    ai: {
      enabled: aiEnabled,
      provider: parseProvider(env.AI_PROVIDER, 'AI_PROVIDER'),
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      model: aiModel,
      timeoutMs: parsePositiveInteger(env.AI_TIMEOUT_MS, 20_000, 'AI_TIMEOUT_MS', 1_000, 120_000),
      maxInputChars: parsePositiveInteger(env.AI_MAX_INPUT_CHARS, 4_000, 'AI_MAX_INPUT_CHARS', 100, 20_000),
      maxReplyChars: parsePositiveInteger(env.AI_MAX_REPLY_CHARS, 3_500, 'AI_MAX_REPLY_CHARS', 100, 20_000),
      maxOutputTokens: parsePositiveInteger(env.AI_MAX_OUTPUT_TOKENS, 800, 'AI_MAX_OUTPUT_TOKENS', 32, 8_192),
    },
    transcription: {
      enabled: transcriptionEnabled,
      provider: parseProvider(env.TRANSCRIPTION_PROVIDER, 'TRANSCRIPTION_PROVIDER'),
      baseUrl: transcriptionBaseUrl,
      apiKey: transcriptionApiKey,
      model: transcriptionModel,
      timeoutMs: parsePositiveInteger(env.TRANSCRIPTION_TIMEOUT_MS, 60_000, 'TRANSCRIPTION_TIMEOUT_MS', 1_000, 180_000),
      maxBytes: parsePositiveInteger(env.TRANSCRIPTION_MAX_BYTES, 15 * 1024 * 1024, 'TRANSCRIPTION_MAX_BYTES', 1_024, 25 * 1024 * 1024),
      maxTranscriptChars: parsePositiveInteger(env.TRANSCRIPTION_MAX_CHARS, 6_000, 'TRANSCRIPTION_MAX_CHARS', 100, 20_000),
    },
    documents: {
      enabled: documentsEnabled,
      maxBytes: parsePositiveInteger(env.DOCUMENTS_MAX_BYTES, 10 * 1024 * 1024, 'DOCUMENTS_MAX_BYTES', 1_024, 25 * 1024 * 1024),
      maxPages: parsePositiveInteger(env.DOCUMENTS_MAX_PAGES, 50, 'DOCUMENTS_MAX_PAGES', 1, 200),
      maxTextChars: parsePositiveInteger(env.DOCUMENTS_MAX_TEXT_CHARS, 100_000, 'DOCUMENTS_MAX_TEXT_CHARS', 100, 200_000),
      timeoutMs: parsePositiveInteger(env.DOCUMENTS_TIMEOUT_MS, 20_000, 'DOCUMENTS_TIMEOUT_MS', 1_000, 120_000),
      ocr: {
        enabled: documentOcrEnabled,
        maxPages: parsePositiveInteger(env.DOCUMENTS_OCR_MAX_PAGES, 10, 'DOCUMENTS_OCR_MAX_PAGES', 1, 50),
        dpi: parsePositiveInteger(env.DOCUMENTS_OCR_DPI, 180, 'DOCUMENTS_OCR_DPI', 100, 300),
        languages: parseOcrLanguages(env.DOCUMENTS_OCR_LANGUAGES),
        timeoutMs: parsePositiveInteger(env.DOCUMENTS_OCR_TIMEOUT_MS, 60_000, 'DOCUMENTS_OCR_TIMEOUT_MS', 1_000, 300_000),
      },
      retention: {
        enabled: documentRetentionEnabled,
        days: parsePositiveInteger(env.DOCUMENT_RETENTION_DAYS, 90, 'DOCUMENT_RETENTION_DAYS', 1, 3_650),
      },
    },
    calendar: {
      enabled: calendarEnabled,
      provider: parseCalendarProvider(env.CALENDAR_PROVIDER),
      calendarId: parseCalendarId(env.GOOGLE_CALENDAR_ID),
      clientId: calendarClientId,
      clientSecret: calendarClientSecret,
      refreshToken: calendarRefreshToken,
      timeoutMs: parsePositiveInteger(env.CALENDAR_TIMEOUT_MS, 20_000, 'CALENDAR_TIMEOUT_MS', 1_000, 120_000),
    },
    briefing: {
      enabled: briefingEnabled,
      hour: briefingTime.hour,
      minute: briefingTime.minute,
      destinationJid: briefingDestinationJid,
    },
    observer: {
      enabled: observerEnabled,
    },
    retention: {
      enabled: parseBoolean(env.RETENTION_ENABLED, false),
      messageDays: parsePositiveInteger(env.MESSAGE_RETENTION_DAYS, 30, 'MESSAGE_RETENTION_DAYS', 1, 3_650),
      outboundDays: parsePositiveInteger(env.OUTBOUND_RETENTION_DAYS, 30, 'OUTBOUND_RETENTION_DAYS', 1, 3_650),
      auditDays: parsePositiveInteger(env.AUDIT_RETENTION_DAYS, 90, 'AUDIT_RETENTION_DAYS', 1, 3_650),
      briefingDays: parsePositiveInteger(env.BRIEFING_RETENTION_DAYS, 90, 'BRIEFING_RETENTION_DAYS', 1, 3_650),
    },
  };
}
