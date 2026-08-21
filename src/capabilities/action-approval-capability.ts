import type { IncomingMessage } from '../core/types.ts';
import type { ActionDecision, ActionRequestRepository } from '../database/action-request-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function parseDecision(text: string): { id: number; decision: ActionDecision } | undefined {
  const normalized = fold(text.trim());
  const match = normalized.match(/^(aprueba|aprobar|rechaza|rechazar)\s+accion\s+#?(\d+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { id: Number(match[2]), decision: match[1].startsWith('apr') ? 'approved' : 'rejected' };
}

export class ActionApprovalCapability implements Capability {
  readonly name = 'action-approval';

  private readonly actions: ActionRequestRepository;
  private readonly audit: AuditRepository;
  private readonly now: () => Date;

  constructor(actions: ActionRequestRepository, audit: AuditRepository, now: () => Date = () => new Date()) {
    this.actions = actions;
    this.audit = audit;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const normalized = fold(message.text.trim());
    const nowIso = this.now().toISOString();
    if (['acciones', 'acciones pendientes', 'mis acciones'].includes(normalized)) {
      const rows = this.actions.listPending(nowIso, 10);
      return {
        handled: true,
        reply: rows.length
          ? [
              '🔐 Acciones pendientes de aprobación:',
              ...rows.map((row) => `• #${row.id} [${row.actionType}] ${row.summary}`),
              '',
              'Usa “aprueba acción #N” o “rechaza acción #N”. Aprobar NO ejecuta la acción en esta etapa.',
            ].join('\n')
          : '🔐 No hay acciones pendientes de aprobación.',
      };
    }

    const decision = parseDecision(message.text);
    if (!decision) return undefined;

    const action = this.actions.decide(decision.id, decision.decision, nowIso);
    if (!action) return { handled: true, reply: `No encontré una acción pendiente y vigente #${decision.id}.` };

    this.audit.record({
      eventType: `action.${decision.decision}`,
      entityType: 'action_request',
      entityId: String(action.id),
      metadata: { actionType: action.actionType },
    });

    if (decision.decision === 'approved') {
      return {
        handled: true,
        reply: `✅ Acción #${action.id} aprobada. Quedó autorizada localmente, pero NO fue ejecutada: esta etapa todavía no tiene executor externo.`,
      };
    }
    return { handled: true, reply: `🚫 Acción #${action.id} rechazada.` };
  }
}
