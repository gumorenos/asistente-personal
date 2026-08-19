import { createHealthServer } from './api/health.ts';
import { OpenAICompatibleProvider } from './ai/openai-compatible-provider.ts';
import type { AiProvider } from './ai/types.ts';
import { AiCapability } from './capabilities/ai-capability.ts';
import { AudioTranscriptionCapability } from './capabilities/audio-transcription-capability.ts';
import { LocalCapabilities } from './capabilities/local-capabilities.ts';
import type { Capability } from './capabilities/types.ts';
import { loadConfig } from './config.ts';
import { AssistantCore } from './core/assistant.ts';
import { logger } from './core/logger.ts';
import type { AssistantStatus } from './core/types.ts';
import { AuditRepository } from './database/audit-repository.ts';
import { AppDatabase } from './database/db.ts';
import { ExpenseRepository } from './database/expense-repository.ts';
import { MessageRepository } from './database/message-repository.ts';
import { NoteRepository } from './database/note-repository.ts';
import { ReminderRepository } from './database/reminder-repository.ts';
import { ReminderScheduler } from './scheduler/reminder-scheduler.ts';
import { OpenAICompatibleTranscriptionProvider } from './transcription/openai-compatible-provider.ts';
import type { TranscriptionProvider } from './transcription/types.ts';
import { DisabledTransport } from './transports/disabled.ts';
import type { MessageTransport } from './transports/types.ts';
import { BaileysWhatsAppTransport } from './transports/whatsapp/baileys-transport.ts';

const config = loadConfig();
const database = new AppDatabase(config.dbPath);
const messages = new MessageRepository(database);
const notes = new NoteRepository(database);
const expenses = new ExpenseRepository(database);
const reminders = new ReminderRepository(database);
const audit = new AuditRepository(database);

let transport: MessageTransport;
if (config.whatsapp.enabled) transport = new BaileysWhatsAppTransport(config.whatsapp, database, messages);
else transport = new DisabledTransport();

let aiProvider: AiProvider | undefined;
if (config.ai.enabled) {
  aiProvider = new OpenAICompatibleProvider({
    baseUrl: config.ai.baseUrl!,
    apiKey: config.ai.apiKey,
    model: config.ai.model!,
    timeoutMs: config.ai.timeoutMs,
    maxOutputTokens: config.ai.maxOutputTokens,
  });
}

let transcriptionProvider: TranscriptionProvider | undefined;
if (config.transcription.enabled) {
  transcriptionProvider = new OpenAICompatibleTranscriptionProvider({
    baseUrl: config.transcription.baseUrl!,
    apiKey: config.transcription.apiKey,
    model: config.transcription.model!,
    timeoutMs: config.transcription.timeoutMs,
  });
}

const capabilities: Capability[] = [
  new LocalCapabilities(notes, reminders, expenses, audit, config.timeZone),
  new AudioTranscriptionCapability(transcriptionProvider, audit, {
    enabled: config.transcription.enabled,
    maxBytes: config.transcription.maxBytes,
    maxTranscriptChars: config.transcription.maxTranscriptChars,
  }),
  new AiCapability(aiProvider, audit, {
    enabled: config.ai.enabled,
    maxInputChars: config.ai.maxInputChars,
    maxReplyChars: config.ai.maxReplyChars,
  }),
];
const core = new AssistantCore(transport, messages, capabilities);
const reminderScheduler = new ReminderScheduler(reminders, transport, () => new Date(), audit);
transport.onMessage((message) => core.handleIncoming(message));

let appState: AssistantStatus['state'] = 'starting';
const healthServer = await createHealthServer(config.healthHost, config.healthPort, {
  isDatabaseReady: () => database.ping(),
  getAssistantStatus: () => ({ state: appState, transport: transport.name, transportState: transport.getState() }),
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
    aiEnabled: config.ai.enabled,
    aiProvider: config.ai.enabled ? config.ai.provider : 'disabled',
    transcriptionEnabled: config.transcription.enabled,
    transcriptionProvider: config.transcription.enabled ? config.transcription.provider : 'disabled',
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
  process.on(signal, () => { void shutdown(signal).finally(() => process.exit(0)); });
}
