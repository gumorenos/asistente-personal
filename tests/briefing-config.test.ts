import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('daily briefing is disabled by default with 08:00 schedule', () => {
  const config = loadConfig({});
  assert.equal(config.briefing.enabled, false);
  assert.equal(config.briefing.hour, 8);
  assert.equal(config.briefing.minute, 0);
  assert.equal(config.briefing.destinationJid, undefined);
});

test('enabling daily briefing requires WhatsApp and explicit allowlisted destination', () => {
  assert.throws(() => loadConfig({ BRIEFING_ENABLED: 'true' }), /WHATSAPP_ENABLED=true is required/);
  assert.throws(() => loadConfig({ BRIEFING_ENABLED: 'true', WHATSAPP_ENABLED: 'true' }), /BRIEFING_DESTINATION_JID is required/);
  assert.throws(() => loadConfig({
    BRIEFING_ENABLED: 'true', WHATSAPP_ENABLED: 'true',
    WHATSAPP_SELF_JIDS: '51911111111@s.whatsapp.net',
    BRIEFING_DESTINATION_JID: '51922222222@s.whatsapp.net',
  }), /must be present in WHATSAPP_SELF_JIDS/);

  const config = loadConfig({
    BRIEFING_ENABLED: 'true',
    BRIEFING_TIME: '07:30',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_SELF_JIDS: '51911111111@s.whatsapp.net,12345@lid',
    BRIEFING_DESTINATION_JID: '51911111111@s.whatsapp.net',
  });
  assert.equal(config.briefing.enabled, true);
  assert.equal(config.briefing.hour, 7);
  assert.equal(config.briefing.minute, 30);
  assert.equal(config.briefing.destinationJid, '51911111111@s.whatsapp.net');
});

test('briefing schedule and destination format are validated even while disabled', () => {
  assert.throws(() => loadConfig({ BRIEFING_TIME: '8am' }), /HH:MM/);
  assert.throws(() => loadConfig({ BRIEFING_TIME: '25:00' }), /Invalid BRIEFING_TIME/);
  assert.throws(() => loadConfig({ BRIEFING_DESTINATION_JID: 'not-a-jid' }), /Invalid BRIEFING_DESTINATION_JID/);
});
