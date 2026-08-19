import { createHealthServer } from './api/health.ts';
import { loadConfig } from './config.ts';
import { AssistantCore } from './core/assistant.ts';
import { logger } from './core/logger.ts';
import type { AssistantStatus } from './core/types.ts';
import { AppDatabase } from './database/db.ts';
import { MessageRepository } from './database/message-repository.ts';
import { DisabledTransport } from './transports/disabled.ts';
import type { MessageTransport } from './transports/types.ts';
import { BaileysWhatsAppTransport } from './transports/whatsapp/baileys-transport.ts';

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const messages = new MessageRepository(database);

let transport: MessageTransport;
if (config.whatsapp.enabled) {
  transport = new BaileysWhatsAppTransport(config.whatsapp, database, messages);
} else {
  transport = new DisabledTransport();
}

const core = new AssistantCore(transport, messages);
transport.onMessage((message) => core.handleIncoming(message));

let appState: AssistantStatus['state'] = 'starting';

const healthServer = await createHealthServer(config.healthHost, config.healthPort, {
  isDatabaseReady: () => database.ping(),
  getAssistantStatus: () => ({
    state: appState,
    transport: transport.name,
    transportState: transport.getState(),
  }),
});

try {
  await transport.connect();
  appState = 'ready';
  logger.info('Assistant started', {
    dbPath: database.path,
    health: `${config.healthHost}:${config.healthPort}`,
    transport: transport.name,
    transportState: transport.getState(),
  });
} catch (error) {
  appState = 'degraded';
  logger.error('Assistant transport failed to start; health API remains available', {
    error: error instanceof Error ? error.message : String(error),
  });
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  appState = 'stopped';
  logger.info('Shutting down', { signal });

  await transport.disconnect().catch(() => undefined);
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
