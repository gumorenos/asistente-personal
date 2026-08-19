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
  assert.throws(
    () => loadConfig({ WHATSAPP_SELF_JIDS: '123@g.us' }),
    /Invalid WHATSAPP_SELF_JIDS entry/,
  );
  assert.throws(
    () => loadConfig({ WHATSAPP_SELF_JIDS: 'someone@s.whatsapp.net' }),
    /Invalid WHATSAPP_SELF_JIDS entry/,
  );
});

test('config rejects invalid timezone, phone and boolean values', () => {
  assert.throws(() => loadConfig({ APP_TIMEZONE: 'Mars/Olympus' }), /Invalid APP_TIMEZONE/);
  assert.throws(() => loadConfig({ WHATSAPP_PHONE_NUMBER: '+51 999' }), /WHATSAPP_PHONE_NUMBER/);
  assert.throws(() => loadConfig({ WHATSAPP_ENABLED: 'maybe' }), /Invalid boolean/);
});
