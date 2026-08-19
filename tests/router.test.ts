import assert from 'node:assert/strict';
import test from 'node:test';
import { routeMessage } from '../src/core/router.ts';
import type { IncomingMessage } from '../src/core/types.ts';

function message(text: string): IncomingMessage {
  return {
    id: 'm1',
    chatId: 'self@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

test('ping is deterministic and does not require AI', () => {
  assert.deepEqual(routeMessage(message('ping')), { handled: true, reply: 'pong' });
});

test('unknown text is acknowledged without external actions', () => {
  const result = routeMessage(message('algo cualquiera'));
  assert.equal(result.handled, true);
  assert.match(result.reply ?? '', /Mensaje recibido y guardado/);
});
