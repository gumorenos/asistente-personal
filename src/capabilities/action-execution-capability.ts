import type { CalendarExecutionResult } from '../calendar/calendar-action-executor.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { DocumentDeleteExecutionResult } from '../documents/document-action-executor.ts';
import type { Capability, CapabilityResult } from './types.ts';

export interface CalendarExecutionService {
  execute(actionId: number): Promise<CalendarExecutionResult>;
}

export interface DocumentExecutionService {
  execute(actionId: number): Promise<DocumentDeleteExecutionResult>;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export class ActionExecutionCapability implements Capability {
  readonly name = 'action-execution';

  private readonly actions: ActionRequestRepository;
  private readonly calendarEnabled: boolean;
  private readonly calendarExecutor?: CalendarExecutionService;
  private readonly documentExecutor: DocumentExecutionService;

  constructor(
    actions: ActionRequestRepository,
    calendarEnabled: boolean,
    calendarExecutor: CalendarExecutionService | undefined,
    documentExecutor: DocumentExecutionService,
  ) {
    this.actions = actions;
    this.calendarEnabled = calendarEnabled;
    this.calendarExecutor = calendarExecutor;
    this.documentExecutor = documentExecutor;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = fold(message.text.trim()).match(/^(?:ejecuta|ejecutar)\s+accion\s+#?(\d+)$/);
    if (!match?.[1]) return undefined;
    const actionId = Number(match[1]);
    const action = this.actions.getById(actionId);
    if (!action || action.status !== 'approved') {
      return { handled: true, reply: `🔐 Acción #${actionId} no está aprobada. No se ejecutó.` };
    }

    if (action.actionType === 'document.delete') {
      const result = await this.documentExecutor.execute(actionId);
      return { handled: true, reply: renderDocumentResult(actionId, result) };
    }

    if (action.actionType === 'calendar.create_event') {
      if (!this.calendarEnabled || !this.calendarExecutor) {
        return { handled: true, reply: '📅 Los writes de Calendar están deshabilitados. No se ejecutó ninguna acción externa.' };
      }
      const result = await this.calendarExecutor.execute(actionId);
      return { handled: true, reply: renderCalendarResult(actionId, result) };
    }

    return { handled: true, reply: `⚠️ Acción #${actionId} no tiene un executor soportado.` };
  }
}

function renderDocumentResult(actionId: number, result: DocumentDeleteExecutionResult): string {
  switch (result.status) {
    case 'executed':
      return result.alreadyAbsent
        ? `🗑️ Acción #${actionId} aplicada: el documento #${result.documentId} ya no existía; el estado final queda confirmado sin duplicar efectos.`
        : `🗑️ Acción #${actionId} ejecutada: documento #${result.documentId} eliminado del almacenamiento local y del índice de búsqueda.`;
    case 'already_executed':
      return `🗑️ Acción #${actionId} ya había sido ejecutada; no se repitió el borrado.`;
    case 'in_progress':
      return `⏳ Acción #${actionId} ya tiene una ejecución reciente en curso. No inicié otra.`;
    case 'not_approved':
      return `🔐 Acción #${actionId} no está aprobada. No se ejecutó.`;
    case 'unsupported_action':
      return `⚠️ Acción #${actionId} no es un borrado documental soportado.`;
    case 'invalid_payload':
      return `⚠️ Acción #${actionId} venció o ya no contiene un identificador documental válido. No se ejecutó.`;
    case 'failed':
      return `⚠️ Falló el borrado de la acción #${actionId}. El ledger conserva el estado para un retry idempotente.`;
  }
}

function renderCalendarResult(actionId: number, result: CalendarExecutionResult): string {
  switch (result.status) {
    case 'executed':
      return `📅 Acción #${actionId} ejecutada: evento creado en Google Calendar.`;
    case 'already_executed':
      return `📅 Acción #${actionId} ya había sido ejecutada; no se creó un duplicado.`;
    case 'in_progress':
      return `⏳ Acción #${actionId} ya tiene una ejecución reciente en curso. No inicié otra.`;
    case 'not_approved':
      return `🔐 Acción #${actionId} no está aprobada. No se ejecutó.`;
    case 'unsupported_action':
      return `⚠️ Acción #${actionId} no es un tipo Calendar soportado.`;
    case 'invalid_payload':
      return `⚠️ Acción #${actionId} ya no contiene un evento futuro válido. No se ejecutó.`;
    case 'failed':
      return `⚠️ Falló la ejecución de la acción #${actionId}. El ledger conserva el estado para un retry idempotente.`;
  }
}
