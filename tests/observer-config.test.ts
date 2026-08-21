import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('observer is disabled by default', () => {
  const config = loadConfig({});
  assert.equal(config.observer.enabled, false);
});

test('observer requires WhatsApp transport when enabled', () => {
  assert.throws(() => loadConfig({ OBSERVER_ENABLED: 'true' }), /WHATSAPP_ENABLED=true/);
});

test('observer requires an explicit administrative self-chat allowlist', () => {
  assert.throws(() => loadConfig({
    OBSERVER_ENABLED: 'true',
    WHATSAPP_ENABLED: 'true',
  }), /WHATSAPP_SELF_JIDS/);
});

test('observer can be enabled only with WhatsApp and an explicit self-chat JID', () => {
  const config = loadConfig({
    OBSERVER_ENABLED: 'true',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_SELF_JIDS: '51911111111@s.whatsapp.net',
  });
  assert.equal(config.observer.enabled, true);
  assert.deepEqual(config.whatsapp.selfJids, ['51911111111@s.whatsapp.net']);
});
