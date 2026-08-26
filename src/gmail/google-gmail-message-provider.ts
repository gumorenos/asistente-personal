import type { GoogleOAuthAccessTokenProvider } from '../calendar/google-oauth-token-provider.ts';
import type { GmailMessageBody, GmailMessageProvider, GmailMessageReadRequest } from './message-types.ts';

export interface GoogleGmailMessageProviderConfig {
  timeoutMs: number;
  maxResponseBytes: number;
  maxBodyChars: number;
  apiBaseUrl?: string;
}

type FetchImplementation = typeof fetch;

type CandidateFormat = 'plain' | 'html';

interface TextCandidate {
  format: CandidateFormat;
  text: string;
}

interface CollectedParts {
  plain: TextCandidate[];
  html: TextCandidate[];
  omittedParts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 1024 ? trimmed : '';
}

function sanitizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]+/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(value: string): string {
  const withoutActiveContent = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return sanitizeText(decodeHtmlEntities(withoutActiveContent));
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    throw new Error('Gmail message returned invalid body encoding');
  }
}

function collectParts(value: unknown, output: CollectedParts, depth = 0): void {
  if (!isRecord(value) || depth > 8) return;
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.toLowerCase().trim() : '';
  const filename = typeof value.filename === 'string' ? value.filename.trim() : '';
  const body = isRecord(value.body) ? value.body : undefined;
  const attachmentId = body && typeof body.attachmentId === 'string' ? body.attachmentId.trim() : '';

  if (filename || attachmentId) {
    output.omittedParts += 1;
    return;
  }

  const data = body && typeof body.data === 'string' ? body.data : undefined;
  if (data && (mimeType === 'text/plain' || mimeType === 'text/html')) {
    const decoded = decodeBase64Url(data);
    if (mimeType === 'text/plain') {
      const text = sanitizeText(decoded);
      if (text) output.plain.push({ format: 'plain', text });
    } else {
      const text = htmlToText(decoded);
      if (text) output.html.push({ format: 'html', text });
    }
  }

  if (Array.isArray(value.parts)) {
    for (const part of value.parts) collectParts(part, output, depth + 1);
  }
}

function boundedText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: `${value.slice(0, Math.max(0, maxChars - 1))}…`, truncated: true };
}

function partFields(depth: number): string {
  const own = 'mimeType,filename,body(data,size,attachmentId)';
  return depth <= 0 ? own : `${own},parts(${partFields(depth - 1)})`;
}

export class GoogleGmailMessageProvider implements GmailMessageProvider {
  readonly name = 'google-gmail-message-read';

  private readonly config: GoogleGmailMessageProviderConfig;
  private readonly tokenProvider: GoogleOAuthAccessTokenProvider;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    config: GoogleGmailMessageProviderConfig,
    tokenProvider: GoogleOAuthAccessTokenProvider,
    fetchImpl: FetchImplementation = fetch,
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async getMessage(request: GmailMessageReadRequest): Promise<GmailMessageBody> {
    const id = validIdentity(request.id);
    const threadId = validIdentity(request.threadId);
    if (!id || !threadId) throw new Error('Invalid Gmail message selection');

    const query = new URLSearchParams({
      format: 'full',
      fields: `id,threadId,payload(${partFields(5)})`,
    });
    const response = await this.authorizedFetch(
      `${this.baseUrl()}/users/me/messages/${encodeURIComponent(id)}?${query.toString()}`,
    );
    if (!response.ok) throw new Error(`Gmail message get failed with HTTP ${response.status}`);
    const value = await this.readJsonBounded(response);
    if (!isRecord(value)) throw new Error('Gmail message returned an invalid response');

    const returnedId = validIdentity(value.id);
    const returnedThreadId = validIdentity(value.threadId);
    if (returnedId !== id || returnedThreadId !== threadId) {
      throw new Error('Gmail message returned a mismatched message');
    }

    const collected: CollectedParts = { plain: [], html: [], omittedParts: 0 };
    collectParts(value.payload, collected);
    const candidates = collected.plain.length > 0 ? collected.plain : collected.html;
    const format: GmailMessageBody['format'] = collected.plain.length > 0
      ? 'plain'
      : collected.html.length > 0
        ? 'html'
        : 'none';
    const joined = candidates.map((candidate) => candidate.text).join('\n\n');
    const bounded = boundedText(joined, this.config.maxBodyChars);

    return {
      id: returnedId,
      threadId: returnedThreadId,
      text: bounded.text,
      format,
      truncated: bounded.truncated,
      omittedParts: collected.omittedParts,
    };
  }

  private baseUrl(): string {
    return (this.config.apiBaseUrl ?? 'https://gmail.googleapis.com/gmail/v1').replace(/\/$/, '');
  }

  private async authorizedFetch(url: string): Promise<Response> {
    let token = await this.tokenProvider.getAccessToken();
    let response = await this.fetchWithTimeout(url, token);
    if (response.status !== 401) return response;
    token = await this.tokenProvider.getAccessToken(true);
    response = await this.fetchWithTimeout(url, token);
    return response;
  }

  private async fetchWithTimeout(url: string, accessToken: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref();
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Gmail message request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readJsonBounded(response: Response): Promise<unknown> {
    const advertised = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > this.config.maxResponseBytes) {
      throw new Error('Gmail message response exceeded configured byte limit');
    }
    if (!response.body) throw new Error('Gmail message returned an empty response');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.config.maxResponseBytes) {
        await reader.cancel();
        throw new Error('Gmail message response exceeded configured byte limit');
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new Error('Gmail message returned invalid JSON');
    }
  }
}
