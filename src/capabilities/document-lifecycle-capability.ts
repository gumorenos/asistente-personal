import type { IncomingMessage } from '../core/types.ts';
import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentRepository } from '../database/document-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

const PROPOSAL_TTL_MS = 15 * 60_000;

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export class DocumentLifecycleCapability implements Capability {
  readonly name = 'document-lifecycle';

  private readonly documents: DocumentRepository;
  private readonly actions: ActionRequestRepository;
  private readonly audit: AuditRepository;
  private readonly now: () => Date;

  constructor(
    documents: DocumentRepository,
    actions: ActionRequestRepository,
    audit: AuditRepository,
    now: () => Date = () => new Date(),
  ) {
    this.documents = documents;
    this.actions = actions;
    this.audit = audit;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    if (message.kind !== 'text') return undefined;
    const match = fold(message.text.trim()).match(/^(?:borra|borrar|elimina|eliminar)\s+documento\s+#?(\d+)$/);
    if (!match?.[1]) return undefined;

    const documentId = Number(match[1]);
    if (!Number.isSafeInteger(documentId) || documentId < 1 || !this.documents.get(documentId)) {
      return { handled: true, reply: `No encontré el documento #${match[1]}. No se creó ninguna acción.` };
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString();
    const actionId = this.actions.create({
      actionType: 'document.delete',
      summary: `Eliminar documento #${documentId} del almacenamiento local`,
      payload: { documentId },
      expiresAt,
    });
    this.audit.record({
      eventType: 'document.delete.proposed',
      entityType: 'action_request',
      entityId: String(actionId),
      metadata: { documentId },
    });

    return {
      handled: true,
      reply: [
        `🔐 Borrado del documento #${documentId} propuesto como acción #${actionId}.`,
        'Todavía NO se borró nada.',
        `Usa “aprueba acción #${actionId}” y luego “ejecuta acción #${actionId}”. La propuesta vence en 15 minutos.`,
      ].join('\n'),
    };
  }
}
