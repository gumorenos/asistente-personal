import type { IncomingMessage, SendTextResult } from '../core/types.ts';

export type IncomingMessageHandler = (message: IncomingMessage) => Promise<void> | void;

export interface MessageTransport {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: IncomingMessageHandler): void;
  sendText(destination: string, text: string): Promise<SendTextResult>;
  getState(): string;
}
