import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentQaService } from '../document-qa/document-qa-service.ts';
import type { Capability, CapabilityResult } from './types.ts';

export class DocumentQaCapability implements Capability {
  readonly name = 'document-qa';

  private readonly service: DocumentQaService | undefined;
  private readonly audit: AuditRepository;
  private readonly enabled: boolean;
  private readonly maxQuestionChars: number;

  constructor(
    service: DocumentQaService | undefined,
    audit: AuditRepository,
    enabled: boolean,
    maxQuestionChars: number,
  ) {
    this.service = service;
    this.audit = audit;
    this.enabled = enabled;
    this.maxQuestionChars = maxQuestionChars;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    if (message.kind !== 'text') return undefined;
    const match = message.text.trim().match(/^(?:pregunta|preguntar)\s+documentos?\s+(.+)$/i);
    if (!match?.[1]) return undefined;

    const question = match[1].trim();
    if (!this.enabled || !this.service) {
      return {
        handled: true,
        reply: '📚 Q&A documental está deshabilitado. No se envió contenido a IA ni embeddings.',
      };
    }
    if (!question || question.length > this.maxQuestionChars) {
      return { handled: true, reply: '⚠️ La pregunta documental supera el límite configurado o está vacía.' };
    }

    try {
      const result = await this.service.answer(question);
      if (!result) return { handled: true, reply: '📚 Q&A documental está deshabilitado.' };
      this.audit.record({
        eventType: 'document.qa.answered',
        entityType: 'document',
        metadata: {
          questionChars: question.length,
          sources: result.sourceDocumentIds.length,
          contextChars: result.contextChars,
          replyChars: result.text.length,
        },
      });
      return { handled: true, reply: result.text };
    } catch (error) {
      this.audit.record({
        eventType: 'document.qa.failed',
        entityType: 'document',
        metadata: {
          questionChars: question.length,
          errorType: error instanceof Error ? error.name : 'unknown',
        },
      });
      return {
        handled: true,
        reply: '⚠️ No pude responder con los documentos. No se ejecutó ninguna acción y no se reutilizó la respuesta como comando.',
      };
    }
  }
}
