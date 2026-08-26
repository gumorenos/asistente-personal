import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';
import { GoogleGmailMetadataProvider } from '../src/gmail/google-gmail-metadata-provider.ts';

function tokenProvider(): GoogleOAuthAccessTokenProvider {
  return { getAccessToken: async () => 'token' } as unknown as GoogleOAuthAccessTokenProvider;
}

test('Gmail metadata strips Unicode control/format characters from untrusted headers', async () => {
  let call = 0;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }));
      }
      return new Response(JSON.stringify({
        id: 'm1',
        threadId: 't1',
        internalDate: '1787698800000',
        labelIds: ['INBOX'],
        payload: { headers: [
          { name: 'From', value: 'Ana\u202Eevil@example.com\u202C' },
          { name: 'Subject', value: 'Hola\u0000mundo\u200B!' },
        ] },
      }));
    },
  );

  const [row] = await provider.listInbox({ unreadOnly: false, limit: 1 });
  assert.ok(row);
  assert.ok(!/[\p{Cc}\p{Cf}]/u.test(row.from));
  assert.ok(!/[\p{Cc}\p{Cf}]/u.test(row.subject));
});

test('Gmail metadata rejects a detail response that does not match the listed message identity', async () => {
  let call = 0;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ messages: [{ id: 'expected', threadId: 'thread-1' }] }));
      }
      return new Response(JSON.stringify({
        id: 'different',
        threadId: 'thread-1',
        internalDate: '1787698800000',
        labelIds: ['INBOX'],
        payload: { headers: [] },
      }));
    },
  );

  await assert.rejects(
    () => provider.listInbox({ unreadOnly: false, limit: 1 }),
    /mismatched message/,
  );
});
