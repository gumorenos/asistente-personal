import { createHealthServer } from './api/health.ts';
import { OpenAICompatibleProvider } from './ai/openai-compatible-provider.ts';
import type { AiProvider } from './ai/types.ts';
import { BriefingService } from './briefing/briefing-service.ts';
import { CalendarActionExecutor } from './calendar/calendar-action-executor.ts';
import { GoogleCalendarProvider } from './calendar/google-calendar-provider.ts';
import { GoogleOAuthAccessTokenProvider } from './calendar/google-oauth-token-provider.ts';
import { ActionApprovalCapability } from './capabilities/action-approval-capability.ts';
import { ActionExecutionCapability } from './capabilities/action-execution-capability.ts';
import { AiCapability } from './capabilities/ai-capability.ts';
import { AudioTranscriptionCapability } from './capabilities/audio-transcription-capability.ts';
import { BriefingCapability } from './capabilities/briefing-capability.ts';
import { CalendarProposalCapability } from './capabilities/calendar-proposal-capability.ts';
import { DocumentCapability } from './capabilities/document-capability.ts';
import { DocumentLifecycleCapability } from './capabilities/document-lifecycle-capability.ts';
import { LocalCapabilities } from './capabilities/local-capabilities.ts';
import { MemorySearchCapability } from './capabilities/memory-search-capability.ts';
import { ObserverAdminCapability } from './capabilities/observer-admin-capability.ts';
import { ObserverReadCapability } from './capabilities/observer-read-capability.ts';
import { ObserverSearchCapability } from './capabilities/observer-search-capability.ts';
import { SemanticDocumentCapability } from './capabilities/semantic-document-capability.ts';
import type { Capability } from './capabilities/types.ts';
import { loadConfig } from './config.ts';
import { AssistantCore } from './core/assistant.ts';
import { logger } from './core/logger.ts';
import type { AssistantStatus } from './core/types.ts';
import { ActionExecutionRepository } from './database/action-execution-repository.ts';
import { ActionRequestRepository } from './database/action-request-repository.ts';
import { AuditRepository } from './database/audit-repository.ts';
import { BriefingDeliveryRepository } from './database/briefing-delivery-repository.ts';
import { AppDatabase } from './database/db.ts';
import { DocumentRepository } from './database/document-repository.ts';
import { DocumentSemanticRepository } from './database/document-semantic-repository.ts';
import { ExpenseRepository } from './database/expense-repository.ts';
import { LocalMemorySearchRepository } from './database/local-memory-search-repository.ts';
import { MessageRepository } from './database/message-repository.ts';
import { NoteRepository } from './database/note-repository.ts';
import { ObservedChatRepository } from './database/observed-chat-repository.ts';
import { ReminderRepository } from './database/reminder-repository.ts';
import { RetentionRepository } from './database/retention-repository.ts';
import { DocumentActionExecutor } from './documents/document-action-executor.ts';
import { HybridPdfExtractor } from './documents/hybrid-pdf-extractor.ts';
import { PopplerPdfExtractor } from './documents/poppler-pdf-extractor.ts';
import { TesseractPdfOcrExtractor } from './documents/tesseract-pdf-ocr-extractor.ts';
import type { DocumentExtractor } from './documents/types.ts';
import { ObserverService } from './observer/observer-service.ts';
import { SqliteObservationSink } from './observer/sqlite-observation-sink.ts';
import { BriefingScheduler } from './scheduler/briefing-scheduler.ts';
import { DocumentRetentionScheduler } from './scheduler/document-retention-scheduler.ts';
import { ObserverRetentionScheduler } from './scheduler/observer-retention-scheduler.ts';
import { ReminderScheduler } from './scheduler/reminder-scheduler.ts';
import { RetentionScheduler } from './scheduler/retention-scheduler.ts';
import { DocumentSemanticService } from './semantic/document-semantic-service.ts';
import { HybridDocumentSearchService } from './semantic/hybrid-document-search-service.ts';
import { OpenAICompatibleEmbeddingProvider } from './semantic/openai-compatible-embedding-provider.ts';
import type { EmbeddingProvider } from './semantic/types.ts';
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
const documents = new DocumentRepository(database);
const documentSemanticRepository = new DocumentSemanticRepository(database);
const audit = new AuditRepository(database);
const actions = new ActionRequestRepository(database);
const actionExecutions = new ActionExecutionRepository(database);
const documentActionExecutor = new DocumentActionExecutor(actions, actionExecutions, documents, audit);
const briefingDeliveries = new BriefingDeliveryRepository(database);
const observedChats = new ObservedChatRepository(database);
const observationSink = new SqliteObservationSink(database);
const observerService = new ObserverService(observedChats, observationSink);
const retention = new RetentionRepository(database);
const memorySearch = new LocalMemorySearchRepository(database);
const briefingService = new BriefingService(notes, reminders, expenses, actions, config.timeZone);

let transport: MessageTransport;
if (config.whatsapp.enabled) {
  transport = new BaileysWhatsAppTransport(
    config.whatsapp,
    database,
    messages,
    config.observer.enabled
      ? async (message) => { await observerService.observe(message); }
      : undefined,
  );
} else {
  transport = new DisabledTransport();
}

let aiProvider: AiProvider | undefined;
if (config.ai.enabled) {
  aiProvider = new OpenAICompatibleProvider({
    baseUrl: config.ai.baseUrl!, apiKey: config.ai.apiKey, model: config.ai.model!,
    timeoutMs: config.ai.timeoutMs, maxOutputTokens: config.ai.maxOutputTokens,
  });
}

let transcriptionProvider: TranscriptionProvider | undefined;
if (config.transcription.enabled) {
  transcriptionProvider = new OpenAICompatibleTranscriptionProvider({
    baseUrl: config.transcription.baseUrl!, apiKey: config.transcription.apiKey,
    model: config.transcription.model!, timeoutMs: config.transcription.timeoutMs,
  });
}

let documentExtractor: DocumentExtractor | undefined;
if (config.documents.enabled) {
  const poppler = new PopplerPdfExtractor();
  const ocr = config.documents.ocr.enabled
    ? new TesseractPdfOcrExtractor({
        maxPages: config.documents.ocr.maxPages,
        dpi: config.documents.ocr.dpi,
        languages: config.documents.ocr.languages,
      })
    : undefined;
  documentExtractor = new HybridPdfExtractor(poppler, ocr, {
    ocrTimeoutMs: config.documents.ocr.timeoutMs,
  });
}

let embeddingProvider: EmbeddingProvider | undefined;
if (config.semantic.embeddings.enabled) {
  embeddingProvider = new OpenAICompatibleEmbeddingProvider({
    baseUrl: config.semantic.embeddings.baseUrl!,
    apiKey: config.semantic.embeddings.apiKey,
    model: config.semantic.embeddings.model!,
    dimensions: config.semantic.embeddings.dimensions,
    timeoutMs: config.semantic.embeddings.timeoutMs,
  });
}

const semanticService = new DocumentSemanticService(
  documents,
  documentSemanticRepository,
  audit,
  embeddingProvider,
  {
    enabled: config.semantic.enabled,
    maxChars: config.semantic.chunkMaxChars,
    overlapChars: config.semantic.chunkOverlapChars,
    maxChunks: config.semantic.maxChunks,
    embeddingBatchSize: config.semantic.embeddings.batchSize,
  },
);
const hybridDocumentSearch = new HybridDocumentSearchService(memorySearch, semanticService);

let calendarExecutor: CalendarActionExecutor | undefined;
if (config.calendar.enabled) {
  const tokenProvider = new GoogleOAuthAccessTokenProvider({
    clientId: config.calendar.clientId!,
    clientSecret: config.calendar.clientSecret!,
    refreshToken: config.calendar.refreshToken!,
    timeoutMs: config.calendar.timeoutMs,
  });
  const calendarProvider = new GoogleCalendarProvider({
    calendarId: config.calendar.calendarId,
    timeoutMs: config.calendar.timeoutMs,
  }, tokenProvider);
  calendarExecutor = new CalendarActionExecutor(actions, actionExecutions, audit, calendarProvider);
}

let briefingScheduler: BriefingScheduler | undefined;
if (config.briefing.enabled) {
  briefingScheduler = new BriefingScheduler(
    briefingService,
    briefingDeliveries,
    transport,
    audit,
    config.briefing.destinationJid!,
    config.timeZone,
    { hour: config.briefing.hour, minute: config.briefing.minute },
  );
}

let retentionScheduler: RetentionScheduler | undefined;
if (config.retention.enabled) {
  retentionScheduler = new RetentionScheduler(retention, audit, {
    messageDays: config.retention.messageDays,
    outboundDays: config.retention.outboundDays,
    auditDays: config.retention.auditDays,
    briefingDays: config.retention.briefingDays,
  });
}

let documentRetentionScheduler: DocumentRetentionScheduler | undefined;
if (config.documents.retention.enabled) {
  documentRetentionScheduler = new DocumentRetentionScheduler(documents, audit, config.documents.retention.days);
}

let observerRetentionScheduler: ObserverRetentionScheduler | undefined;
if (config.observer.enabled) {
  observerRetentionScheduler = new ObserverRetentionScheduler(observationSink, audit);
}

const capabilities: Capability[] = [
  // Document messages are terminal before local command parsing. A PDF caption can
  // never be interpreted as `anota`, `agenda`, etc., including after OCR.
  new DocumentCapability(documents, audit, documentExtractor, {
    enabled: config.documents.enabled,
    maxBytes: config.documents.maxBytes,
    maxPages: config.documents.maxPages,
    maxTextChars: config.documents.maxTextChars,
    timeoutMs: config.documents.timeoutMs,
  }, semanticService),
  new DocumentLifecycleCapability(documents, actions, audit),
  // Semantic/hybrid commands must run before generic `busca ...` FTS parsing.
  new SemanticDocumentCapability(documents, semanticService, audit, hybridDocumentSearch),
  new LocalCapabilities(notes, reminders, expenses, audit, config.timeZone),
  new BriefingCapability(briefingService),
  new ObserverAdminCapability(observedChats, audit, config.observer.enabled),
  new ObserverSearchCapability(observedChats, observationSink, audit, config.timeZone),
  new ObserverReadCapability(observedChats, observationSink, audit, config.timeZone),
  new MemorySearchCapability(memorySearch, audit, config.timeZone),
  new CalendarProposalCapability(actions, audit, config.timeZone),
  new ActionApprovalCapability(actions, audit),
  new ActionExecutionCapability(actions, config.calendar.enabled, calendarExecutor, documentActionExecutor),
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

// These jobs are transport-independent and can run even if WhatsApp is degraded.
retentionScheduler?.start();
documentRetentionScheduler?.start();
observerRetentionScheduler?.start();

try {
  await transport.connect();
  reminderScheduler.start();
  briefingScheduler?.start();
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
    documentsEnabled: config.documents.enabled,
    documentExtractor: config.documents.enabled ? documentExtractor?.name : 'disabled',
    documentOcrEnabled: config.documents.ocr.enabled,
    documentOcrLanguages: config.documents.ocr.enabled ? config.documents.ocr.languages : undefined,
    documentRetentionEnabled: config.documents.retention.enabled,
    documentRetentionDays: config.documents.retention.enabled ? config.documents.retention.days : undefined,
    semanticEnabled: config.semantic.enabled,
    embeddingsEnabled: config.semantic.embeddings.enabled,
    embeddingsProvider: config.semantic.embeddings.enabled ? config.semantic.embeddings.provider : 'disabled',
    embeddingsDimensions: config.semantic.embeddings.enabled ? config.semantic.embeddings.dimensions : undefined,
    calendarWritesEnabled: config.calendar.enabled,
    calendarProvider: config.calendar.enabled ? config.calendar.provider : 'disabled',
    dailyBriefingEnabled: config.briefing.enabled,
    dailyBriefingTime: `${String(config.briefing.hour).padStart(2, '0')}:${String(config.briefing.minute).padStart(2, '0')}`,
    observerEnabled: config.observer.enabled,
    observedChatAllowlistCount: observedChats.listEnabled().length,
    observerStorage: config.observer.enabled ? 'sqlite-text-only' : 'disabled',
    localMemorySearch: 'sqlite-fts5-explicit-only',
    observerSearch: 'sqlite-fts5-exact-jid-explicit-only',
    retentionEnabled: config.retention.enabled,
    retentionPolicy: config.retention.enabled ? {
      messageDays: config.retention.messageDays,
      outboundDays: config.retention.outboundDays,
      auditDays: config.retention.auditDays,
      briefingDays: config.retention.briefingDays,
    } : undefined,
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
  observerRetentionScheduler?.stop();
  documentRetentionScheduler?.stop();
  retentionScheduler?.stop();
  briefingScheduler?.stop();
  reminderScheduler.stop();
  await transport.disconnect().catch(() => undefined);
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void shutdown(signal).finally(() => process.exit(0)); });
}
