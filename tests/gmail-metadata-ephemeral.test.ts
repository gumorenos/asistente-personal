import assert from 'node:assert/strict';
import test from 'node:test';
import { GmailReadCapability } from '../src/capabilities/gmail-read-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import type { GmailReadConfig } from '../src/gmail/read-config.ts';
import type { GmailReadProvider } from '../src/gmail/types.ts';

const config: GmailReadConfig = {
  enabled: true,
  clientId: 'metadata-client',
  clientSecret: 'metadata-secret',
  refreshToken: 'metadata-refresh',
  timeoutMs: 20_000,
  maxMessages: 5,
  maxReplyChars: 3_500,
};

function message(text: string): IncomingMessage {
  return {
    id: `metadata-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1_777_000_000,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('Gmail metadata replies are ephemeral so From/Subject do not enter local retry storage', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const provider: GmailReadProvider = {
      name: 'metadata-fake',
      listInbox: async () => [{
        id: 'm1',
        threadId: 't1',
        internalDate: '2026-08-25T18:00:00.000Z',
        from: 'PRIVATE-FROM@example.com',
        subject: 'PRIVATE-SUBJECT',
        unread: true,
      }],
    };
    const capability = new GmailReadCapability(
      provider,
      new AuditRepository(db),
      config,
      'America/Lima',
      { bodyConfig: {
        enabled: false,
        timeoutMs: 20_000,
        maxReplyChars: 3_500,
        maxResponseBytes: 524_288,
        selectionTtlMs: 15 * 60_000,
      } },
    );

    const result = await capability.handle(message('correos'));
    assert.equal(result?.handled, true);
    assert.equal(result?.replyPersistence, 'ephemeral');
    assert.match(result?.reply ?? '', /PRIVATE-FROM/);
    assert.match(result?.reply ?? '', /PRIVATE-SUBJECT/);
  } finally {
    db.close();
  }
});
