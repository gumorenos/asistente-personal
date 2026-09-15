import assert from 'node:assert/strict';
import test from 'node:test';
import { runDoctor } from '../src/ops/doctor.ts';

test('doctor reports Stage 8A locally without invoking external providers and fails closed on invalid bounds', () => {
  const enabled = runDoctor({
    APP_DB_PATH: ':memory:',
    EXECUTIVE_SUMMARY_ENABLED: 'true',
    EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES: '2',
    EXECUTIVE_SUMMARY_MAX_CALENDAR_EVENTS: '4',
    EXECUTIVE_SUMMARY_MAX_LOCAL_ITEMS: '2',
    EXECUTIVE_SUMMARY_MAX_REPLY_CHARS: '2500',
  });

  assert.equal(enabled.ok, true);
  const feature = enabled.checks.find((check) => check.name === 'feature.executive_summary');
  assert.equal(feature?.status, 'pass');
  assert.match(feature?.detail ?? '', /enabled/);
  assert.match(feature?.detail ?? '', /2 local/);
  assert.match(feature?.detail ?? '', /4 calendar/);
  assert.match(feature?.detail ?? '', /2 Gmail/);

  const invalid = runDoctor({
    APP_DB_PATH: ':memory:',
    EXECUTIVE_SUMMARY_ENABLED: 'true',
    EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES: '0',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.checks[0]?.name, 'config');
  assert.equal(invalid.checks[0]?.status, 'fail');
  assert.match(invalid.checks[0]?.detail ?? '', /EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES/);
});
