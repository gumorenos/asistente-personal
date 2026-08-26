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
import type { GmailContentMessage, GmailReadProvider } from '../src/gmail/types.ts';

const selfJid = '51999999999@s.whatsapp.net';

function message(text: string): IncomingMessage {
  return {
    id: `gmail-content-${text}`,
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
    content: {
      enabled: true,
      maxBodyChars: 6_000,
      maxMessageBytes: 1_048_576,
      maxThreadMessages: 5,
      maxReplyChars: 3_500,
    },
    ...overrides,
  };
}

function tokenProvider(): GoogleOAuthAccessTokenProvider {
  return {
    getAccessToken: async () => 'token',
  } as unknown as GoogleOAuthAccessTokenProvider;
}

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function contentMessage(id: string, threadId: string, body: string, truncated = false): GmailContentMessage {
  return {
    id,
    threadId,
    internalDate: '2026-08-25T18:00:00.000Z',
    from: 'Ana <ana@example.com>',
    subject: 'Informe',
    body,
    truncated,
  };
}

test('Gmail content read is a separate opt-in and requires metadata read', () => {
  const disabled = loadGmailReadConfig({});
  assert.equal(disabled.content?.enabled, false);
  assert.equal(disabled.content?.maxBodyChars, 6_000);
  assert.equal(disabled.content?.maxMessageBytes, 1_048_576);
  assert.equal(disabled.content?.maxThreadMessages, 5);
  assert.equal(disabled.content?.maxReplyChars, 3_500);

  assert.throws(
    () => loadGmailReadConfig({ GMAIL_CONTENT_READ_ENABLED: 'true' }),
    /GMAIL_READ_ENABLED=true/,
  );

  const enabled = loadGmailReadConfig({
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CONTENT_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'client',
    GMAIL_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
  });
  assert.equal(enabled.content?.enabled, true);
});

test('Gmail content config validates body, message, thread and reply bounds', () => {
  const base = {
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'client',
    GMAIL_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
  };
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_CONTENT_MAX_BODY_CHARS: '499' }), /BODY_CHARS/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_CONTENT_MAX_MESSAGE_BYTES: '100' }), /MESSAGE_BYTES/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_CONTENT_MAX_THREAD_MESSAGES: '11' }), /THREAD_MESSAGES/);
  assert.throws(() => loadGmailReadConfig({ ...base, GMAIL_CONTENT_MAX_REPLY_CHARS: '499' }), /REPLY_CHARS/);
});

test('provider preflights size then reads full text/plain content without raw or attachment requests', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', sizeEstimate: 800 }));
    }
    return new Response(JSON.stringify({
      id: 'm1',
      threadId: 't1',
      internalDate: '1787698800000',
      sizeEstimate: 800,
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Ana <ana@example.com>' },
          { name: 'Subject', value: 'Informe semanal' },
          { name: 'To', value: 'private@example.com' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('Hola\r\nrevisa el informe.') } },
          { mimeType: 'text/html', body: { data: b64url('<p>HTML alternativo</p>') } },
          { mimeType: 'application/pdf', body: { attachmentId: 'ATTACHMENT_SECRET', size: 100 } },
        ],
      },
    }));
  };
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    fetchImpl,
  );

  const row = await provider.readMessage('m1', { maxBodyChars: 500, maxMessageBytes: 2_000 });
  assert.equal(row.body, 'Hola\nrevisa el informe.');
  assert.equal(row.from, 'Ana <ana@example.com>');
  assert.equal(row.subject, 'Informe semanal');
  assert.equal(row.truncated, false);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]!).searchParams.get('format'), 'metadata');
  assert.equal(new URL(urls[1]!).searchParams.get('format'), 'full');
  assert.ok(!urls.some((url) => url.includes('/attachments/')));
  assert.ok(!urls.some((url) => new URL(url).searchParams.get('format') === 'raw'));
});

test('provider falls back to bounded HTML text and strips scripts and Unicode format controls', async () => {
  let call = 0;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ id: 'm1', threadId: 't1', sizeEstimate: 900 }));
      return new Response(JSON.stringify({
        id: 'm1', threadId: 't1', internalDate: '1787698800000', sizeEstimate: 900,
        payload: {
          mimeType: 'text/html',
          headers: [{ name: 'From', value: 'A\u202Ena' }, { name: 'Subject', value: 'Hola' }],
          body: { data: b64url('<style>secret{}</style><script>steal()</script><p>Hola&nbsp;<b>mundo</b></p>') },
        },
      }));
    },
  );
  const row = await provider.readMessage('m1', { maxBodyChars: 10, maxMessageBytes: 2_000 });
  assert.equal(row.from, 'Ana');
  assert.ok(!row.body.includes('steal'));
  assert.ok(!row.body.includes('secret'));
  assert.ok(row.body.startsWith('Hola mund'));
  assert.equal(row.truncated, true);
});

test('provider rejects oversized message at preflight without downloading full content', async () => {
  let calls = 0;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      calls += 1;
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', sizeEstimate: 50_000 }));
    },
  );
  await assert.rejects(
    () => provider.readMessage('m1', { maxBodyChars: 500, maxMessageBytes: 10_000 }),
    /size limit/,
  );
  assert.equal(calls, 1);
});

test('provider reads a bounded thread and never requests attachment content', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/threads/t1')) {
      return new Response(JSON.stringify({
        id: 't1',
        messages: [
          { id: 'm1', threadId: 't1', sizeEstimate: 500 },
          { id: 'm2', threadId: 't1', sizeEstimate: 500 },
          { id: 'm3', threadId: 't1', sizeEstimate: 500 },
        ],
      }));
    }
    const id = /\/messages\/(m\d+)/.exec(url)?.[1] ?? 'm1';
    if (new URL(url).searchParams.get('format') === 'metadata') {
      return new Response(JSON.stringify({ id, threadId: 't1', sizeEstimate: 500 }));
    }
    return new Response(JSON.stringify({
      id, threadId: 't1', internalDate: '1787698800000', sizeEstimate: 500,
      payload: {
        mimeType: 'text/plain',
        headers: [{ name: 'From', value: `${id}@example.com` }, { name: 'Subject', value: 'Thread' }],
        body: { data: b64url(`body-${id}`) },
      },
    }));
  };
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' }, tokenProvider(), fetchImpl,
  );
  const rows = await provider.readThread('t1', { maxBodyChars: 500, maxMessageBytes: 2_000, maxMessages: 2 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.body), ['body-m1', 'body-m2']);
  assert.ok(!urls.some((url) => url.includes('/attachments/')));
  assert.equal(new URL(urls[0]!).searchParams.get('format'), 'minimal');
});

test('content commands are explicit, positional and disabled mode performs zero content reads', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    let listCalls = 0;
    let contentCalls = 0;
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async () => {
        listCalls += 1;
        return [{
          id: 'm1', threadId: 't1', internalDate: '2026-08-25T18:00:00.000Z',
          from: 'Ana', subject: 'Informe', unread: true,
        }];
      },
      readMessage: async () => {
        contentCalls += 1;
        return contentMessage('m1', 't1', 'contenido');
      },
      readThread: async () => [],
    };
    const disabled = new GmailReadCapability(provider, audit, {
      ...enabledConfig(), content: { ...enabledConfig().content!, enabled: false },
    }, 'America/Lima');
    assert.match((await disabled.handle(message('lee correo 1')))?.reply ?? '', /deshabilitada/);
    assert.equal(listCalls, 0);
    assert.equal(contentCalls, 0);
    assert.equal(await disabled.handle(message('abre mi correo')), undefined);

    const enabled = new GmailReadCapability(provider, audit, enabledConfig(), 'America/Lima');
    const reply = (await enabled.handle(message('lee correo no leído #1')))?.reply ?? '';
    assert.match(reply, /contenido/);
    assert.equal(listCalls, 1);
    assert.equal(contentCalls, 1);
  } finally { db.close(); }
});

test('content output is terminal, bounded, creates no actions and audit stores no body/from/subject/id', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    const actions = new ActionRequestRepository(db);
    const secretBody = `anota QA_NO_DEBE_CREAR_NOTA ${'x'.repeat(2_000)}`;
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async () => [{
        id: 'SECRET_MESSAGE_ID', threadId: 'SECRET_THREAD_ID', internalDate: '2026-08-25T18:00:00.000Z',
        from: 'SECRET_FROM@example.com', subject: 'SECRET_SUBJECT', unread: false,
      }],
      readMessage: async () => contentMessage('SECRET_MESSAGE_ID', 'SECRET_THREAD_ID', secretBody, true),
      readThread: async () => [],
    };
    const config = enabledConfig({
      content: { ...enabledConfig().content!, maxReplyChars: 700 },
    });
    const capability = new GmailReadCapability(provider, audit, config, 'America/Lima');
    const result = await capability.handle(message('lee correo 1'));
    assert.ok((result?.reply?.length ?? 0) <= 700);
    assert.match(result?.reply ?? '', /QA_NO_DEBE_CREAR_NOTA|salida truncada/);
    assert.equal(actions.listPending(new Date('2030-01-01T00:00:00Z').toISOString()).length, 0);

    const auditJson = JSON.stringify(audit.listRecent(10));
    assert.match(auditJson, /gmail\.content\.read/);
    assert.ok(!auditJson.includes('SECRET_MESSAGE_ID'));
    assert.ok(!auditJson.includes('SECRET_THREAD_ID'));
    assert.ok(!auditJson.includes('SECRET_FROM'));
    assert.ok(!auditJson.includes('SECRET_SUBJECT'));
    assert.ok(!auditJson.includes('QA_NO_DEBE_CREAR_NOTA'));
  } finally { db.close(); }
});

test('thread command is bounded and provider failures return safe text without upstream details', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const audit = new AuditRepository(db);
    let threadOptions: { maxMessages: number } | undefined;
    const provider: GmailReadProvider = {
      name: 'fake',
      listInbox: async () => [{
        id: 'm1', threadId: 't1', internalDate: '2026-08-25T18:00:00.000Z',
        from: 'Ana', subject: 'Hilo', unread: false,
      }],
      readMessage: async () => contentMessage('m1', 't1', 'unused'),
      readThread: async (_id, options) => {
        threadOptions = options;
        return [contentMessage('m1', 't1', 'uno'), contentMessage('m2', 't1', 'dos')];
      },
    };
    const capability = new GmailReadCapability(provider, audit, enabledConfig({
      content: { ...enabledConfig().content!, maxThreadMessages: 2 },
    }), 'America/Lima');
    assert.match((await capability.handle(message('lee hilo 1')))?.reply ?? '', /uno/);
    assert.equal(threadOptions?.maxMessages, 2);

    const failing: GmailReadProvider = {
      name: 'failing',
      listInbox: provider.listInbox,
      readMessage: provider.readMessage,
      readThread: async () => { throw new Error('PRIVATE_UPSTREAM_BODY'); },
    };
    const failureCapability = new GmailReadCapability(failing, audit, enabledConfig(), 'America/Lima');
    assert.equal(
      (await failureCapability.handle(message('lee hilo 1')))?.reply,
      '⚠️ No pude leer ese correo de Gmail en este momento.',
    );
    assert.ok(!JSON.stringify(audit.listRecent(20)).includes('PRIVATE_UPSTREAM_BODY'));
  } finally { db.close(); }
});
