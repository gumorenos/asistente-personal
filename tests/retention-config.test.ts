import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('retention is disabled by default with conservative windows', () => {
  const config = loadConfig({});
  assert.equal(config.retention.enabled, false);
  assert.deepEqual(config.retention, {
    enabled: false,
    messageDays: 30,
    outboundDays: 30,
    auditDays: 90,
    briefingDays: 90,
  });
});

test('retention windows can be configured independently when enabled', () => {
  const config = loadConfig({
    RETENTION_ENABLED: 'true',
    MESSAGE_RETENTION_DAYS: '14',
    OUTBOUND_RETENTION_DAYS: '21',
    AUDIT_RETENTION_DAYS: '180',
    BRIEFING_RETENTION_DAYS: '60',
  });
  assert.deepEqual(config.retention, {
    enabled: true,
    messageDays: 14,
    outboundDays: 21,
    auditDays: 180,
    briefingDays: 60,
  });
});

test('retention settings validate booleans and bounded positive day counts', () => {
  assert.throws(() => loadConfig({ RETENTION_ENABLED: 'maybe' }), /Invalid boolean/);
  assert.throws(() => loadConfig({ MESSAGE_RETENTION_DAYS: '0' }), /MESSAGE_RETENTION_DAYS/);
  assert.throws(() => loadConfig({ OUTBOUND_RETENTION_DAYS: '-1' }), /OUTBOUND_RETENTION_DAYS/);
  assert.throws(() => loadConfig({ AUDIT_RETENTION_DAYS: '3651' }), /AUDIT_RETENTION_DAYS/);
  assert.throws(() => loadConfig({ BRIEFING_RETENTION_DAYS: '1.5' }), /BRIEFING_RETENTION_DAYS/);
});
