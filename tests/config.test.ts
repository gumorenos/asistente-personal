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
  assert.throws(() => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'https://provider.example/v1', AI_API_KEY: 'key' }), /AI_MODEL is required/);
});

test('AI remote endpoints require HTTPS and a key; loopback HTTP may omit a key', () => {
  assert.throws(() => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'http://provider.example/v1', AI_MODEL: 'model', AI_API_KEY: 'key' }), /must use HTTPS/);
  assert.throws(() => loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'model' }), /AI_API_KEY is required/);
  const local = loadConfig({ AI_ENABLED: 'true', AI_BASE_URL: 'http://127.0.0.1:9000/v1', AI_MODEL: 'local-model' });
  assert.equal(local.ai.enabled, true);
  assert.equal(local.ai.apiKey, undefined);
});

test('AI configuration validates provider and numeric bounds', () => {
  assert.throws(() => loadConfig({ AI_PROVIDER: 'unknown' }), /Unsupported AI_PROVIDER/);
  assert.throws(() => loadConfig({ AI_TIMEOUT_MS: '10' }), /AI_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ AI_MAX_OUTPUT_TOKENS: '999999' }), /AI_MAX_OUTPUT_TOKENS/);
});

test('transcription is disabled by default and validates explicit provider configuration', () => {
  const disabled = loadConfig({});
  assert.equal(disabled.transcription.enabled, false);
  assert.throws(() => loadConfig({ TRANSCRIPTION_ENABLED: 'true' }), /TRANSCRIPTION_BASE_URL is required/);
  assert.throws(() => loadConfig({
    TRANSCRIPTION_ENABLED: 'true',
    TRANSCRIPTION_BASE_URL: 'https://audio.example/v1',
    TRANSCRIPTION_API_KEY: 'key',
  }), /TRANSCRIPTION_MODEL is required/);
});

test('transcription remote endpoint requires TLS/key and validates limits', () => {
  assert.throws(() => loadConfig({
    TRANSCRIPTION_ENABLED: 'true',
    TRANSCRIPTION_BASE_URL: 'http://audio.example/v1',
    TRANSCRIPTION_MODEL: 'whisper',
    TRANSCRIPTION_API_KEY: 'key',
  }), /must use HTTPS/);
  assert.throws(() => loadConfig({
    TRANSCRIPTION_ENABLED: 'true',
    TRANSCRIPTION_BASE_URL: 'https://audio.example/v1',
    TRANSCRIPTION_MODEL: 'whisper',
  }), /TRANSCRIPTION_API_KEY is required/);
  assert.throws(() => loadConfig({ TRANSCRIPTION_MAX_BYTES: '100' }), /TRANSCRIPTION_MAX_BYTES/);
  assert.throws(() => loadConfig({ TRANSCRIPTION_PROVIDER: 'unknown' }), /Unsupported TRANSCRIPTION_PROVIDER/);

  const local = loadConfig({
    TRANSCRIPTION_ENABLED: 'true',
    TRANSCRIPTION_BASE_URL: 'http://localhost:8000/v1',
    TRANSCRIPTION_MODEL: 'local-whisper',
  });
  assert.equal(local.transcription.enabled, true);
  assert.equal(local.transcription.apiKey, undefined);
});

test('document ingestion is local, disabled by default and uses conservative limits', () => {
  const config = loadConfig({});
  assert.equal(config.documents.enabled, false);
  assert.equal(config.documents.maxBytes, 10 * 1024 * 1024);
  assert.equal(config.documents.maxPages, 50);
  assert.equal(config.documents.maxTextChars, 100_000);
  assert.equal(config.documents.timeoutMs, 20_000);

  const enabled = loadConfig({ DOCUMENTS_ENABLED: 'true' });
  assert.equal(enabled.documents.enabled, true);
});

test('document ingestion validates byte, page, text and timeout bounds even while disabled', () => {
  assert.throws(() => loadConfig({ DOCUMENTS_MAX_BYTES: '100' }), /DOCUMENTS_MAX_BYTES/);
  assert.throws(() => loadConfig({ DOCUMENTS_MAX_PAGES: '0' }), /DOCUMENTS_MAX_PAGES/);
  assert.throws(() => loadConfig({ DOCUMENTS_MAX_PAGES: '201' }), /DOCUMENTS_MAX_PAGES/);
  assert.throws(() => loadConfig({ DOCUMENTS_MAX_TEXT_CHARS: '99' }), /DOCUMENTS_MAX_TEXT_CHARS/);
  assert.throws(() => loadConfig({ DOCUMENTS_TIMEOUT_MS: '999' }), /DOCUMENTS_TIMEOUT_MS/);
});
