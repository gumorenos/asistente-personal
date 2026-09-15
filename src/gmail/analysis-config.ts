export interface GmailAnalysisConfig {
  enabled: boolean;
  maxMessages: number;
  maxInputChars: number;
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

export function loadGmailAnalysisConfig(
  env: NodeJS.ProcessEnv = process.env,
  metadataReadEnabled = parseBoolean(env.GMAIL_READ_ENABLED, false),
  aiEnabled = parseBoolean(env.AI_ENABLED, false),
): GmailAnalysisConfig {
  const enabled = parseBoolean(env.GMAIL_ANALYSIS_ENABLED, false);

  if (enabled && !metadataReadEnabled) {
    throw new Error('GMAIL_READ_ENABLED=true is required when GMAIL_ANALYSIS_ENABLED=true');
  }
  if (enabled && !aiEnabled) {
    throw new Error('AI_ENABLED=true is required when GMAIL_ANALYSIS_ENABLED=true');
  }

  return {
    enabled,
    maxMessages: parseInteger(env.GMAIL_ANALYSIS_MAX_MESSAGES, 5, 'GMAIL_ANALYSIS_MAX_MESSAGES', 1, 10),
    maxInputChars: parseInteger(env.GMAIL_ANALYSIS_MAX_INPUT_CHARS, 8_000, 'GMAIL_ANALYSIS_MAX_INPUT_CHARS', 1_000, 20_000),
    maxReplyChars: parseInteger(env.GMAIL_ANALYSIS_MAX_REPLY_CHARS, 2_500, 'GMAIL_ANALYSIS_MAX_REPLY_CHARS', 500, 5_000),
  };
}
