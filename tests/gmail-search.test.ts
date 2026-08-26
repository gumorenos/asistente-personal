import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';
import { GmailSearchCapability } from '../src/capabilities/gmail-search-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { GoogleGmailMetadataProvider } from '../src/gmail/google-gmail-metadata-provider.ts';
import { loadGmailSearchConfig, type GmailSearchConfig } from '../src/gmail/search-config.ts';
import type { GmailSearchProvider } from '../src/gmail/search-types.ts';

function message(text: string): IncomingMessage {
  return {
    id: `gmail-search-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_000_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function config(overrides: Partial<GmailSearchConfig> = {}): GmailSearchConfig {
  return {
    enabled: true,
    clientId: 'search-client',
    clientSecret: 'search-secret',
    refreshToken: 'search-refresh',
    timeoutMs: 20_000,
    maxMessages: 5,
    maxReplyChars: 3_500,
    maxTermChars: 200,
    maxDateRangeDays: 366,
    ...overrides,
  };
}

function tokenProvider(tokens: string[] = ['token']): GoogleOAuthAccessTokenProvider {
  let index = 0;
  return {
    getAccessToken: async (forceRefresh = false) => {
      if (forceRefresh) index = Math.min(index + 1, tokens.length - 1);
      return tokens[index] ?? 'token';
    },
  } as unknown as GoogleOAuthAccessTokenProvider;
}

function metadata(id = 'm1', threadId = 't1') {
  return {
    id,
    threadId,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: String(Date.parse('2026-08-25T18:00:00.000Z')),
    payload: { headers: [
      { name: 'From', value: 'Ana <ana@example.com>' },
      { name: 'Subject', value: 'Informe trimestral' },
    ] },
  };
}

test('Gmail search is disabled by default and requires dedicated credentials when enabled', () => {
  assert.equal(loadGmailSearchConfig({}).enabled, false);
  assert.throws(() => loadGmailSearchConfig({ GMAIL_SEARCH_ENABLED: 'true' }), /GMAIL_SEARCH_CLIENT_ID/);
  assert.throws(() => loadGmailSearchConfig({
    GMAIL_SEARCH_ENABLED: 'true', GMAIL_SEARCH_CLIENT_ID: 'x',
  }), /GMAIL_SEARCH_CLIENT_SECRET/);
  assert.throws(() => loadGmailSearchConfig({
    GMAIL_SEARCH_ENABLED: 'true', GMAIL_SEARCH_CLIENT_ID: 'x', GMAIL_SEARCH_CLIENT_SECRET: 'y',
  }), /GMAIL_SEARCH_REFRESH_TOKEN/);
});

test('Gmail search refuses refresh-token reuse across metadata and body boundaries', () => {
  const base = {
    GMAIL_SEARCH_ENABLED: 'true',
    GMAIL_SEARCH_CLIENT_ID: 'search-client',
    GMAIL_SEARCH_CLIENT_SECRET: 'search-secret',
  };
  assert.throws(() => loadGmailSearchConfig({
    ...base, GMAIL_SEARCH_REFRESH_TOKEN: 'same', GMAIL_REFRESH_TOKEN: 'same',
  }), /must differ from GMAIL_REFRESH_TOKEN/);
  assert.throws(() => loadGmailSearchConfig({
    ...base, GMAIL_SEARCH_REFRESH_TOKEN: 'same', GMAIL_BODY_REFRESH_TOKEN: 'same',
  }), /must differ from GMAIL_BODY_REFRESH_TOKEN/);
  assert.equal(loadGmailSearchConfig({ ...base, GMAIL_SEARCH_REFRESH_TOKEN: 'search-only' }).enabled, true);
});

test('Gmail search config enforces bounded limits', () => {
  assert.throws(() => loadGmailSearchConfig({ GMAIL_SEARCH_MAX_MESSAGES: '11' }), /MAX_MESSAGES/);
  assert.throws(() => loadGmailSearchConfig({ GMAIL_SEARCH_MAX_REPLY_CHARS: '499' }), /MAX_REPLY_CHARS/);
  assert.throws(() => loadGmailSearchConfig({ GMAIL_SEARCH_MAX_TERM_CHARS: '19' }), /MAX_TERM_CHARS/);
  assert.throws(() => loadGmailSearchConfig({ GMAIL_SEARCH_MAX_DATE_RANGE_DAYS: '0' }), /MAX_DATE_RANGE_DAYS/);
});

test('provider builds deterministic from query and fetches metadata only', async () => {
  const urls: string[] = [];
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async (input) => {
      const url = String(input);
      urls.push(url);
      return urls.length === 1
        ? new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }))
        : new Response(JSON.stringify(metadata()));
    },
  );

  const rows = await provider.searchInbox({ kind: 'from', value: 'ana@example.com' }, 5);
  assert.equal(rows.length, 1);
  const listUrl = new URL(urls[0]!);
  assert.equal(listUrl.searchParams.get('q'), 'from:"ana@example.com"');
  assert.deepEqual(listUrl.searchParams.getAll('labelIds'), ['INBOX']);
  assert.equal(listUrl.searchParams.get('includeSpamTrash'), 'false');
  const detailUrl = new URL(urls[1]!);
  assert.equal(detailUrl.searchParams.get('format'), 'metadata');
  assert.ok(!urls.some((url) => url.includes('format=full') || url.includes('format=raw') || url.includes('/attachments/')));
});

test('provider builds subject and epoch date queries without exposing raw q input', async () => {
  const queries: string[] = [];
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/messages')) {
        queries.push(url.searchParams.get('q') ?? '');
        return new Response(JSON.stringify({ messages: [] }));
      }
      return new Response(JSON.stringify(metadata()));
    },
  );
  await provider.searchInbox({ kind: 'subject', value: 'presupuesto anual' }, 5);
  await provider.searchInbox({ kind: 'date_range', startEpochSeconds: 1_000, endExclusiveEpochSeconds: 2_000 }, 5);
  assert.deepEqual(queries, ['subject:"presupuesto anual"', 'after:999 before:2000']);
  await assert.rejects(() => provider.searchInbox({ kind: 'subject', value: 'x" OR from:anyone' }, 5), /Invalid Gmail search phrase/);
});

test('capability supports sender and subject searches, returns bounded ephemeral metadata, and audit omits content', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const seen: unknown[] = [];
    const provider: GmailSearchProvider = {
      name: 'search-fake',
      searchInbox: async (filter) => {
        seen.push(filter);
        return [{
          id: 'PRIVATE-ID', threadId: 'PRIVATE-THREAD', internalDate: '2026-08-25T18:00:00.000Z',
          from: 'PRIVATE-FROM@example.com', subject: 'PRIVATE-SUBJECT', unread: true,
        }];
      },
    };
    const audit = new AuditRepository(db);
    const capability = new GmailSearchCapability(provider, audit, config(), 'America/Lima');

    const sender = await capability.handle(message('busca correos de ana@example.com'));
    assert.equal(sender?.replyPersistence, 'ephemeral');
    assert.match(sender?.reply ?? '', /PRIVATE-FROM/);
    await capability.handle(message('busca correos asunto presupuesto anual'));
    assert.deepEqual(seen, [
      { kind: 'from', value: 'ana@example.com' },
      { kind: 'subject', value: 'presupuesto anual' },
    ]);

    const auditJson = JSON.stringify(audit.listRecent(20));
    for (const secret of ['ana@example.com', 'presupuesto anual', 'PRIVATE-ID', 'PRIVATE-THREAD', 'PRIVATE-FROM', 'PRIVATE-SUBJECT']) {
      assert.ok(!auditJson.includes(secret));
    }
  } finally { db.close(); }
});

test('capability converts inclusive Lima date range to exact epoch boundaries', async () => {
  const db = new AppDatabase(':memory:');
  try {
    let seen: unknown;
    const provider: GmailSearchProvider = {
      name: 'search-fake',
      searchInbox: async (filter) => { seen = filter; return []; },
    };
    const capability = new GmailSearchCapability(provider, new AuditRepository(db), config(), 'America/Lima');
    await capability.handle(message('busca correos desde 2026-08-01 hasta 2026-08-25'));
    assert.deepEqual(seen, {
      kind: 'date_range',
      startEpochSeconds: Math.floor(Date.parse('2026-08-01T05:00:00.000Z') / 1_000),
      endExclusiveEpochSeconds: Math.floor(Date.parse('2026-08-26T05:00:00.000Z') / 1_000),
    });
  } finally { db.close(); }
});

test('invalid, overly broad, and query-injection-like commands never call provider', async () => {
  const db = new AppDatabase(':memory:');
  try {
    let calls = 0;
    const provider: GmailSearchProvider = {
      name: 'search-fake',
      searchInbox: async () => { calls += 1; return []; },
    };
    const capability = new GmailSearchCapability(provider, new AuditRepository(db), config({ maxDateRangeDays: 30 }), 'America/Lima');
    for (const command of [
      'busca correos q from:anyone',
      'busca correos de x" OR from:anyone',
      'busca correos asunto \\anything',
      'busca correos desde 2026-02-30 hasta 2026-03-01',
      'busca correos desde 2026-08-25 hasta 2026-08-01',
      'busca correos desde 2026-01-01 hasta 2026-03-01',
    ]) {
      const result = await capability.handle(message(command));
      assert.equal(result?.handled, true);
      assert.match(result?.reply ?? '', /Usa/);
    }
    assert.equal(calls, 0);
  } finally { db.close(); }
});

test('unrelated commands fall through while disabled Gmail search owns its explicit command', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const disabled = new GmailSearchCapability(undefined, new AuditRepository(db), { ...config(), enabled: false }, 'America/Lima');
    assert.equal(await disabled.handle(message('busca notas presupuesto')), undefined);
    assert.match((await disabled.handle(message('busca correos de ana')))?.reply ?? '', /deshabilitada/);
  } finally { db.close(); }
});
