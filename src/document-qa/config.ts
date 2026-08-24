import type { AppConfig } from '../config.ts';

export interface DocumentQaConfig {
  enabled: boolean;
  maxQuestionChars: number;
  maxContextChars: number;
  maxSources: number;
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
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${name}: ${value ?? ''}`);
  return parsed;
}

export function loadDocumentQaConfig(app: AppConfig, env: NodeJS.ProcessEnv = process.env): DocumentQaConfig {
  const enabled = parseBoolean(env.DOCUMENT_QA_ENABLED, false);
  if (enabled && !app.ai.enabled) throw new Error('AI_ENABLED=true is required when DOCUMENT_QA_ENABLED=true');
  if (enabled && !app.semantic.enabled) throw new Error('SEMANTIC_ENABLED=true is required when DOCUMENT_QA_ENABLED=true');
  if (enabled && !app.semantic.embeddings.enabled) throw new Error('EMBEDDINGS_ENABLED=true is required when DOCUMENT_QA_ENABLED=true');

  return {
    enabled,
    maxQuestionChars: parseInteger(env.DOCUMENT_QA_MAX_QUESTION_CHARS, 2_000, 'DOCUMENT_QA_MAX_QUESTION_CHARS', 100, 4_000),
    maxContextChars: parseInteger(env.DOCUMENT_QA_MAX_CONTEXT_CHARS, 7_000, 'DOCUMENT_QA_MAX_CONTEXT_CHARS', 500, 20_000),
    maxSources: parseInteger(env.DOCUMENT_QA_MAX_SOURCES, 5, 'DOCUMENT_QA_MAX_SOURCES', 1, 8),
    maxReplyChars: parseInteger(env.DOCUMENT_QA_MAX_REPLY_CHARS, 3_500, 'DOCUMENT_QA_MAX_REPLY_CHARS', 100, 10_000),
  };
}
