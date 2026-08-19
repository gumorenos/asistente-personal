import type { ActionExecutionRepository } from '../database/action-execution-repository.ts';
import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { CalendarCreateEventInput, CalendarProvider } from './types.ts';

export type CalendarExecutionResult =
  | { status: 'executed'; externalId: string }
  | { status: 'already_executed'; externalId?: string }
  | { status: 'in_progress' }
  | { status: 'not_approved' }
  | { status: 'unsupported_action' }
  | { status: 'invalid_payload' }
  | { status: 'failed' };

export class CalendarActionExecutor {
  private readonly actions: ActionRequestRepository;
  private readonly executions: ActionExecutionRepository;
  private readonly audit: AuditRepository;
  private readonly provider: CalendarProvider;
  private readonly now: () => Date;

  constructor(
    actions: ActionRequestRepository,
    executions: ActionExecutionRepository,
    audit: AuditRepository,
    provider: CalendarProvider,
    now: () => Date = () => new Date(),
  ) {
    this.actions = actions;
    this.executions = executions;
    this.audit = audit;
    this.provider = provider;
    this.now = now;
  }

  async execute(actionId: number): Promise<CalendarExecutionResult> {
    const action = this.actions.getById(actionId);
    if (!action || action.status !== 'approved') return { status: 'not_approved' };
    if (action.actionType !== 'calendar.create_event') return { status: 'unsupported_action' };

    const input = parseCalendarPayload(action.payload, this.now());
    if (!input) return { status: 'invalid_payload' };

    const idempotencyKey = `calendar-create-action-${action.id}`;
    let begin;
    try {
      begin = this.executions.beginApproved(action.id, this.provider.name, idempotencyKey, this.now().toISOString());
    } catch {
      return { status: 'failed' };
    }

    if (begin.state === 'already_succeeded') {
      return { status: 'already_executed', externalId: begin.record.externalId };
    }
    if (begin.state === 'already_started') return { status: 'in_progress' };

    this.audit.record({
      eventType: 'calendar.execution.started',
      entityType: 'action_request',
      entityId: String(action.id),
      metadata: { provider: this.provider.name, attempt: begin.record.attemptCount },
    });

    try {
      const result = await this.provider.createEvent(input, idempotencyKey);
      const completedAt = this.now().toISOString();
      if (!this.executions.markSucceeded(action.id, result.externalId, completedAt)) {
        throw new Error('Execution state changed before success could be persisted');
      }
      this.audit.record({
        eventType: 'calendar.execution.succeeded',
        entityType: 'action_request',
        entityId: String(action.id),
        metadata: { provider: this.provider.name, attempt: begin.record.attemptCount },
      });
      return { status: 'executed', externalId: result.externalId };
    } catch (error) {
      const completedAt = this.now().toISOString();
      const errorCode = error instanceof Error ? error.name : 'UnknownError';
      this.executions.markFailed(action.id, errorCode, completedAt);
      this.audit.record({
        eventType: 'calendar.execution.failed',
        entityType: 'action_request',
        entityId: String(action.id),
        metadata: { provider: this.provider.name, attempt: begin.record.attemptCount, errorCode },
      });
      return { status: 'failed' };
    }
  }
}

function parseCalendarPayload(payload: Record<string, unknown>, now: Date): CalendarCreateEventInput | undefined {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const startAt = typeof payload.startAt === 'string' ? payload.startAt : '';
  const durationMinutes = payload.durationMinutes;
  const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone.trim() : '';

  if (!title || title.length > 200) return undefined;
  if (!Number.isInteger(durationMinutes) || (durationMinutes as number) < 5 || (durationMinutes as number) > 480) return undefined;
  const start = new Date(startAt);
  if (!Number.isFinite(start.getTime()) || start.getTime() <= now.getTime()) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(start);
  } catch {
    return undefined;
  }

  return { title, startAt: start.toISOString(), durationMinutes: durationMinutes as number, timeZone };
}
