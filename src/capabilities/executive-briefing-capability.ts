import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { ExecutiveBriefingConfig } from '../executive/briefing-config.ts';
import type { ExecutiveBriefingService } from '../executive/executive-briefing-service.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[?!¡¿.,;:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export class ExecutiveBriefingCapability implements Capability {
  readonly name = 'executive-briefing';
  constructor(private readonly service: ExecutiveBriefingService, private readonly audit: AuditRepository, private readonly config: ExecutiveBriefingConfig) {}

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = fold(message.text);
    if (!['que tengo hoy', 'dame mi briefing', 'briefing ejecutivo'].includes(command)) return undefined;
    if (!this.config.enabled) return { handled: true, reply: '☀️ El briefing ejecutivo está deshabilitado.', replyPersistence: 'ephemeral' };
    try {
      const result = await this.service.render();
      this.audit.record({ eventType: 'executive.briefing.rendered', entityType: 'executive_briefing', metadata: {
        overdueActions: result.actions.overdue, todayActions: result.actions.today, actionsReturned: result.actions.returned,
        calendarStatus: result.calendar.status, calendarReturned: result.calendar.returned,
        gmailStatus: result.gmail.status, gmailUnreadReturned: result.gmail.unreadReturned,
      } });
      return { handled: true, reply: result.text, replyPersistence: 'ephemeral' };
    } catch (error) {
      this.audit.record({ eventType: 'executive.briefing.failed', entityType: 'executive_briefing', metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' } });
      return { handled: true, reply: '⚠️ No pude generar el briefing ejecutivo en este momento.', replyPersistence: 'ephemeral' };
    }
  }
}
