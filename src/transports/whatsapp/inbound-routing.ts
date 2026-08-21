import type { IncomingMessage } from '../../core/types.ts';
import { resolveAllowedSelfChat } from './self-chat-guard.ts';

export type InboundRoute =
  | { route: 'self'; message: IncomingMessage }
  | { route: 'observer_candidate'; message: IncomingMessage }
  | { route: 'ignored' };

export function routeNormalizedWhatsAppMessage(
  message: IncomingMessage,
  selfJids: ReadonlySet<string>,
  observerEnabled: boolean,
): InboundRoute {
  const authorizedSelf = resolveAllowedSelfChat(message, selfJids);
  if (authorizedSelf) return { route: 'self', message: authorizedSelf };
  if (observerEnabled) return { route: 'observer_candidate', message };
  return { route: 'ignored' };
}
