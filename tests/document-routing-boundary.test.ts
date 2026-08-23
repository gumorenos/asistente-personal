import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentCapability } from '../src/capabilities/document-capability.ts';
import { LocalCapabilities } from '../src/capabilities/local-capabilities.ts';
import { AssistantCore } from '../src/core/assistant.ts';
import type { IncomingMessage, SendTextResult } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { DocumentRepository } from '../src/database/document-repository.ts';
import { ExpenseRepository } from '../src/database/expense-repository.ts';
import { MessageRepository } from '../src/database/message-repository.ts';
import { NoteRepository } from '../src/database/note-repository.ts';
import { ReminderRepository } from '../src/database/reminder-repository.ts';
import type { DocumentExtractor } from '../src/documents/types.ts';
import type { IncomingMessageHandler, MessageTransport } from '../src/transports/types.ts';

const SELF_JID = '51911111111@s.whatsapp.net';

class CaptureTransport implements MessageTransport {
  readonly name = 'capture';
  replies: Array<{ destination: string; text: string }> = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(_handler: IncomingMessageHandler): void {}
  getState(): string { return 'open'; }
  async sendText(destination: string, text: string): Promise<SendTextResult> {
    this.replies.push({ destination, text });
    return { messageId: `out-${this.replies.length}` };
  }
}

const extractor: DocumentExtractor = {
  name: 'fake',
  async extractPdf() {
    return { text: 'Contenido inocuo extraído del PDF.', pageCount: 1, truncated: false };
  },
};

function pdfMessage(): IncomingMessage {
  const data = new TextEncoder().encode('%PDF-1.7\nfixture');
  return {
    id: 'pdf-caption-command',
    chatId: SELF_JID,
    senderId: SELF_JID,
    timestamp: 1_777_000_000,
    text: 'anota esto NO debe convertirse en nota',
    kind: 'document',
    fromMe: true,
    isGroup: false,
    mediaSizeBytes: data.byteLength,
    mediaMimeType: 'application/pdf',
    mediaFileName: 'caption-command.pdf',
    loadMedia: async () => ({ data, mimeType: 'application/pdf', fileName: 'caption-command.pdf' }),
  };
}

test('DocumentCapability before LocalCapabilities makes document captions terminal', async () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const documents = new DocumentRepository(db);
  const notes = new NoteRepository(db);
  const reminders = new ReminderRepository(db);
  const expenses = new ExpenseRepository(db);
  const audit = new AuditRepository(db);
  const transport = new CaptureTransport();

  const core = new AssistantCore(transport, messages, [
    new DocumentCapability(documents, audit, extractor, {
      enabled: true,
      maxBytes: 1024,
      maxPages: 10,
      maxTextChars: 10_000,
      timeoutMs: 5_000,
    }),
    new LocalCapabilities(notes, reminders, expenses, audit, 'America/Lima'),
  ]);

  await core.handleIncoming(pdfMessage());

  assert.equal(documents.listRecent().length, 1);
  assert.equal(notes.listActive(10).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0]?.text ?? '', /Documento #1 indexado localmente/);
  assert.doesNotMatch(transport.replies[0]?.text ?? '', /Nota #/);
  db.close();
});

test('disabled document ingestion is still terminal and cannot fall through to local commands', async () => {
  const db = new AppDatabase(':memory:');
  const messages = new MessageRepository(db);
  const documents = new DocumentRepository(db);
  const notes = new NoteRepository(db);
  const reminders = new ReminderRepository(db);
  const expenses = new ExpenseRepository(db);
  const audit = new AuditRepository(db);
  const transport = new CaptureTransport();

  const core = new AssistantCore(transport, messages, [
    new DocumentCapability(documents, audit, undefined, {
      enabled: false,
      maxBytes: 1024,
      maxPages: 10,
      maxTextChars: 10_000,
      timeoutMs: 5_000,
    }),
    new LocalCapabilities(notes, reminders, expenses, audit, 'America/Lima'),
  ]);

  await core.handleIncoming(pdfMessage());

  assert.equal(documents.listRecent().length, 0);
  assert.equal(notes.listActive(10).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0]?.text ?? '', /deshabilitada/);
  db.close();
});
