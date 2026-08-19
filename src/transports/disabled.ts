import type { SendTextResult } from '../core/types.ts';
import type { IncomingMessageHandler, MessageTransport } from './types.ts';

export class DisabledTransport implements MessageTransport {
  readonly name = 'disabled';
  private state = 'disabled';

  async connect(): Promise<void> {
    this.state = 'disabled';
  }

  async disconnect(): Promise<void> {
    this.state = 'stopped';
  }

  onMessage(_handler: IncomingMessageHandler): void {
    // Intentionally disabled.
  }

  async sendText(_destination: string, _text: string): Promise<SendTextResult> {
    throw new Error('Message transport is disabled');
  }

  getState(): string {
    return this.state;
  }
}
