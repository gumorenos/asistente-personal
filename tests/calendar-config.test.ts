import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('Calendar writes are disabled by default and Google primary is the default calendar', () => {
  const config = loadConfig({});
  assert.equal(config.calendar.enabled, false);
  assert.equal(config.calendar.provider, 'google');
  assert.equal(config.calendar.calendarId, 'primary');
});

test('enabling Calendar requires all OAuth refresh credentials', () => {
  assert.throws(() => loadConfig({ CALENDAR_ENABLED: 'true' }), /GOOGLE_CALENDAR_CLIENT_ID is required/);
  assert.throws(() => loadConfig({
    CALENDAR_ENABLED: 'true', GOOGLE_CALENDAR_CLIENT_ID: 'id',
  }), /GOOGLE_CALENDAR_CLIENT_SECRET is required/);
  assert.throws(() => loadConfig({
    CALENDAR_ENABLED: 'true', GOOGLE_CALENDAR_CLIENT_ID: 'id', GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
  }), /GOOGLE_CALENDAR_REFRESH_TOKEN is required/);

  const config = loadConfig({
    CALENDAR_ENABLED: 'true',
    GOOGLE_CALENDAR_CLIENT_ID: 'id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
    GOOGLE_CALENDAR_REFRESH_TOKEN: 'refresh',
  });
  assert.equal(config.calendar.enabled, true);
  assert.equal(config.calendar.clientId, 'id');
  assert.equal(config.calendar.clientSecret, 'secret');
  assert.equal(config.calendar.refreshToken, 'refresh');
});

test('Calendar config rejects unsupported provider, malformed calendar id and timeout', () => {
  assert.throws(() => loadConfig({ CALENDAR_PROVIDER: 'other' }), /Unsupported CALENDAR_PROVIDER/);
  assert.throws(() => loadConfig({ GOOGLE_CALENDAR_ID: 'has spaces' }), /Invalid GOOGLE_CALENDAR_ID/);
  assert.throws(() => loadConfig({ CALENDAR_TIMEOUT_MS: '10' }), /CALENDAR_TIMEOUT_MS/);
});
