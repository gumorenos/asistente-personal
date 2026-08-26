import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuthAccessTokenProvider } from '../src/calendar/google-oauth-token-provider.ts';
import { GoogleGmailMetadataProvider } from '../src/gmail/google-gmail-metadata-provider.ts';

function tokenProvider(): GoogleOAuthAccessTokenProvider {
  return {
    getAccessToken: async () => 'token',
  } as unknown as GoogleOAuthAccessTokenProvider;
}

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

test('multiple decoded text MIME parts share one aggregate byte budget', async () => {
  let call = 0;
  const provider = new GoogleGmailMetadataProvider(
    { timeoutMs: 20_000, apiBaseUrl: 'https://gmail.test/gmail/v1' },
    tokenProvider(),
    async () => {
      call += 1;
      if (call === 1) {
        // Preflight itself is below the limit; the hostile full response expands into
        // multiple text candidates whose aggregate decoded bytes exceed it.
        return new Response(JSON.stringify({ id: 'm1', threadId: 't1', sizeEstimate: 9 }));
      }
      return new Response(JSON.stringify({
        id: 'm1',
        threadId: 't1',
        internalDate: '1787698800000',
        sizeEstimate: 9,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'qa@example.com' },
            { name: 'Subject', value: 'aggregate limit' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('123456') } },
            { mimeType: 'text/html', body: { data: b64url('abcdef') } },
          ],
        },
      }));
    },
  );

  await assert.rejects(
    () => provider.readMessage('m1', { maxBodyChars: 100, maxMessageBytes: 10 }),
    /aggregate configured limit/,
  );
  assert.equal(call, 2);
});
