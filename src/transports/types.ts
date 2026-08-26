import type { IncomingMessage, SendTextResult } from '../core/types.ts';

export type IncomingMessageHandler = (message: IncomingMessage) => Promise<void> | void;

export interface SendTextOptions {
  /**
   * `ephemeral` means the transport must not retain the message payload in an optional
   * local retry/recovery store. It does not attempt to alter provider-side retention.
   */
  persistence?: 'default' | 'ephemeral';
}

export interface MessageTransport {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: IncomingMessageHandler): void;
  sendText(destination: string, text: string, options?: SendTextOptions): Promise<SendTextResult>;
  getState(): string;
}
