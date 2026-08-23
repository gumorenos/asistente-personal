import type { ActionExecutionRepository } from '../database/action-execution-repository.ts';
import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentRepository } from '../database/document-repository.ts';

const EXECUTION_LEASE_MS = 5 * 60_000;
const PROVIDER = 'local-document-store';

export type DocumentDeleteExecutionResult =
  | { status: 'executed'; documentId: number; alreadyAbsent: boolean; walCheckpointed: boolean }
  | { status: 'already_executed'; documentId?: number }
  | { status: 'in_progress' }
  | { status: 'not_approved' }
  | { status: 'unsupported_action' }
  | { status: 'invalid_payload' }
  | { status: 'failed' };

export class DocumentActionExecutor {
  private readonly actions: ActionRequestRepository;
  private readonly executions: ActionExecutionRepository;
  private readonly documents: DocumentRepository;
  private readonly audit: AuditRepository;
  private readonly now: () => Date;

  constructor(
    actions: ActionRequestRepository,
    executions: ActionExecutionRepository,
    documents: DocumentRepository,
    audit: AuditRepository,
    now: () => Date = () => new Date(),
  ) {
    this.actions = actions;
    this.executions = executions;
    this.documents = documents;
    this.audit = audit;
    this.now = now;
  }

  async execute(actionId: number): Promise<DocumentDeleteExecutionResult> {
    const action = this.actions.getById(actionId);
    if (!action || action.status !== 'approved') return { status: 'not_approved' };
    if (action.actionType !== 'document.delete') return { status: 'unsupported_action' };

    const documentId = parseDocumentId(action.payload);
    const executionNow = this.now();
    if (!documentId || (action.expiresAt && new Date(action.expiresAt).getTime() <= executionNow.getTime())) {
      return { status: 'invalid_payload' };
    }

    const idempotencyKey = `document-delete-action-${action.id}`;
    const startedAt = executionNow.toISOString();
    const staleBeforeIso = new Date(executionNow.getTime() - EXECUTION_LEASE_MS).toISOString();
    let begin;
    try {
      begin = this.executions.beginApproved(action.id, PROVIDER, idempotencyKey, startedAt, staleBeforeIso);
    } catch {
      return { status: 'failed' };
    }

    if (begin.state === 'already_succeeded') {
      return { status: 'already_executed', documentId };
    }
    if (begin.state === 'already_started') return { status: 'in_progress' };

    this.audit.record({
      eventType: 'document.delete.execution.started',
      entityType: 'action_request',
      entityId: String(action.id),
      metadata: { documentId, provider: PROVIDER, attempt: begin.record.attemptCount },
    });

    try {
      // An already-absent document is a successful idempotent end state. This also
      // recovers the crash window where deletion committed before ledger success.
      const result = this.documents.delete(documentId);
      const completedAt = this.now().toISOString();
      if (!this.executions.markSucceeded(action.id, `document:${documentId}`, completedAt)) {
        throw new Error('Execution state changed before document deletion could be persisted');
      }
      this.audit.record({
        eventType: 'document.delete.execution.succeeded',
        entityType: 'action_request',
        entityId: String(action.id),
        metadata: {
          documentId,
          provider: PROVIDER,
          attempt: begin.record.attemptCount,
          alreadyAbsent: !result.deleted,
          walCheckpointed: result.walCheckpointed,
        },
      });
      return {
        status: 'executed',
        documentId,
        alreadyAbsent: !result.deleted,
        walCheckpointed: result.walCheckpointed,
      };
    } catch (error) {
      const completedAt = this.now().toISOString();
      const errorCode = error instanceof Error ? error.name : 'UnknownError';
      this.executions.markFailed(action.id, errorCode, completedAt);
      this.audit.record({
        eventType: 'document.delete.execution.failed',
        entityType: 'action_request',
        entityId: String(action.id),
        metadata: { documentId, provider: PROVIDER, attempt: begin.record.attemptCount, errorCode },
      });
      return { status: 'failed' };
    }
  }
}

function parseDocumentId(payload: Record<string, unknown>): number | undefined {
  const value = payload.documentId;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
