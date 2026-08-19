import { logger } from './logger.ts';
import { routeMessage } from './router.ts';
import type { IncomingMessage } from './types.ts';
import type { MessageRepository } from '../database/message-repository.ts';
import type { MessageTransport } from '../transports/types.ts';
import type { LocalCapabilities } from '../capabilities/local-capabilities.ts';

export class AssistantCore {
  private readonly transport: MessageTransport;
  private readonly messages: MessageRepository;
  private readonly capabilities?: LocalCapabilities;

  constructor(
    transport: MessageTransport,
    messages: MessageRepository,
    capabilities?: LocalCapabilities,
  ) {
    this.transport = transport;
    this.messages = messages;
    this.capabilities = capabilities;
  }

  async handleIncoming(message: IncomingMessage): Promise<void> {
    if (this.messages.isAssistantOutbound(message.id)) {
      logger.debug('Ignoring assistant-authored outbound echo', { messageId: message.id });
      return;
    }

    const inserted = this.messages.saveIncoming(message);
    if (!inserted) {
      logger.debug('Ignoring duplicate message', { messageId: message.id });
      return;
    }

    const capabilityRoute = await this.capabilities?.handle(message);
    const route = capabilityRoute ?? routeMessage(message);
    if (!route.handled || !route.reply) return;

    const result = await this.transport.sendText(message.chatId, route.reply);
    if (result.messageId) {
      this.messages.markAssistantOutbound(result.messageId, message.chatId);
    } else {
      logger.warn('Transport sent a reply without returning a message id');
    }
  }
}
