import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('config validates and deduplicates self-chat JIDs', () => {
  const config = loadConfig({
    APP_TIMEZONE: 'America/Lima',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_PHONE_NUMBER: '51987654321',
    WHATSAPP_SELF_JIDS: '51987654321@s.whatsapp.net,51987654321@s.whatsapp.net,12345@lid',
  });
  assert.deepEqual(config.whatsapp.selfJids, ['51987654321@s.whatsapp.net', '12345@lid']);
  assert.equal(config.whatsapp.phoneNumber, '51987654321');
});

test('config rejects groups and malformed self-chat JIDs', () => {
  assert.throws(() => loadConfig({ WHATSAPP_SELF_JIDS: '123@g.us' }), /Invalid WHATSAPP_SELF_JIDS entry/);
  assert.throws(() => loadConfig({ WHATSAPP_SELF_JIDS: 'someone@s.whatsapp.net' }), /Invalid WHATSAPP_SELF_JIDS entry/);
});

test('config rejects invalid timezone, phone and boolean values', () => {
  assert.throws(() => loadConfig({ APP_TIMEZONE: 'Mars/Olympus' }), /Invalid APP_TIMEZONE/);
  assert.throws(() => loadConfig({ WHATSAPP_PHONE_NUMBER: '+51 999' }), /WHATSAPP_PHONE_NUMBER/);
  assert.throws(() => loadConfig({ WHATSAPP_ENABLED: 'maybe' }), /Invalid boolean/);
});

test('AI is disabled by default and requires endpoint/model when enabled', () => {
  const disabled = loadConfig({});
  assert.equal(disabled.ai.enabled, false);
  assert.equal(disabled.ai.provider, 'openai-compatible');

  assert.throws(() => loadConfig({ AI_ENABLED: 'true' }), /AI_BASE_URL is required/);
  assert.throws(
    () => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'https://provider.example/v1', AI_API_KEY: 'key' }),
    /AI_MODEL is required/,
  );
});

test('AI remote endpoints require HTTPS and a key; loopback HTTP may omit a key', () => {
  assert.throws(
    () => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'http://provider.example/v1', AI_MODEL: 'model', AI_API_KEY: 'key' }),
    /must use HTTPS/,
  );
  assert.throws(
    () => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'model' }),
    /AI_API_KEY is required/,
  );

  const local = loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'http://127.0.0.1:9000/v1', AI_MODEL: 'local-model' });
  assert.equal(local.ai.enabled, true);
  assert.equal(local.ai.apiKey, undefined);
});

test('AI configuration validates provider and numeric bounds', () => {
  assert.throws(() => loadConfig({ AI_PROVIDER: 'unknown' }), /Unsupported AI_PROVIDER/);
  assert.throws(() => loadConfig({ AI_TIMEOUT_MS: '10' }), /AI_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ AI_MAX_OUTPUT_TOKENS: '999999' }), /AI_MAX_OUTPUT_TOKENS/);
});
