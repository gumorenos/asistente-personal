import assert from 'node:assert/strict';
import test from 'node:test';
import { AppDatabase } from '../src/database/db.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import type { IncomingMessage } from '../src/core/types.ts';

function fixture(id = 'm1'): IncomingMessage {
  return {
    id,
    chatId: 'self@s.whatsapp.net',
    timestamp: 1_700_000_000,
    text: 'ping',
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('migrations create storage and duplicate message ids are idempotent', () => {
  const db = new AppDatabase(':memory:');
  const repo = new MessageRepository(db);
  assert.equal(db.ping(), true);
  assert.equal(repo.saveIncoming(fixture()), true);
  assert.equal(repo.saveIncoming(fixture()), false);
  assert.equal(repo.countMessages(), 1);
  db.close();
});

test('assistant outbound ids are persisted to prevent reply loops', () => {
  const db = new AppDatabase(':memory:');
  const repo = new MessageRepository(db);
  assert.equal(repo.isAssistantOutbound('out-1'), false);
  repo.markAssistantOutbound('out-1', 'self@s.whatsapp.net');
  assert.equal(repo.isAssistantOutbound('out-1'), true);
  db.close();
});
