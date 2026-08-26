import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';
import { GmailReadCapability } from '../src/capabilities/gmail-read-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { ActionRequestRepository } from '../src/database/action-request-repository.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { loadGmailBodyReadConfig, type GmailBodyReadConfig } from '../src/gmail/body-read-config.ts';
import { GoogleGmailMessageProvider } from '../src/gmail/google-gmail-message-provider.ts';
import type { GmailMessageProvider } from '../src/gmail/message-types.ts';
import type { GmailReadConfig } from '../src/gmail/read-config.ts';
import type { GmailReadProvider } from '../src/gmail/types.ts';
import { runDoctor } from '../src/ops/doctor.ts';

const selfJid = '51999999999@s.whatsapp.net';

function message(text: string): IncomingMessage {
  return {
    id: `gmail-body-${text}`,
    chatId: selfJid,
    timestamp: 1_777_000_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

function metadataConfig(): GmailReadConfig {
  return {
    enabled: true,
    clientId: 'metadata-client',
    clientSecret: 'metadata-secret',
    refreshToken: 'metadata-refresh',
    timeoutMs: 20_000,
    maxMessages: 5,
    maxReplyChars: 3_500,
  };
}

function bodyConfig(overrides: Partial<GmailBodyReadConfig> = {}): GmailBodyReadConfig {
  return {
    enabled: true,
    clientId: 'body-client',
    clientSecret: 'body-secret',
    refreshToken: 'body-refresh',
    timeoutMs: 20_000,
    maxReplyChars: 3_500,
    maxResponseBytes: 524_288,
    selectionTtlMs: 15 * 60_000,
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

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

test('Gmail body read is a separate disabled-by-default opt-in with dedicated credentials', () => {
  const disabled = loadGmailBodyReadConfig({}, false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.selectionTtlMs, 15 * 60_000);
  assert.equal(disabled.maxResponseBytes, 524_288);

  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_READ_ENABLED: 'true' }, false), /GMAIL_READ_ENABLED/);
  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_READ_ENABLED: 'true' }, true), /GMAIL_BODY_CLIENT_ID/);
  assert.throws(() => loadGmailBodyReadConfig({
    GMAIL_BODY_READ_ENABLED: 'true', GMAIL_BODY_CLIENT_ID: 'x',
  }, true), /GMAIL_BODY_CLIENT_SECRET/);
  assert.throws(() => loadGmailBodyReadConfig({
    GMAIL_BODY_READ_ENABLED: 'true', GMAIL_BODY_CLIENT_ID: 'x', GMAIL_BODY_CLIENT_SECRET: 'y',
  }, true), /GMAIL_BODY_REFRESH_TOKEN/);

  const enabled = loadGmailBodyReadConfig({
    GMAIL_BODY_READ_ENABLED: 'true',
    GMAIL_BODY_CLIENT_ID: 'body-client',
    GMAIL_BODY_CLIENT_SECRET: 'body-secret',
    GMAIL_BODY_REFRESH_TOKEN: 'body-refresh',
  }, true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.clientId, 'body-client');
});

test('Gmail body config validates conservative byte/reply/TTL bounds', () => {
  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_MAX_RESPONSE_BYTES: '16383' }, false), /MAX_RESPONSE_BYTES/);
  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_MAX_REPLY_CHARS: '499' }, false), /MAX_REPLY_CHARS/);
  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_SELECTION_TTL_MINUTES: '0' }, false), /SELECTION_TTL/);
  assert.throws(() => loadGmailBodyReadConfig({ GMAIL_BODY_TIMEOUT_MS: '999' }, false), /GMAIL_BODY_TIMEOUT_MS/);
});

test('doctor validates Stage 7B config locally and fails closed before any provider call', () => {
  const report = runDoctor({
    APP_DB_PATH: ':memory:',
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'metadata-client',
    GMAIL_CLIENT_SECRET: 'metadata-secret',
    GMAIL_REFRESH_TOKEN: 'metadata-refresh',
    GMAIL_BODY_READ_ENABLED: 'true',
    GMAIL_BODY_CLIENT_ID: 'body-client',
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks[0]?.name, 'config');
  assert.match(report.checks[0]?.detail ?? '', /GMAIL_BODY_CLIENT_SECRET/);
});

test('message provider fetches only the exact selected message, uses full with narrow fields, and parses text/plain', async () => {
  const urls: string[] = [];
  const provider = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 524_288, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        id: 'm1', threadId: 't1',
        payload: { mimeType: 'text/plain', filename: '', body: { data: b64url('Hola\r\nMundo\u202E!') } },
      }));
    },
  );
  const result = await provider.getMessage({ id: 'm1', threadId: 't1' });
  assert.equal(result.format, 'plain');
  assert.equal(result.text, 'Hola\nMundo !');
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]!);
  assert.match(url.pathname, /\/users\/me\/messages\/m1$/);
  assert.equal(url.searchParams.get('format'), 'full');
  assert.match(url.searchParams.get('fields') ?? '', /^id,threadId,payload\(/);
  assert.ok(!(url.searchParams.get('fields') ?? '').includes('headers'));
  assert.ok(!(url.searchParams.get('fields') ?? '').includes('snippet'));
  assert.equal(url.searchParams.has('q'), false);
  assert.ok(!urls[0]!.includes('/attachments/'));
});

test('message provider prefers nested plain text, falls back to sanitized HTML, and never downloads attachments', async () => {
  let mode: 'mixed' | 'html' = 'mixed';
  let calls = 0;
  const provider = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 524_288, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      calls += 1;
      const parts = mode === 'mixed'
        ? [
            { mimeType: 'text/html', filename: '', body: { data: b64url('<p>HTML version</p>') } },
            { mimeType: 'text/plain', filename: '', body: { data: b64url('Plain version') } },
            { mimeType: 'application/pdf', filename: 'secret.pdf', body: { attachmentId: 'att-secret', size: 9000 } },
          ]
        : [{ mimeType: 'text/html', filename: '', body: { data: b64url('<style>.x{}</style><script>steal()</script><p>Hola &amp; adiós</p>') } }];
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', payload: { mimeType: 'multipart/mixed', parts } }));
    },
  );

  const mixed = await provider.getMessage({ id: 'm1', threadId: 't1' });
  assert.equal(mixed.format, 'plain');
  assert.equal(mixed.text, 'Plain version');
  assert.equal(mixed.omittedParts, 1);
  assert.equal(calls, 1);

  mode = 'html';
  const html = await provider.getMessage({ id: 'm1', threadId: 't1' });
  assert.equal(html.format, 'html');
  assert.equal(html.text, 'Hola & adiós');
  assert.equal(calls, 2);
});

test('message provider enforces the response byte ceiling before parsing content', async () => {
  const provider = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 16_384, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => new Response('x'.repeat(20_000), { headers: { 'content-length': '20000' } }),
  );
  await assert.rejects(
    () => provider.getMessage({ id: 'm1', threadId: 't1' }),
    /exceeded configured byte limit/,
  );
});

test('message provider refreshes once on 401 and never exposes an upstream error body', async () => {
  const auth: string[] = [];
  let call = 0;
  const provider = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 524_288, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(['old', 'new']),
    async (_input, init) => {
      auth.push(new Headers(init?.headers).get('authorization') ?? '');
      call += 1;
      if (call === 1) return new Response('PRIVATE-401', { status: 401 });
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', payload: { mimeType: 'text/plain', body: { data: b64url('ok') } } }));
    },
  );
  assert.equal((await provider.getMessage({ id: 'm1', threadId: 't1' })).text, 'ok');
  assert.deepEqual(auth, ['Bearer old', 'Bearer new']);

  const failing = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 524_288, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => new Response('TOP-SECRET-UPSTREAM', { status: 503 }),
  );
  await assert.rejects(
    () => failing.getMessage({ id: 'm1', threadId: 't1' }),
    (error: unknown) => error instanceof Error && /HTTP 503/.test(error.message) && !error.message.includes('TOP-SECRET-UPSTREAM'),
  );
});

test('message provider rejects identity mismatch from the exact-message response', async () => {
  const provider = new GoogleGmailMessageProvider(
    { timeoutMs: 20_000, maxResponseBytes: 524_288, maxBodyChars: 3_500, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => new Response(JSON.stringify({ id: 'other', threadId: 't1', payload: {} })),
  );
  await assert.rejects(() => provider.getMessage({ id: 'm1', threadId: 't1' }), /mismatched message/);
});

test('capability requires a fresh numbered list before explicit correo #N and keeps the selection only in memory', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    let bodyCalls = 0;
    const metadataProvider: GmailReadProvider = {
      name: 'metadata-fake',
      listInbox: async () => [{
        id: 'SECRET-ID-1', threadId: 'SECRET-THREAD-1', internalDate: '2026-08-25T18:00:00.000Z',
        from: 'Ana <ana@example.com>', subject: 'Informe', unread: true,
      }],
    };
    const bodyProvider: GmailMessageProvider = {
      name: 'body-fake',
      getMessage: async ({ id, threadId }) => {
        bodyCalls += 1;
        assert.equal(id, 'SECRET-ID-1');
        assert.equal(threadId, 'SECRET-THREAD-1');
        return { id, threadId, text: 'Contenido privado', format: 'plain', truncated: false, omittedParts: 0 };
      },
    };
    const capability = new GmailReadCapability(metadataProvider, audit, metadataConfig(), 'America/Lima', {
      bodyConfig: bodyConfig(), bodyProvider,
    });

    assert.match((await capability.handle(message('correo #1')))?.reply ?? '', /selección.*no existe|selección.*venció/i);
    assert.equal(bodyCalls, 0);
    const listed = await capability.handle(message('correos'));
    assert.match(listed?.reply ?? '', /#1/);
    const opened = await capability.handle(message('correo #1'));
    assert.match(opened?.reply ?? '', /Contenido privado/);
    assert.equal(bodyCalls, 1);
  } finally { db.close(); }
});

test('capability expires selections, rejects invalid indexes, and body-disabled mode never calls provider', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    let now = 10_000;
    let bodyCalls = 0;
    const metadataProvider: GmailReadProvider = {
      name: 'metadata-fake',
      listInbox: async () => [{
        id: 'm1', threadId: 't1', internalDate: '2026-08-25T18:00:00.000Z', from: 'A', subject: 'B', unread: false,
      }],
    };
    const bodyProvider: GmailMessageProvider = {
      name: 'body-fake',
      getMessage: async ({ id, threadId }) => {
        bodyCalls += 1;
        return { id, threadId, text: 'x', format: 'plain', truncated: false, omittedParts: 0 };
      },
    };
    const enabled = new GmailReadCapability(metadataProvider, audit, metadataConfig(), 'America/Lima', {
      bodyConfig: bodyConfig({ selectionTtlMs: 60_000 }), bodyProvider, now: () => now,
    });
    await enabled.handle(message('correos'));
    assert.match((await enabled.handle(message('correo #2')))?.reply ?? '', /No existe el correo #2/);
    assert.equal(bodyCalls, 0);
    now += 60_000;
    assert.match((await enabled.handle(message('correo #1')))?.reply ?? '', /venció/);
    assert.equal(bodyCalls, 0);

    const disabled = new GmailReadCapability(metadataProvider, audit, metadataConfig(), 'America/Lima', {
      bodyConfig: { ...bodyConfig(), enabled: false }, bodyProvider,
    });
    assert.match((await disabled.handle(message('correo #1')))?.reply ?? '', /deshabilitada/);
    assert.equal(bodyCalls, 0);
  } finally { db.close(); }
});

test('body output is bounded, audit stores no Gmail/body/header content, and no action request is created', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const secretFrom = 'PRIVATE-FROM@example.com';
    const secretSubject = 'PRIVATE-SUBJECT';
    const secretBody = `PRIVATE-BODY-${'x'.repeat(2000)}`;
    const secretId = 'PRIVATE-GMAIL-ID';
    const metadataProvider: GmailReadProvider = {
      name: 'metadata-fake',
      listInbox: async () => [{
        id: secretId, threadId: 'PRIVATE-THREAD-ID', internalDate: '2026-08-25T18:00:00.000Z',
        from: secretFrom, subject: secretSubject, unread: false,
      }],
    };
    const bodyProvider: GmailMessageProvider = {
      name: 'body-fake',
      getMessage: async ({ id, threadId }) => ({
        id, threadId, text: secretBody, format: 'plain', truncated: true, omittedParts: 2,
      }),
    };
    const capability = new GmailReadCapability(metadataProvider, audit, metadataConfig(), 'America/Lima', {
      bodyConfig: bodyConfig({ maxReplyChars: 500 }), bodyProvider,
    });
    await capability.handle(message('correos'));
    const opened = await capability.handle(message('correo #1'));
    assert.ok((opened?.reply?.length ?? 0) <= 500);
    assert.match(opened?.reply ?? '', /PRIVATE-BODY/);

    const auditJson = JSON.stringify(audit.listRecent(20));
    assert.match(auditJson, /gmail\.body\.read/);
    assert.ok(!auditJson.includes(secretFrom));
    assert.ok(!auditJson.includes(secretSubject));
    assert.ok(!auditJson.includes(secretBody));
    assert.ok(!auditJson.includes(secretId));
    assert.equal(actions.listPending(new Date('2030-01-01T00:00:00Z').toISOString()).length, 0);
  } finally { db.close(); }
});
