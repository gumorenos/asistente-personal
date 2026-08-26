import type { IncomingMessage } from '../core/types.ts';

export interface CapabilityResult {
  handled: boolean;
  reply?: string;
  /**
   * `ephemeral` asks transports not to retain the reply payload in local recovery/retry stores.
   * The outbound message id may still be retained for loop/duplicate protection.
   */
  replyPersistence?: 'default' | 'ephemeral';
}

export interface Capability {
  readonly name: string;
  handle(message: IncomingMessage): Promise<CapabilityResult | undefined>;
}
