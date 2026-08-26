import type { GoogleOAuthAccessTokenProvider } from '../calendar/google-oauth-token-provider.ts';
import type { GmailListOptions, GmailMetadataMessage, GmailReadProvider } from './types.ts';

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
  const compacted = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compacted) return fallback;
  return compacted.length <= maxChars ? compacted : `${compacted.slice(0, maxChars - 1)}…`;
}

function headerValue(payload: unknown, wantedName: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.headers)) return undefined;
  for (const header of payload.headers) {
    if (!isRecord(header) || typeof header.name !== 'string') continue;
    if (header.name.toLowerCase() === wantedName.toLowerCase()) return header.value;
  }
  return undefined;
}

function normalizeMessage(value: unknown): GmailMetadataMessage {
  if (!isRecord(value)) throw new Error('Gmail metadata returned an invalid message');
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const threadId = typeof value.threadId === 'string' ? value.threadId.trim() : '';
  const internalDateMs = typeof value.internalDate === 'string' ? Number(value.internalDate) : Number.NaN;
  if (!id || id.length > 1024 || !threadId || threadId.length > 1024 || !Number.isFinite(internalDateMs) || internalDateMs < 0) {
    throw new Error('Gmail metadata returned an invalid message');
  }
  const date = new Date(internalDateMs);
  if (!Number.isFinite(date.getTime())) throw new Error('Gmail metadata returned an invalid message');
  const labelIds = Array.isArray(value.labelIds)
    ? value.labelIds.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    id: id.slice(0, 1024),
    threadId: threadId.slice(0, 1024),
    internalDate: date.toISOString(),
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
  for (const value of messages) {
    if (!isRecord(value)) continue;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const threadId = typeof value.threadId === 'string' ? value.threadId.trim() : '';
    if (!id || id.length > 1024 || !threadId || threadId.length > 1024) continue;
    output.push({ id, threadId });
    if (output.length >= maxResults) break;
  }
  return output;
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
      messages.push(normalizeMessage(await response.json()));
    }
    return messages;
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
      if (controller.signal.aborted) throw new Error('Gmail metadata request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
