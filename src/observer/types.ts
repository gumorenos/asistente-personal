import type { MessageKind } from '../core/types.ts';

export interface ObservationRecord {
  messageId: string;
  chatJid: string;
  senderId?: string;
  timestamp: number;
  text: string;
  kind: MessageKind;
  isGroup: boolean;
}

export interface ObservationSink {
  save(observation: ObservationRecord): Promise<boolean> | boolean;
}

export type ObservationResult =
  | { status: 'stored'; chatJid: string }
  | { status: 'duplicate'; chatJid: string }
  | { status: 'ignored_not_allowed' }
  | { status: 'ignored_non_text' }
  | { status: 'ignored_empty' };
