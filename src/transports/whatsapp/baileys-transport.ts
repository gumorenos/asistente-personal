import makeWASocket, {
  Browsers,
  DisconnectReason,
  type WASocket,
  type WAMessage,
} from 'baileys';
import { logger } from '../../core/logger.ts';
import type { SendTextResult } from '../../core/types.ts';
import type { AppDatabase } from '../../database/db.ts';
import type { MessageRepository } from '../../database/message-repository.ts';
import type { IncomingMessageHandler, MessageTransport } from '../types.ts';
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

export class BaileysWhatsAppTransport implements MessageTransport {
  readonly name = 'whatsapp-baileys';

  private socket?: WASocket;
  private handler?: IncomingMessageHandler;
  private state = 'idle';
  private pairingRequested = false;
  private stopping = false;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly selfJids: Set<string>;
  private readonly discoveredJids = new Set<string>();
  private readonly config: WhatsAppTransportConfig;
  private readonly database: AppDatabase;
  private readonly messages: MessageRepository;

  constructor(
    config: WhatsAppTransportConfig,
    database: AppDatabase,
    messages: MessageRepository,
  ) {
    this.config = config;
    this.database = database;
    this.messages = messages;
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

  async sendText(destination: string, text: string): Promise<SendTextResult> {
    if (!this.selfJids.has(destination)) {
      throw new Error(`Refusing to send outside configured self-chat allowlist: ${destination}`);
    }
    if (!this.socket || this.state !== 'open') {
      throw new Error('WhatsApp transport is not connected');
    }

    const sent = await this.socket.sendMessage(destination, { text });
    const messageId = sent?.key.id ?? undefined;
    if (messageId) this.messages.markAssistantOutbound(messageId, destination);
    return { messageId };
  }

  private async createSocket(): Promise<void> {
    this.state = 'connecting';
    const { state, saveCreds } = await useSqliteAuthState(this.database);

    const socket = makeWASocket({
      auth: state,
      logger: createSilentBaileysLogger(),
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async () => undefined,
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
          logger.error('Could not request WhatsApp pairing code', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (!state.creds.registered && qr && !this.config.phoneNumber) {
        logger.warn('WhatsApp is not paired. Set WHATSAPP_PHONE_NUMBER to receive a pairing code.');
      }

      if (connection === 'open') {
        this.state = this.selfJids.size > 0 ? 'open' : 'needs_self_jid';
        this.pairingRequested = false;
        logger.info('WhatsApp connected', {
          automaticReplies: this.selfJids.size > 0,
          ownSocketId: socket.user?.id,
        });
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
          const immediate = statusCode === DisconnectReason.restartRequired;
          this.scheduleReconnect(immediate ? 100 : 3_000);
        }
      }
    });

    socket.ev.on('messages.upsert', async ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const raw of messages) {
        await this.handleRawMessage(raw);
      }
    });
  }

  private async handleRawMessage(raw: WAMessage): Promise<void> {
    const message = normalizeWhatsAppMessage(raw);
    if (!message || !message.fromMe || message.isGroup) return;
    if (this.messages.isAssistantOutbound(message.id)) return;

    if (this.selfJids.size === 0) {
      for (const jid of [message.chatId, message.chatIdAlt].filter((value): value is string => Boolean(value))) {
        if (!this.discoveredJids.has(jid)) {
          this.discoveredJids.add(jid);
          logger.warn('Self-chat allowlist not configured; candidate JID observed but message was NOT processed', { jid });
        }
      }
      return;
    }

    const allowed = this.selfJids.has(message.chatId) || (message.chatIdAlt ? this.selfJids.has(message.chatIdAlt) : false);
    if (!allowed) return;

    if (this.config.logMessageContent) {
      logger.debug('Accepted self-chat message', { messageId: message.id, text: message.text });
    } else {
      logger.debug('Accepted self-chat message', { messageId: message.id, kind: message.kind });
    }

    await this.handler?.(message);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.stopping) return;
      void this.createSocket().catch((error) => {
        logger.error('WhatsApp reconnect failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect(5_000);
      });
    }, delayMs);
  }
}
