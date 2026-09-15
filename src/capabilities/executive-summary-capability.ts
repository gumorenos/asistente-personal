import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { ExecutiveSummaryService } from '../executive/executive-summary-service.ts';
import type { ExecutiveSummaryConfig } from '../executive/summary-config.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class ExecutiveSummaryCapability implements Capability {
  readonly name = 'executive-summary';

  private readonly service: ExecutiveSummaryService;
  private readonly audit: AuditRepository;
  private readonly config: ExecutiveSummaryConfig;

  constructor(service: ExecutiveSummaryService, audit: AuditRepository, config: ExecutiveSummaryConfig) {
    this.service = service;
    this.audit = audit;
    this.config = config;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = fold(message.text);
    if (!['resumen ejecutivo', 'panel ejecutivo'].includes(command)) return undefined;

    if (!this.config.enabled) {
      return {
        handled: true,
        reply: '🧭 El resumen ejecutivo está deshabilitado.',
        replyPersistence: 'ephemeral',
      };
    }

    try {
      const result = await this.service.render();
      this.audit.record({
        eventType: 'executive.summary.rendered',
        entityType: 'executive_summary',
        metadata: {
          openCommitments: result.local.openCommitments,
          overdueCommitments: result.local.overdueCommitments,
          pendingReminders: result.local.pendingReminders,
          calendarStatus: result.calendar.status,
          calendarReturned: result.calendar.returned,
          gmailStatus: result.gmail.status,
          gmailReturned: result.gmail.returned,
          gmailUnread: result.gmail.unread,
        },
      });
      return { handled: true, reply: result.text, replyPersistence: 'ephemeral' };
    } catch (error) {
      this.audit.record({
        eventType: 'executive.summary.failed',
        entityType: 'executive_summary',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return {
        handled: true,
        reply: '⚠️ No pude generar el resumen ejecutivo en este momento.',
        replyPersistence: 'ephemeral',
      };
    }
  }
}
