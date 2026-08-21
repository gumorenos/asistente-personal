import type { IncomingMessage } from '../core/types.ts';

export interface CapabilityResult {
  handled: boolean;
  reply?: string;
}

export interface Capability {
  readonly name: string;
  handle(message: IncomingMessage): Promise<CapabilityResult | undefined>;
}
