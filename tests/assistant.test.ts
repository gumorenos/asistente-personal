import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantCore } from '../src/core/assistant.ts';
import { AppDatabase } from '../src/database/db.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';
import type { SendTextResult } from '../src/core/types.ts';

class FakeTransport implements MessageTransport {
  readonly name = 'fake';
  sent: Array<{ destination: string; text: string }> = [];
  handler?: IncomingMessageHandler;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(handler: IncomingMessageHandler): void { this.handler = handler; }
  getState(): string { return 'open'; }
  async sendText(destination: string, text: string): Promise<SendTextResult> {
    this.sent.push({ destination, text });
    return { messageId: `out-${this.sent.length}` };
  }
}

test('core replies once and duplicate delivery does not trigger a second reply', async () => {
  const db = new AppDatabase(':memory:');
  const repo = new MessageRepository(db);
  const transport = new FakeTransport();
  const core = new AssistantCore(transport, repo);

  const message = {
    id: 'in-1',
    chatId: 'self@s.whatsapp.net',
    timestamp: 1,
    text: 'ping',
    kind: 'text',
    fromMe: true,
    isGroup: false,
  } as const;

  await core.handleIncoming(message);
  await core.handleIncoming(message);

  assert.deepEqual(transport.sent, [{ destination: 'self@s.whatsapp.net', text: 'pong' }]);
  assert.equal(repo.isAssistantOutbound('out-1'), true);
  db.close();
});
