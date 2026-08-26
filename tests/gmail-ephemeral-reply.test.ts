import assert from 'node:assert/strict';
import test from 'node:test';
import type { WASocket } from 'baileys';
import type { Capability } from '../src/capabilities/types.ts';
import { AssistantCore } from '../src/core/assistant.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AppDatabase } from '../src/database/db.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { WhatsAppMessageStore } from '../src/database/whatsapp-message-store.ts';
import { BaileysWhatsAppTransport } from '../src/transports/whatsapp/baileys-transport.ts';
import type { MessageTransport, SendTextOptions } from '../src/transports/types.ts';

const jid = '51999999999@s.whatsapp.net';

function inbound(id: string): IncomingMessage {
  return {
    id,
    chatId: jid,
    timestamp: 1_777_000_000,
    text: 'correo #1',
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('AssistantCore propagates ephemeral reply persistence to MessageTransport', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const messages = new MessageRepository(db);
    let receivedOptions: SendTextOptions | undefined;
    const transport: MessageTransport = {
      name: 'capture',
      connect: async () => undefined,
      disconnect: async () => undefined,
      onMessage: () => undefined,
      getState: () => 'open',
      sendText: async (_destination, _text, options) => {
        receivedOptions = options;
        return { messageId: 'out-ephemeral' };
      },
    };
    const capability: Capability = {
      name: 'sensitive-test',
      handle: async () => ({ handled: true, reply: 'PRIVATE BODY', replyPersistence: 'ephemeral' }),
    };
    const core = new AssistantCore(transport, messages, [capability]);
    await core.handleIncoming(inbound('in-1'));
    assert.equal(receivedOptions?.persistence, 'ephemeral');
    assert.equal(messages.isAssistantOutbound('out-ephemeral'), true);
  } finally { db.close(); }
});

test('Baileys transport skips local retry payload storage for ephemeral replies but keeps outbound loop marker', async () => {
  const db = new AppDatabase(':memory:');
  try {
    const messages = new MessageRepository(db);
    const transport = new BaileysWhatsAppTransport(
      { selfJids: [jid], logMessageContent: false },
      db,
      messages,
    );
    let sequence = 0;
    const fakeSocket = {
      sendMessage: async (destination: string, content: { text: string }) => {
        sequence += 1;
        return {
          key: { remoteJid: destination, id: `out-${sequence}`, fromMe: true },
          message: { conversation: content.text },
        };
      },
    } as unknown as WASocket;
    const writable = transport as unknown as { socket?: WASocket; state: string };
    writable.socket = fakeSocket;
    writable.state = 'open';

    const retryStore = new WhatsAppMessageStore(db);
    await transport.sendText(jid, 'PRIVATE BODY', { persistence: 'ephemeral' });
    assert.equal(retryStore.count(), 0);
    assert.equal(messages.isAssistantOutbound('out-1'), true);

    await transport.sendText(jid, 'ordinary response');
    assert.equal(retryStore.count(), 1);
    assert.deepEqual(retryStore.get({ remoteJid: jid, id: 'out-2' }), { conversation: 'ordinary response' });
  } finally { db.close(); }
});
