const MAX_QUERY_CHARS = 200;
const MAX_TOKENS = 8;
const MAX_TOKEN_CHARS = 64;

export interface CompiledFtsQuery {
  expression: string;
  tokenCount: number;
  normalizedQuery: string;
}

export function compileFtsQuery(input: string): CompiledFtsQuery | undefined {
  const normalizedQuery = input.normalize('NFC').trim();
  if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_CHARS) return undefined;

  const rawTokens = normalizedQuery.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const rawToken of rawTokens) {
    const token = rawToken.toLocaleLowerCase('es-PE').slice(0, MAX_TOKEN_CHARS);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= MAX_TOKENS) break;
  }

  if (tokens.length === 0) return undefined;

  return {
    expression: tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND '),
    tokenCount: tokens.length,
    normalizedQuery,
  };
}

export const FTS_QUERY_LIMITS = {
  maxQueryChars: MAX_QUERY_CHARS,
  maxTokens: MAX_TOKENS,
  maxTokenChars: MAX_TOKEN_CHARS,
} as const;
