import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from 'baileys';
import { logger } from '../../core/logger.ts';
import type { IncomingMessage, SendTextResult } from '../../core/types.ts';
import type { AppDatabase } from '../../database/db.ts';
import type { MessageRepository } from '../../database/message-repository.ts';
import { WhatsAppMessageStore } from '../../database/whatsapp-message-store.ts';
import type { IncomingMessageHandler, MessageTransport, SendTextOptions } from '../types.ts';
import { routeNormalizedWhatsAppMessage } from './inbound-routing.ts';
import { normalizeWhatsAppMessage } from './normalize-message.ts';
import { useSqliteAuthState } from './sqlite-auth-state.ts';

export interface WhatsAppTransportConfig {
  phoneNumber?: string;
  selfJids: string[];
  logMessageContent: boolean;
}

function statusCodeFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { output?: { statusCode?: number }; statusCode?: number };
  return candidate.output?.statusCode ?? candidate.statusCode;
}

function createSilentBaileysLogger(): never {
  const silent = {
    level: 'silent',
    child: () => silent,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
  };
  return silent as never;
}

function configuredPhoneJid(phoneNumber?: string): string | undefined {
  return phoneNumber ? `${phoneNumber}@s.whatsapp.net` : undefined;
}

export class BaileysWhatsAppTransport implements MessageTransport {
  readonly name = 'whatsapp-baileys';

  private socket?: WASocket;
  private handler?: IncomingMessageHandler;
  private state = 'idle';
  private pairingRequested = false;
  private stopping = false;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly selfJids: Set<string>;
  private readonly config: WhatsAppTransportConfig;
  private readonly database: AppDatabase;
  private readonly messages: MessageRepository;
  private readonly retryMessages: WhatsAppMessageStore;
  private readonly observerHandler?: IncomingMessageHandler;

  constructor(
    config: WhatsAppTransportConfig,
    database: AppDatabase,
    messages: MessageRepository,
    observerHandler?: IncomingMessageHandler,
  ) {
    this.config = config;
    this.database = database;
    this.messages = messages;
    this.retryMessages = new WhatsAppMessageStore(database);
    this.observerHandler = observerHandler;
    this.selfJids = new Set(config.selfJids);
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handler = handler;
  }

  getState(): string {
    return this.state;
  }

  async connect(): Promise<void> {
    this.stopping = false;
    await this.createSocket();
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    this.state = 'stopped';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      try {
        this.socket.end(new Error('assistant shutdown'));
      } catch {
        // Socket may already be closed.
      }
    }
    this.socket = undefined;
  }

  async sendText(destination: string, text: string, options: SendTextOptions = {}): Promise<SendTextResult> {
    if (!this.selfJids.has(destination)) {
      throw new Error(`Refusing to send outside configured self-chat allowlist: ${destination}`);
    }
    if (!this.socket || this.state !== 'open') throw new Error('WhatsApp transport is not connected');

    const sent = await this.socket.sendMessage(destination, { text });
    if (sent && options.persistence !== 'ephemeral') this.retryMessages.save(sent);
    const messageId = sent?.key.id ?? undefined;
    if (messageId) this.messages.markAssistantOutbound(messageId, destination);
    return { messageId };
  }

  private async createSocket(): Promise<void> {
    this.state = 'connecting';
    const { state, saveCreds } = await useSqliteAuthState(this.database);
    const baileysLogger = createSilentBaileysLogger();

    const socket = makeWASocket({
      auth: state,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async (key) => this.retryMessages.get(key),
    });

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (!state.creds.registered && !this.pairingRequested && this.config.phoneNumber && (connection === 'connecting' || qr)) {
        this.pairingRequested = true;
        try {
          const code = await socket.requestPairingCode(this.config.phoneNumber);
          logger.warn('WhatsApp pairing required', { pairingCode: code });
        } catch (error) {
          this.pairingRequested = false;
          logger.error('Could not request WhatsApp pairing code', { error: error instanceof Error ? error.message : String(error) });
        }
      } else if (!state.creds.registered && qr && !this.config.phoneNumber) {
        logger.warn('WhatsApp is not paired. Set WHATSAPP_PHONE_NUMBER to receive a pairing code.');
      }

      if (connection === 'open') {
        this.state = this.selfJids.size > 0 ? 'open' : 'needs_self_jid';
        this.pairingRequested = false;
        logger.info('WhatsApp connected', {
          automaticReplies: this.selfJids.size > 0,
          observerReadOnly: Boolean(this.observerHandler),
          ownSocketId: socket.user?.id,
        });
        if (this.selfJids.size === 0) {
          logger.warn('WHATSAPP_SELF_JIDS is empty; all inbound processing and outbound messages remain disabled', {
            configuredPhoneJid: configuredPhoneJid(this.config.phoneNumber),
            ownSocketId: socket.user?.id,
          });
        }
      }

      if (connection === 'close') {
        const statusCode = statusCodeFromError(lastDisconnect?.error);
        if (statusCode === DisconnectReason.loggedOut) {
          this.state = 'logged_out';
          logger.error('WhatsApp session logged out; manual pairing is required');
          return;
        }
        this.state = 'closed';
        if (!this.stopping) {
          this.scheduleReconnect(statusCode === DisconnectReason.restartRequired ? 100 : 3_000);
        }
      }
    });

    socket.ev.on('messages.upsert', async ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const raw of messages) await this.handleRawMessage(raw, socket, baileysLogger);
    });
  }

  private async handleRawMessage(raw: WAMessage, socket: WASocket, baileysLogger: never): Promise<void> {
    const normalized = normalizeWhatsAppMessage(raw);
    if (!normalized || this.messages.isAssistantOutbound(normalized.id)) return;

    const routed = routeNormalizedWhatsAppMessage(normalized, this.selfJids, Boolean(this.observerHandler));
    if (routed.route === 'ignored') return;

    if (routed.route === 'observer_candidate') {
      try {
        await this.observerHandler?.(routed.message);
      } catch (error) {
        logger.warn('Observer processing failed', { error: error instanceof Error ? error.name : 'unknown' });
      }
      return;
    }

    // Persist only authorized self-chat content needed by Baileys getMessage/retry.
    // Observer and ignored third-party/group traffic never enters this store.
    this.retryMessages.save(raw);

    // Media loaders are attached only after self-chat authorization. Observer never
    // gets a path that can download audio or documents.
    const message = this.attachLazySelfMediaLoader(routed.message, raw, socket, baileysLogger);
    if (this.config.logMessageContent) {
      logger.debug('Accepted self-chat message', { messageId: message.id, text: message.text });
    } else {
      logger.debug('Accepted self-chat message', { messageId: message.id, kind: message.kind });
    }
    await this.handler?.(message);
  }

  private attachLazySelfMediaLoader(
    message: IncomingMessage,
    raw: WAMessage,
    socket: WASocket,
    baileysLogger: never,
  ): IncomingMessage {
    if (message.kind !== 'audio' && message.kind !== 'document') return message;

    const audio = raw.message?.audioMessage;
    const document = raw.message?.documentMessage;
    const mimeType = audio?.mimetype ?? document?.mimetype ?? (message.kind === 'audio' ? 'audio/ogg' : 'application/octet-stream');
    const fileName = message.kind === 'audio'
      ? `audio-${message.id}.ogg`
      : document?.fileName ?? `document-${message.id}.bin`;

    return {
      ...message,
      loadMedia: async () => {
        const buffer = await downloadMediaMessage(raw, 'buffer', {}, {
          logger: baileysLogger,
          reuploadRequest: socket.updateMediaMessage,
        });
        return {
          data: new Uint8Array(buffer),
          mimeType,
          fileName,
        };
      },
    };
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.stopping) return;
      void this.createSocket().catch((error) => {
        logger.error('WhatsApp reconnect failed', { error: error instanceof Error ? error.message : String(error) });
        this.scheduleReconnect(5_000);
      });
    }, delayMs);
  }
}
