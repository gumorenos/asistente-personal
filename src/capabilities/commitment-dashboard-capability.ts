import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { CommitmentRecord, CommitmentRepository } from '../database/commitment-repository.ts';
import { foldText } from './parsers.ts';
import { localPeriodRange } from './time-utils.ts';
import type { Capability, CapabilityResult } from './types.ts';

const MAX_ITEM_CHARS = 240;
const MAX_REPLY_CHARS = 3_500;
const PRIORITY_LIMIT = 3;

export class CommitmentDashboardCapability implements Capability {
  readonly name = 'commitment-dashboard';

  private readonly commitments: CommitmentRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    commitments: CommitmentRepository,
    audit: AuditRepository,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.commitments = commitments;
    this.audit = audit;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = foldText(message.text).replace(/\s+/g, ' ');
    if (!['resumen compromisos', 'estado compromisos', 'panel compromisos'].includes(command)) return undefined;

    const now = this.now();
    const nowIso = now.toISOString();
    const day = localPeriodRange(now, this.timeZone, 'day');
    const week = localPeriodRange(now, this.timeZone, 'week');
    const summary = this.commitments.summarizeOpen(nowIso, day.endIso, week.endIso);
    const overdue = this.commitments.listOverdue(nowIso, PRIORITY_LIMIT);
    const upcoming = this.commitments.listOpenUpcoming(nowIso, PRIORITY_LIMIT);

    this.audit.record({
      eventType: 'commitment.summary',
      entityType: 'commitment',
      metadata: {
        total: summary.total,
        overdue: summary.overdue,
        today: summary.today,
        thisWeek: summary.thisWeek,
        later: summary.later,
        undated: summary.undated,
        overdueShown: overdue.length,
        upcomingShown: upcoming.length,
      },
    });

    const lines = [
      '🤝 Resumen de compromisos',
      `• Abiertos: ${summary.total}`,
      `• ⚠️ Vencidos: ${summary.overdue}`,
      `• Hoy, aún por vencer: ${summary.today}`,
      `• Resto de esta semana: ${summary.thisWeek}`,
      `• Posteriores: ${summary.later}`,
      `• Sin fecha: ${summary.undated}`,
    ];

    if (summary.total === 0) {
      lines.push('', '✅ No tienes compromisos abiertos.');
      return { handled: true, reply: lines.join('\n') };
    }

    if (overdue.length > 0) {
      lines.push('', '⚠️ Prioridad vencida');
      for (const row of overdue) this.pushBounded(lines, this.formatItem(row));
    }

    if (upcoming.length > 0) {
      lines.push('', '➡️ Próximos vencimientos');
      for (const row of upcoming) this.pushBounded(lines, this.formatItem(row));
    }

    if (summary.undated > 0) {
      lines.push('', `💡 ${summary.undated} compromiso${summary.undated === 1 ? '' : 's'} sin fecha. Usa “compromisos sin fecha” para revisarlo${summary.undated === 1 ? '' : 's'}.`);
    }

    return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
  }

  private pushBounded(lines: string[], line: string): void {
    if ([...lines, line].join('\n').length <= MAX_REPLY_CHARS) lines.push(line);
  }

  private formatItem(row: CommitmentRecord): string {
    const body = this.compactBody(row.body);
    const due = row.dueAt ? this.formatDate(row.dueAt) : 'sin vencimiento';
    return `• #${row.id} ${body} — ${due}`;
  }

  private compactBody(body: string): string {
    const compact = body.replace(/\s+/g, ' ').trim();
    return compact.length <= MAX_ITEM_CHARS ? compact : `${compact.slice(0, MAX_ITEM_CHARS - 1)}…`;
  }

  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }
}
