import assert from 'node:assert/strict';
import test from 'node:test';
import { runDoctor } from '../src/ops/doctor.ts';

test('doctor reports Gmail metadata read without performing provider connectivity work', () => {
  const report = runDoctor({
    APP_DB_PATH: ':memory:',
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'gmail-doctor-client',
    GMAIL_CLIENT_SECRET: 'gmail-doctor-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-doctor-refresh',
    GMAIL_READ_MAX_MESSAGES: '4',
  });

  assert.equal(report.ok, true);
  assert.equal(
    report.checks.find((check) => check.name === 'feature.gmail_metadata_read')?.detail,
    'enabled (4 max; metadata/headers only; connectivity not tested)',
  );
});

test('doctor fails closed before runtime when Gmail metadata read credentials are incomplete', () => {
  const report = runDoctor({
    APP_DB_PATH: ':memory:',
    GMAIL_READ_ENABLED: 'true',
    GMAIL_CLIENT_ID: 'gmail-doctor-client',
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks[0]?.name, 'config');
  assert.match(report.checks[0]?.detail ?? '', /GMAIL_CLIENT_SECRET/);
});
