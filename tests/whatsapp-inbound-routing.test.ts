import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from '../src/core/types.ts';
import { routeNormalizedWhatsAppMessage } from '../src/transports/whatsapp/inbound-routing.ts';

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'm1',
    chatId: '51911111111@s.whatsapp.net',
    timestamp: 1,
    text: 'hola',
    kind: 'text',
    fromMe: false,
    isGroup: false,
    ...overrides,
  };
}

test('authorized self-chat always routes to core and never to observer', () => {
  const selfJids = new Set(['51911111111@s.whatsapp.net']);
  const routed = routeNormalizedWhatsAppMessage(message({ fromMe: true }), selfJids, true);
  assert.equal(routed.route, 'self');
});

test('authorized alternate self JID is canonicalized before core routing', () => {
  const selfJids = new Set(['123456789@lid']);
  const routed = routeNormalizedWhatsAppMessage(message({
    fromMe: true,
    chatId: '51911111111@s.whatsapp.net',
    chatIdAlt: '123456789@lid',
  }), selfJids, true);
  assert.equal(routed.route, 'self');
  if (routed.route === 'self') assert.equal(routed.message.chatId, '123456789@lid');
});

test('third-party or group message is ignored when observer is disabled', () => {
  const selfJids = new Set(['51911111111@s.whatsapp.net']);
  assert.equal(routeNormalizedWhatsAppMessage(message(), selfJids, false).route, 'ignored');
  assert.equal(routeNormalizedWhatsAppMessage(message({
    chatId: '120363123456789@g.us',
    isGroup: true,
  }), selfJids, false).route, 'ignored');
});

test('non-self message becomes observer candidate only when observer is enabled', () => {
  const selfJids = new Set(['51911111111@s.whatsapp.net']);
  const routed = routeNormalizedWhatsAppMessage(message(), selfJids, true);
  assert.equal(routed.route, 'observer_candidate');
});

test('group can be an observer candidate but can never route to self core', () => {
  const selfJids = new Set(['51911111111@s.whatsapp.net']);
  const routed = routeNormalizedWhatsAppMessage(message({
    chatId: '120363123456789@g.us',
    fromMe: true,
    isGroup: true,
  }), selfJids, true);
  assert.equal(routed.route, 'observer_candidate');
});
