import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { ExecutivePrioritiesService } from '../executive/executive-priorities-service.ts';
import type { ExecutivePrioritiesConfig } from '../executive/priorities-config.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class ExecutivePrioritiesCapability implements Capability {
  readonly name = 'executive-priorities';

  private readonly service: ExecutivePrioritiesService;
  private readonly audit: AuditRepository;
  private readonly config: ExecutivePrioritiesConfig;

  constructor(service: ExecutivePrioritiesService, audit: AuditRepository, config: ExecutivePrioritiesConfig) {
    this.service = service;
    this.audit = audit;
    this.config = config;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = fold(message.text);
    if (!['prioridades', 'prioridades hoy', 'que priorizo hoy'].includes(command)) return undefined;

    if (!this.config.enabled) {
      return {
        handled: true,
        reply: '🎯 Las prioridades ejecutivas están deshabilitadas.',
        replyPersistence: 'ephemeral',
      };
    }

    try {
      const result = await this.service.render();
      this.audit.record({
        eventType: 'executive.priorities.rendered',
        entityType: 'executive_priorities',
        metadata: {
          actionsNow: result.actions.now,
          actionsToday: result.actions.today,
          actionsReturned: result.actions.returned,
          calendarStatus: result.calendar.status,
          calendarReturned: result.calendar.returned,
          gmailStatus: result.gmail.status,
          gmailUnreadReturned: result.gmail.unreadReturned,
        },
      });
      return { handled: true, reply: result.text, replyPersistence: 'ephemeral' };
    } catch (error) {
      this.audit.record({
        eventType: 'executive.priorities.failed',
        entityType: 'executive_priorities',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return {
        handled: true,
        reply: '⚠️ No pude generar las prioridades en este momento.',
        replyPersistence: 'ephemeral',
      };
    }
  }
}
