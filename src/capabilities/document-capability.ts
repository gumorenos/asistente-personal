import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentRepository } from '../database/document-repository.ts';
import type { DocumentExtractor } from '../documents/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

export interface DocumentCapabilityConfig {
  enabled: boolean;
  maxBytes: number;
  maxPages: number;
  maxTextChars: number;
  timeoutMs: number;
}

const MAX_PREVIEW_CHARS = 1_500;

function safeFileName(value: string | undefined, messageId: string): string {
  const raw = value?.trim() || `document-${messageId}.pdf`;
  const leaf = raw.replace(/\\/g, '/').split('/').pop() || `document-${messageId}.pdf`;
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || `document-${messageId}.pdf`).slice(0, 255);
}

function isPdfMagic(data: Uint8Array): boolean {
  return data.byteLength >= 5 && String.fromCharCode(...data.slice(0, 5)) === '%PDF-';
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export class DocumentCapability implements Capability {
  readonly name = 'documents';

  private readonly documents: DocumentRepository;
  private readonly audit: AuditRepository;
  private readonly extractor?: DocumentExtractor;
  private readonly config: DocumentCapabilityConfig;

  constructor(
    documents: DocumentRepository,
    audit: AuditRepository,
    extractor: DocumentExtractor | undefined,
    config: DocumentCapabilityConfig,
  ) {
    this.documents = documents;
    this.audit = audit;
    this.extractor = extractor;
    this.config = config;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    if (message.kind === 'document') return this.handleDocument(message);
    if (message.kind !== 'text') return undefined;

    const text = message.text.trim();
    if (/^(?:documentos|mis documentos)$/i.test(text)) {
      const rows = this.documents.listRecent(10);
      return {
        handled: true,
        reply: rows.length
          ? [
              '📄 Documentos recientes:',
              ...rows.map((row) => `• #${row.id} ${row.fileName} — ${row.pageCount} pág. · ${row.text.length} caracteres${row.truncated ? ' · truncado' : ''}`),
            ].join('\n')
          : '📄 No tienes documentos indexados.',
      };
    }

    const match = text.match(/^documento\s+#?(\d+)$/i);
    if (match?.[1]) {
      const row = this.documents.get(Number(match[1]));
      if (!row) return { handled: true, reply: `No encontré el documento #${match[1]}.` };
      const preview = compact(row.text).slice(0, MAX_PREVIEW_CHARS);
      return {
        handled: true,
        reply: [
          `📄 Documento #${row.id}: ${row.fileName}`,
          `${row.pageCount} pág. · ${row.byteLength} bytes · ${row.text.length} caracteres${row.truncated ? ' · texto truncado al límite local' : ''}`,
          '',
          preview || '(sin texto legible)',
          row.text.length > MAX_PREVIEW_CHARS ? '…' : '',
        ].filter(Boolean).join('\n'),
      };
    }

    return undefined;
  }

  private async handleDocument(message: IncomingMessage): Promise<CapabilityResult> {
    if (!this.config.enabled || !this.extractor) {
      return {
        handled: true,
        reply: '📄 Recibí un documento, pero la indexación de PDFs está deshabilitada.',
      };
    }

    if (message.mediaSizeBytes !== undefined && message.mediaSizeBytes > this.config.maxBytes) {
      this.audit.record({
        eventType: 'document.ingest.rejected',
        entityType: 'document',
        metadata: { reason: 'declared_size_limit', inputBytes: message.mediaSizeBytes },
      });
      return {
        handled: true,
        reply: `⚠️ El documento supera el límite de ${this.config.maxBytes} bytes y no fue descargado.`,
      };
    }

    const declaredMime = message.mediaMimeType?.trim().toLowerCase();
    if (declaredMime && declaredMime !== 'application/pdf') {
      return { handled: true, reply: '📄 La memoria documental admite únicamente archivos PDF.' };
    }

    if (!message.loadMedia) {
      return { handled: true, reply: '⚠️ No pude acceder al documento de WhatsApp para indexarlo.' };
    }

    let media;
    try {
      media = await message.loadMedia();
    } catch (error) {
      this.audit.record({
        eventType: 'document.media_load.failed',
        entityType: 'document',
        metadata: { errorType: error instanceof Error ? error.name : 'unknown' },
      });
      return { handled: true, reply: '⚠️ No pude descargar el documento de WhatsApp.' };
    }

    if (media.data.byteLength === 0) return { handled: true, reply: '⚠️ El documento recibido está vacío.' };
    if (media.data.byteLength > this.config.maxBytes) {
      this.audit.record({
        eventType: 'document.ingest.rejected',
        entityType: 'document',
        metadata: { reason: 'actual_size_limit', inputBytes: media.data.byteLength },
      });
      return { handled: true, reply: `⚠️ El documento supera el límite de ${this.config.maxBytes} bytes y no fue procesado.` };
    }

    const mimeType = media.mimeType?.trim().toLowerCase() || declaredMime || 'application/octet-stream';
    if (mimeType !== 'application/pdf' || !isPdfMagic(media.data)) {
      this.audit.record({
        eventType: 'document.ingest.rejected',
        entityType: 'document',
        metadata: { reason: 'not_pdf', inputBytes: media.data.byteLength },
      });
      return { handled: true, reply: '⚠️ El archivo no parece ser un PDF válido y no fue procesado.' };
    }

    const fileName = safeFileName(media.fileName ?? message.mediaFileName, message.id);
    this.audit.record({
      eventType: 'document.ingest.started',
      entityType: 'document',
      metadata: { extractor: this.extractor.name, inputBytes: media.data.byteLength, mimeType },
    });

    try {
      const extracted = await this.extractor.extractPdf({
        data: media.data,
        maxPages: this.config.maxPages,
        maxTextChars: this.config.maxTextChars,
        timeoutMs: this.config.timeoutMs,
      });
      const text = extracted.text.trim();
      const method = extracted.method ?? 'text-layer';
      if (!text) {
        this.audit.record({
          eventType: 'document.ingest.rejected',
          entityType: 'document',
          metadata: {
            reason: method === 'ocr' ? 'ocr_no_text' : 'no_text_layer',
            pages: extracted.pageCount,
            method,
          },
        });
        return {
          handled: true,
          reply: method === 'ocr'
            ? '📄 El OCR local no encontró texto legible. No guardé el documento ni ejecuté ninguna acción.'
            : '📄 El PDF no contiene texto extraíble. No lo guardé; habilita OCR local para intentar leer documentos escaneados.',
        };
      }

      const sha256 = createHash('sha256').update(media.data).digest('hex');
      const stored = this.documents.save({
        messageId: message.id,
        receivedAt: message.timestamp,
        fileName,
        mimeType,
        sha256,
        byteLength: media.data.byteLength,
        pageCount: extracted.pageCount,
        text,
        truncated: extracted.truncated,
      });

      this.audit.record({
        eventType: 'document.ingest.succeeded',
        entityType: 'document',
        entityId: String(stored.id),
        metadata: {
          extractor: this.extractor.name,
          method,
          inputBytes: stored.byteLength,
          pages: stored.pageCount,
          outputChars: stored.text.length,
          truncated: stored.truncated,
        },
      });
      const methodLabel = method === 'ocr' ? ' mediante OCR local' : '';
      return {
        handled: true,
        reply: `📄 Documento #${stored.id} indexado localmente${methodLabel}: ${stored.pageCount} pág. · ${stored.text.length} caracteres${stored.truncated ? ' · truncado al límite configurado' : ''}. Usa “busca documentos <texto>” para consultarlo.`,
      };
    } catch (error) {
      this.audit.record({
        eventType: 'document.ingest.failed',
        entityType: 'document',
        metadata: { extractor: this.extractor.name, errorType: error instanceof Error ? error.name : 'unknown' },
      });
      return {
        handled: true,
        reply: '⚠️ No pude extraer texto del PDF. No se ejecutó ninguna acción a partir de su contenido.',
      };
    }
  }
}
