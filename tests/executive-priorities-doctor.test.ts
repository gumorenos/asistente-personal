import assert from 'node:assert/strict';
import test from 'node:test';
import { runDoctor } from '../src/ops/doctor.ts';

test('doctor reports Stage 8B locally without provider connectivity and fails closed on invalid bounds', () => {
  const enabled = runDoctor({
    APP_DB_PATH: ':memory:',
    EXECUTIVE_PRIORITIES_ENABLED: 'true',
    EXECUTIVE_PRIORITIES_MAX_ACTION_ITEMS: '4',
    EXECUTIVE_PRIORITIES_MAX_GMAIL_MESSAGES: '2',
    EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS: '1800',
  });

  assert.equal(enabled.ok, true);
  const feature = enabled.checks.find((check) => check.name === 'feature.executive_priorities');
  assert.equal(feature?.status, 'pass');
  assert.match(feature?.detail ?? '', /enabled/);
  assert.match(feature?.detail ?? '', /4 action/);
  assert.match(feature?.detail ?? '', /2 unread Gmail/);
  assert.match(feature?.detail ?? '', /deterministic explicit only/);

  const invalid = runDoctor({
    APP_DB_PATH: ':memory:',
    EXECUTIVE_PRIORITIES_ENABLED: 'true',
    EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS: '799',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.checks[0]?.name, 'config');
  assert.equal(invalid.checks[0]?.status, 'fail');
  assert.match(invalid.checks[0]?.detail ?? '', /EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS/);
});
