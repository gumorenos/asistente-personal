import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';
import { GmailReadCapability } from '../src/capabilities/gmail-read-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { GoogleGmailMetadataProvider } from '../src/gmail/google-gmail-metadata-provider.ts';
import { loadGmailReadConfig, type GmailReadConfig } from '../src/gmail/read-config.ts';
import type { GmailReadProvider } from '../src/gmail/types.ts';

const selfJid = '51999999999@s.whatsapp.net';

function message(text: string): IncomingMessage {
  return {
    id: `gmail-${text}`,
    chatId: selfJid,
    timestamp: 1_777_000_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function enabledConfig(overrides: Partial<GmailReadConfig> = {}): GmailReadConfig {
  return {
    enabled: true,
    clientId: 'client',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    timeoutMs: 20_000,
    maxMessages: 5,
    maxReplyChars: 3_500,
    ...overrides,
  };
}

function tokenProvider(tokens: string[] = ['token']): GoogleOAuthAccessTokenProvider {
  let index = 0;
  return {
    getAccessToken: async (forceRefresh = false) => {
      if (forceRefresh) index = Math.min(index + 1, tokens.length - 1);
      return tokens[index] ?? tokens[0] ?? 'token';
    },
  } as unknown as GoogleOAuthAccessTokenProvider;
}

test('Gmail metadata read is disabled by default and requires dedicated credentials only when enabled', () => {
  const disabled = loadGmailReadConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.maxMessages, 5);
  assert.equal(disabled.maxReplyChars, 3_500);

  assert.throws(() => loadGmailReadConfig({ GMAIL_READ_ENABLED: 'true' }), /GMAIL_CLIENT_ID/);
  assert.throws(() => loadGmailReadConfig({ GMAIL_READ_ENABLED: 'true', GMAIL_CLIENT_ID: 'x' }), /GMAIL_CLIENT_SECRET/);
  assert.throws(() => loadGmailReadConfig({
    GMAIL_READ_ENABLED: 'true', GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y',
  }), /GMAIL_REFRESH_TOKEN/);

  const enabled = loadGmailReadConfig({
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'gmail-client',
    GMAIL_CLIENT_SECRET: 'gmail-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-refresh',
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.clientId, 'gmail-client');
});

test('Gmail metadata config validates conservative request and reply bounds', () => {
  const base = {
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'y', GMAIL_REFRESH_TOKEN: 'z',
  };
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_READ_MAX_MESSAGES: '0' }), /GMAIL_READ_MAX_MESSAGES/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_READ_MAX_MESSAGES: '11' }), /GMAIL_READ_MAX_MESSAGES/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_READ_MAX_REPLY_CHARS: '499' }), /GMAIL_READ_MAX_REPLY_CHARS/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_TIMEOUT_MS: '999' }), /GMAIL_TIMEOUT_MS/);
});

test('provider uses INBOX metadata-only requests with From/Subject headers and never q/full/raw', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'm1',
      threadId: 't1',
      internalDate: '1787698800000',
      labelIds: ['INBOX', 'UNREAD'],
      payload: { headers: [
        { name: 'From', value: ' Ana\r\n  <ana@example.com> ' },
        { name: 'Subject', value: ' Informe\n semanal ' },
        { name: 'To', value: 'private@example.com' },
      ] },
    }), { status: 200 });
  };
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    fetchImpl,
  );

  const rows = await provider.listInbox({ unreadOnly: false, limit: 3 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.from, 'Ana <ana@example.com>');
  assert.equal(rows[0]?.subject, 'Informe semanal');
  assert.equal(rows[0]?.unread, true);
  assert.equal(urls.length, 2);

  const list = new URL(urls[0]!);
  assert.equal(list.searchParams.get('maxResults'), '3');
  assert.deepEqual(list.searchParams.getAll('labelIds'), ['INBOX']);
  assert.equal(list.searchParams.has('q'), false);
  assert.equal(list.searchParams.get('includeSpamTrash'), 'false');

  const detail = new URL(urls[1]!);
  assert.equal(detail.searchParams.get('format'), 'metadata');
  assert.deepEqual(detail.searchParams.getAll('metadataHeaders'), ['From', 'Subject']);
  assert.equal(detail.searchParams.get('format') === 'full', false);
  assert.equal(detail.searchParams.get('format') === 'raw', false);
  assert.ok(!urls.join('\n').includes('private@example.com'));
});

test('unread-only provider adds UNREAD label and request fan-out is bounded by requested list size', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return new Response(JSON.stringify({
        messages: Array.from({ length: 8 }, (_, index) => ({ id: `m${index + 1}`, threadId: `t${index + 1}` })),
      }));
    }
    const id = /\/messages\/(m\d+)/.exec(url)?.[1] ?? 'm1';
    return new Response(JSON.stringify({
      id,
      threadId: `t${id.slice(1)}`,
      internalDate: '1787698800000',
      labelIds: ['INBOX', 'UNREAD'],
      payload: { headers: [] },
    }));
  };
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' }, tokenProvider(), fetchImpl,
  );
  const rows = await provider.listInbox({ unreadOnly: true, limit: 4 });
  assert.equal(rows.length, 4);
  assert.equal(urls.length, 5);
  assert.deepEqual(new URL(urls[0]!).searchParams.getAll('labelIds'), ['INBOX', 'UNREAD']);
});

test('provider refreshes once after 401 and HTTP errors never expose upstream body', async () => {
  const auth: string[] = [];
  let call = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    auth.push(new Headers(init?.headers).get('authorization') ?? '');
    call += 1;
    if (call === 1) return new Response('secret remote body', { status: 401 });
    if (call === 2) return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    return new Response('never', { status: 500 });
  };
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(['old-token', 'new-token']),
    fetchImpl,
  );
  assert.deepEqual(await provider.listInbox({ unreadOnly: false, limit: 1 }), []);
  assert.deepEqual(auth, ['Bearer old-token', 'Bearer new-token']);

  const failing = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' }, tokenProvider(),
    async () => new Response('TOP-SECRET-UPSTREAM', { status: 503 }),
  );
  await assert.rejects(
    () => failing.listInbox({ unreadOnly: false, limit: 1 }),
    (error: unknown) => error instanceof Error && /HTTP 503/.test(error.message) && !error.message.includes('TOP-SECRET-UPSTREAM'),
  );
});

test('provider rejects malformed metadata and bounds hostile header content', async () => {
  let call = 0;
  const long = `Sender\r\n${'x'.repeat(500)}`;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' }, tokenProvider(),
    async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }));
      return new Response(JSON.stringify({
        id: 'm1', threadId: 't1', internalDate: '1787698800000', labelIds: ['INBOX'],
        payload: { headers: [{ name: 'From', value: long }, { name: 'Subject', value: 'ok' }] },
      }));
    },
  );
  const [row] = await provider.listInbox({ unreadOnly: false, limit: 1 });
  assert.ok(row);
  assert.ok(row.from.length <= 320);
  assert.ok(!row.from.includes('\n'));

  let malformedCall = 0;
  const malformed = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' }, tokenProvider(),
    async () => {
      malformedCall += 1;
      if (malformedCall === 1) return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }));
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', internalDate: 'not-a-date' }));
    },
  );
  await assert.rejects(() => malformed.listInbox({ unreadOnly: false, limit: 1 }), /invalid message/);
});

test('capability is explicit, disabled mode is terminal, and request count is bounded', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    let calls = 0;
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async ({ unreadOnly, limit }) => {
        calls += 1;
        assert.equal(unreadOnly, true);
        assert.equal(limit, 3);
        return [];
      },
    };
    const disabled = new GmailReadCapability(provider, audit, { ...enabledConfig(), enabled: false }, 'America/Lima');
    assert.equal((await disabled.handle(message('correos')))?.handled, true);
    assert.equal(calls, 0);
    assert.equal(await disabled.handle(message('revisa mi correo')), undefined);

    const enabled = new GmailReadCapability(provider, audit, enabledConfig(), 'America/Lima');
    assert.match((await enabled.handle(message('correos no leídos 3')))?.reply ?? '', /ninguno/);
    assert.equal(calls, 1);
    assert.match((await enabled.handle(message('correos 6')))?.reply ?? '', /entre 1 y 5/);
    assert.equal(calls, 1);
  } finally { db.close(); }
});

test('capability output and audit are bounded and audit never stores sender subject or Gmail ids', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const secretSender = 'VERY_SECRET_SENDER@example.com';
    const secretSubject = 'VERY_SECRET_SUBJECT';
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async () => Array.from({ length: 5 }, (_, index) => ({
        id: `SECRET_GMAIL_ID_${index}`,
        threadId: `SECRET_THREAD_${index}`,
        internalDate: '2026-08-25T18:00:00.000Z',
        from: `${secretSender} ${'x'.repeat(250)}`,
        subject: `${secretSubject} ${'y'.repeat(300)}`,
        unread: index % 2 === 0,
      })),
    };
    const capability = new GmailReadCapability(provider, audit, enabledConfig({ maxReplyChars: 700 }), 'America/Lima');
    const result = await capability.handle(message('correos recientes 5'));
    assert.ok((result?.reply?.length ?? 0) <= 700);
    assert.match(result?.reply ?? '', /VERY_SECRET_SENDER/);

    const auditJson = JSON.stringify(audit.listRecent(10));
    assert.match(auditJson, /gmail\.read/);
    assert.match(auditJson, /"requested":5/);
    assert.ok(!auditJson.includes(secretSender));
    assert.ok(!auditJson.includes(secretSubject));
    assert.ok(!auditJson.includes('SECRET_GMAIL_ID'));
  } finally { db.close(); }
});

test('Gmail metadata reads never create action requests and provider failures return safe text', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async () => { throw new Error('PRIVATE PROVIDER DETAIL'); },
    };
    const capability = new GmailReadCapability(provider, audit, enabledConfig(), 'America/Lima');
    const result = await capability.handle(message('correos'));
    assert.equal(result?.reply, '⚠️ No pude consultar Gmail en este momento.');
    assert.equal(actions.listPending(new Date('2030-01-01T00:00:00Z').toISOString()).length, 0);
    assert.ok(!JSON.stringify(audit.listRecent(10)).includes('PRIVATE PROVIDER DETAIL'));
  } finally { db.close(); }
});
