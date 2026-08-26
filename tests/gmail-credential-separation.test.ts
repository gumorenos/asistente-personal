import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGmailReadConfig } from '../src/gmail/read-config.ts';

const base = {
  GMAIL_READ_ENABLED: 'true',
  GMAIL_CLIENT_ID: 'metadata-client',
  GMAIL_CLIENT_SECRET: 'metadata-secret',
  GMAIL_REFRESH_TOKEN: 'metadata-refresh',
  GMAIL_BODY_READ_ENABLED: 'true',
  GMAIL_BODY_CLIENT_ID: 'body-client',
  GMAIL_BODY_CLIENT_SECRET: 'body-secret',
};

test('Stage 7B refuses to reuse the Stage 7A refresh token', () => {
  assert.throws(
    () => loadGmailReadConfig({ ...base, GMAIL_BODY_REFRESH_TOKEN: 'metadata-refresh' }),
    /GMAIL_BODY_REFRESH_TOKEN must differ from GMAIL_REFRESH_TOKEN/,
  );

  const config = loadGmailReadConfig({ ...base, GMAIL_BODY_REFRESH_TOKEN: 'body-refresh' });
  assert.equal(config.enabled, true);
});
