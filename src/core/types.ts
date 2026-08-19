export type MessageKind = 'text' | 'audio' | 'image' | 'document' | 'video' | 'unknown';

export interface IncomingMessage {
  id: string;
  chatId: string;
  chatIdAlt?: string;
  senderId?: string;
  timestamp: number;
  text: string;
  kind: MessageKind;
  fromMe: boolean;
  isGroup: boolean;
}

export interface SendTextResult {
  messageId?: string;
}

export interface AssistantStatus {
  state: 'starting' | 'ready' | 'degraded' | 'stopped';
  transport: string;
  transportState: string;
}
