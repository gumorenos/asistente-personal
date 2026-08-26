import type { GoogleOAuthAccessTokenProvider } from '../calendar/google-oauth-token-provider.ts';
import type {
  GmailContentMessage,
  GmailContentReadOptions,
  GmailListOptions,
  GmailMetadataMessage,
  GmailReadProvider,
  GmailThreadReadOptions,
} from './types.ts';

export interface GoogleGmailMetadataProviderConfig {
  timeoutMs: number;
  apiBaseUrl?: string;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compactHeader(value: unknown, fallback: string, maxChars: number): string {
  if (typeof value !== 'string') return fallback;
  const compacted = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compacted) return fallback;
  return compacted.length <= maxChars ? compacted : `${compacted.slice(0, maxChars - 1)}…`;
}

function compactBody(value: string, maxChars: number): { body: string; truncated: boolean } {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxChars) return { body: normalized, truncated: false };
  return { body: `${normalized.slice(0, Math.max(0, maxChars - 1))}…`, truncated: true };
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, token: string) => {
    const lower = token.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    return named[lower] ?? full;
  });
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function headerValue(payload: unknown, wantedName: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.headers)) return undefined;
  for (const header of payload.headers) {
    if (!isRecord(header) || typeof header.name !== 'string') continue;
    if (header.name.toLowerCase() === wantedName.toLowerCase()) return header.value;
  }
  return undefined;
}

function normalizeId(value: unknown, label: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 1024) throw new Error(`Gmail returned an invalid ${label}`);
  return id;
}

function normalizeDate(value: unknown): string {
  const internalDateMs = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(internalDateMs) || internalDateMs < 0) throw new Error('Gmail metadata returned an invalid message');
  const date = new Date(internalDateMs);
  if (!Number.isFinite(date.getTime())) throw new Error('Gmail metadata returned an invalid message');
  return date.toISOString();
}

function normalizeMessage(value: unknown): GmailMetadataMessage {
  if (!isRecord(value)) throw new Error('Gmail metadata returned an invalid message');
  const id = normalizeId(value.id, 'message id');
  const threadId = normalizeId(value.threadId, 'thread id');
  const labelIds = Array.isArray(value.labelIds)
    ? value.labelIds.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    id,
    threadId,
    internalDate: normalizeDate(value.internalDate),
    from: compactHeader(headerValue(value.payload, 'From'), '(sin remitente)', 320),
    subject: compactHeader(headerValue(value.payload, 'Subject'), '(sin asunto)', 300),
    unread: labelIds.includes('UNREAD'),
  };
}

function normalizeListIds(payload: unknown, maxResults: number): Array<{ id: string; threadId: string }> {
  if (!isRecord(payload)) throw new Error('Gmail list returned an invalid response');
  const messages = payload.messages === undefined ? [] : payload.messages;
  if (!Array.isArray(messages)) throw new Error('Gmail list returned an invalid response');
  const output: Array<{ id: string; threadId: string }> = [];
  const seen = new Set<string>();
  for (const value of messages) {
    if (!isRecord(value)) continue;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const threadId = typeof value.threadId === 'string' ? value.threadId.trim() : '';
    if (!id || id.length > 1024 || !threadId || threadId.length > 1024 || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, threadId });
    if (output.length >= maxResults) break;
  }
  return output;
}

interface DecodedPart {
  text: string;
  byteLength: number;
}

function decodePartData(data: unknown, maxBytes: number): DecodedPart | undefined {
  if (typeof data !== 'string' || !data) return undefined;
  if (data.length > Math.ceil(maxBytes * 1.5) + 16) throw new Error('Gmail message body exceeds configured limit');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(data)) throw new Error('Gmail message body contains invalid base64url data');
  const unpadded = data.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) throw new Error('Gmail message body contains invalid base64url data');
  const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const buffer = Buffer.from(`${normalized}${padding}`, 'base64');
  if (buffer.byteLength > maxBytes) throw new Error('Gmail message body exceeds configured limit');
  return { text: buffer.toString('utf8'), byteLength: buffer.byteLength };
}

interface BodyCandidate {
  kind: 'plain' | 'html';
  text: string;
}

function collectBodyCandidates(payload: unknown, maxBytes: number): BodyCandidate[] {
  const candidates: BodyCandidate[] = [];
  let visited = 0;
  let totalDecodedBytes = 0;

  const visit = (part: unknown, depth: number): void => {
    if (!isRecord(part)) return;
    visited += 1;
    if (visited > 100 || depth > 12) throw new Error('Gmail MIME structure exceeds configured safety bounds');

    const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
    const isTextCandidate = mimeType === 'text/plain' || mimeType === 'text/html';
    const body = isRecord(part.body) ? part.body : undefined;
    const attachmentId = body && typeof body.attachmentId === 'string' && body.attachmentId.trim()
      ? body.attachmentId.trim()
      : undefined;
    const decoded = isTextCandidate && !attachmentId ? decodePartData(body?.data, maxBytes) : undefined;
    if (decoded) {
      totalDecodedBytes += decoded.byteLength;
      if (totalDecodedBytes > maxBytes) throw new Error('Gmail message body exceeds aggregate configured limit');
      candidates.push({ kind: mimeType === 'text/plain' ? 'plain' : 'html', text: decoded.text });
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) visit(child, depth + 1);
    }
  };

  visit(payload, 0);
  return candidates;
}

function normalizeContentMessage(value: unknown, options: GmailContentReadOptions): GmailContentMessage {
  if (!isRecord(value)) throw new Error('Gmail content returned an invalid message');
  const id = normalizeId(value.id, 'message id');
  const threadId = normalizeId(value.threadId, 'thread id');
  const candidates = collectBodyCandidates(value.payload, options.maxMessageBytes);
  const plain = candidates.find((candidate) => candidate.kind === 'plain');
  const html = candidates.find((candidate) => candidate.kind === 'html');
  const rawBody = plain?.text ?? (html ? htmlToText(html.text) : '');
  const compacted = compactBody(rawBody || '(sin cuerpo de texto disponible)', options.maxBodyChars);

  return {
    id,
    threadId,
    internalDate: normalizeDate(value.internalDate),
    from: compactHeader(headerValue(value.payload, 'From'), '(sin remitente)', 320),
    subject: compactHeader(headerValue(value.payload, 'Subject'), '(sin asunto)', 300),
    body: compacted.body,
    truncated: compacted.truncated,
  };
}

function normalizeSizeEstimate(value: unknown): number {
  const size = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(size) || size < 0) throw new Error('Gmail returned an invalid size estimate');
  return size;
}

export class GoogleGmailMetadataProvider implements GmailReadProvider {
  readonly name = 'google-gmail-metadata';

  private readonly config: GoogleGmailMetadataProviderConfig;
  private readonly tokenProvider: GoogleOAuthAccessTokenProvider;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    config: GoogleGmailMetadataProviderConfig,
    tokenProvider: GoogleOAuthAccessTokenProvider,
    fetchImpl: FetchImplementation = fetch,
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async listInbox(options: GmailListOptions): Promise<GmailMetadataMessage[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) {
      throw new Error('Invalid Gmail metadata limit');
    }

    const query = new URLSearchParams({
      maxResults: String(options.limit),
      includeSpamTrash: 'false',
      fields: 'messages(id,threadId)',
    });
    query.append('labelIds', 'INBOX');
    if (options.unreadOnly) query.append('labelIds', 'UNREAD');

    const listResponse = await this.authorizedFetch(`${this.baseUrl()}/users/me/messages?${query.toString()}`);
    if (!listResponse.ok) throw new Error(`Gmail metadata list failed with HTTP ${listResponse.status}`);
    const ids = normalizeListIds(await listResponse.json(), options.limit);

    const messages: GmailMetadataMessage[] = [];
    for (const item of ids) {
      const detailQuery = new URLSearchParams({
        format: 'metadata',
        fields: 'id,threadId,labelIds,internalDate,payload(headers)',
      });
      detailQuery.append('metadataHeaders', 'From');
      detailQuery.append('metadataHeaders', 'Subject');
      const response = await this.authorizedFetch(
        `${this.baseUrl()}/users/me/messages/${encodeURIComponent(item.id)}?${detailQuery.toString()}`,
      );
      if (!response.ok) throw new Error(`Gmail metadata get failed with HTTP ${response.status}`);
      const normalized = normalizeMessage(await response.json());
      if (normalized.id !== item.id || normalized.threadId !== item.threadId) {
        throw new Error('Gmail metadata returned a mismatched message');
      }
      messages.push(normalized);
    }
    return messages;
  }

  async readMessage(messageId: string, options: GmailContentReadOptions): Promise<GmailContentMessage> {
    const safeId = normalizeId(messageId, 'message id');
    this.validateContentOptions(options);

    const preflightQuery = new URLSearchParams({ format: 'metadata', fields: 'id,threadId,sizeEstimate' });
    const preflight = await this.authorizedFetch(
      `${this.baseUrl()}/users/me/messages/${encodeURIComponent(safeId)}?${preflightQuery.toString()}`,
    );
    if (!preflight.ok) throw new Error(`Gmail content preflight failed with HTTP ${preflight.status}`);
    const preflightPayload: unknown = await preflight.json();
    if (!isRecord(preflightPayload) || normalizeId(preflightPayload.id, 'message id') !== safeId) {
      throw new Error('Gmail content returned a mismatched message');
    }
    const expectedThreadId = normalizeId(preflightPayload.threadId, 'thread id');
    if (normalizeSizeEstimate(preflightPayload.sizeEstimate) > options.maxMessageBytes) {
      throw new Error('Gmail message exceeds configured size limit');
    }

    const fullQuery = new URLSearchParams({
      format: 'full',
      fields: 'id,threadId,internalDate,sizeEstimate,payload',
    });
    const response = await this.authorizedFetch(
      `${this.baseUrl()}/users/me/messages/${encodeURIComponent(safeId)}?${fullQuery.toString()}`,
    );
    if (!response.ok) throw new Error(`Gmail content get failed with HTTP ${response.status}`);
    const raw: unknown = await response.json();
    if (!isRecord(raw) || normalizeSizeEstimate(raw.sizeEstimate) > options.maxMessageBytes) {
      throw new Error('Gmail message exceeds configured size limit');
    }
    const normalized = normalizeContentMessage(raw, options);
    if (normalized.id !== safeId || normalized.threadId !== expectedThreadId) {
      throw new Error('Gmail content returned a mismatched message');
    }
    return normalized;
  }

  async readThread(threadId: string, options: GmailThreadReadOptions): Promise<GmailContentMessage[]> {
    const safeThreadId = normalizeId(threadId, 'thread id');
    this.validateContentOptions(options);
    if (!Number.isInteger(options.maxMessages) || options.maxMessages < 1 || options.maxMessages > 10) {
      throw new Error('Invalid Gmail thread message limit');
    }

    const query = new URLSearchParams({
      format: 'minimal',
      fields: 'id,messages(id,threadId,sizeEstimate)',
    });
    const response = await this.authorizedFetch(
      `${this.baseUrl()}/users/me/threads/${encodeURIComponent(safeThreadId)}?${query.toString()}`,
    );
    if (!response.ok) throw new Error(`Gmail thread get failed with HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || normalizeId(payload.id, 'thread id') !== safeThreadId || !Array.isArray(payload.messages)) {
      throw new Error('Gmail thread returned an invalid response');
    }
    if (payload.messages.length > 2_000) throw new Error('Gmail thread exceeds configured structural safety bounds');

    const idsNewestFirst: string[] = [];
    const seen = new Set<string>();
    for (let index = payload.messages.length - 1; index >= 0 && idsNewestFirst.length < options.maxMessages; index -= 1) {
      const item = payload.messages[index];
      if (!isRecord(item)) continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const itemThreadId = typeof item.threadId === 'string' ? item.threadId.trim() : '';
      if (!id || id.length > 1024 || itemThreadId !== safeThreadId || seen.has(id)) continue;
      if (normalizeSizeEstimate(item.sizeEstimate) > options.maxMessageBytes) {
        throw new Error('Gmail thread contains a message above the configured size limit');
      }
      seen.add(id);
      idsNewestFirst.push(id);
    }
    const ids = idsNewestFirst.reverse();

    const messages: GmailContentMessage[] = [];
    for (const id of ids) {
      const message = await this.readMessage(id, options);
      if (message.threadId !== safeThreadId) throw new Error('Gmail thread returned a mismatched message');
      messages.push(message);
    }
    return messages;
  }

  private validateContentOptions(options: GmailContentReadOptions): void {
    if (!Number.isInteger(options.maxBodyChars) || options.maxBodyChars < 1 || options.maxBodyChars > 50_000) {
      throw new Error('Invalid Gmail content body limit');
    }
    if (!Number.isInteger(options.maxMessageBytes) || options.maxMessageBytes < 1 || options.maxMessageBytes > 5_242_880) {
      throw new Error('Invalid Gmail content size limit');
    }
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
      if (controller.signal.aborted) throw new Error('Gmail request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
