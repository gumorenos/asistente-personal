import type { CalendarExecutionResult } from '../calendar/calendar-action-executor.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

export interface CalendarExecutionService {
  execute(actionId: number): Promise<CalendarExecutionResult>;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export class CalendarExecutionCapability implements Capability {
  readonly name = 'calendar-execution';

  private readonly enabled: boolean;
  private readonly executor?: CalendarExecutionService;

  constructor(enabled: boolean, executor?: CalendarExecutionService) {
    this.enabled = enabled;
    this.executor = executor;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = fold(message.text.trim()).match(/^(?:ejecuta|ejecutar)\s+accion\s+#?(\d+)$/);
    if (!match?.[1]) return undefined;
    const actionId = Number(match[1]);

    if (!this.enabled || !this.executor) {
      return {
        handled: true,
        reply: '📅 Los writes de Calendar están deshabilitados. No se ejecutó ninguna acción externa.',
      };
    }

    const result = await this.executor.execute(actionId);
    return { handled: true, reply: renderExecutionResult(actionId, result) };
  }
}

function renderExecutionResult(actionId: number, result: CalendarExecutionResult): string {
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
