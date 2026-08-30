import assert from 'node:assert/strict';
import test from 'node:test';
import { runDoctor } from '../src/ops/doctor.ts';

test('doctor validates Gmail search config without contacting Gmail', () => {
  const report = runDoctor({
    APP_DB_PATH: ':memory:',
    GMAIL_SEARCH_ENABLED: 'true',
    GMAIL_SEARCH_CLIENT_ID: 'search-client',
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks[0]?.name, 'config');
  assert.match(report.checks[0]?.detail ?? '', /GMAIL_SEARCH_CLIENT_SECRET/);
});

test('doctor accepts a complete disabled-network Gmail search configuration', () => {
  const report = runDoctor({
    APP_DB_PATH: ':memory:',
    GMAIL_SEARCH_ENABLED: 'true',
    GMAIL_SEARCH_CLIENT_ID: 'search-client',
    GMAIL_SEARCH_CLIENT_SECRET: 'search-secret',
    GMAIL_SEARCH_REFRESH_TOKEN: 'search-refresh',
  });
  assert.equal(report.checks[0]?.name, 'config');
  assert.equal(report.checks[0]?.status, 'pass');
  // No Gmail connectivity check is performed; database :memory: may still make the overall report warn/pass.
  assert.ok(!report.checks.some((check) => check.name.includes('gmail') && check.status === 'fail'));
});
