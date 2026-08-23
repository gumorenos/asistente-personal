export type MessageKind = 'text' | 'audio' | 'image' | 'document' | 'video' | 'unknown';

export interface LoadedMedia {
  data: Uint8Array;
  mimeType?: string;
  fileName?: string;
}

export type MediaLoader = () => Promise<LoadedMedia>;

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
  mediaSizeBytes?: number;
  mediaMimeType?: string;
  mediaFileName?: string;
  loadMedia?: MediaLoader;
}

export interface SendTextResult {
  messageId?: string;
}

export interface AssistantStatus {
  state: 'starting' | 'ready' | 'degraded' | 'stopped';
  transport: string;
  transportState: string;
}
