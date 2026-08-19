import { createHealthServer } from './api/health.ts';
import { LocalCapabilities } from './capabilities/local-capabilities.ts';
import { loadConfig } from './config.ts';
import { AssistantCore } from './core/assistant.ts';
import { logger } from './core/logger.ts';
import type { AssistantStatus } from './core/types.ts';
import { AppDatabase } from './database/db.ts';
import { MessageRepository } from './database/message-repository.ts';
import { NoteRepository } from './database/note-repository.ts';
import { ExpenseRepository } from './database/expense-repository.ts';
import { ReminderRepository } from './database/reminder-repository.ts';
import { ReminderScheduler } from './scheduler/reminder-scheduler.ts';
import { DisabledTransport } from './transports/disabled.ts';
import type { MessageTransport } from './transports/types.ts';
import { BaileysWhatsAppTransport } from './transports/whatsapp/baileys-transport.ts';

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const messages = new MessageRepository(database);
const notes = new NoteRepository(database);
const expenses = new ExpenseRepository(database);
const reminders = new ReminderRepository(database);

let transport: MessageTransport;
if (config.whatsapp.enabled) {
  transport = new BaileysWhatsAppTransport(config.whatsapp, database, messages);
} else {
  transport = new DisabledTransport();
}

const capabilities = new LocalCapabilities(notes, reminders, expenses, config.timeZone);
const core = new AssistantCore(transport, messages, capabilities);
const reminderScheduler = new ReminderScheduler(reminders, transport);
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
  reminderScheduler.start();
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

  reminderScheduler.stop();
  await transport.disconnect().catch(() => undefined);
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
