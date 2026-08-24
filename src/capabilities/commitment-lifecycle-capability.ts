import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { CommitmentRepository } from '../database/commitment-repository.ts';
import { parseReminder } from './parsers.ts';
import { localPeriodRange } from './time-utils.ts';
import type { Capability, CapabilityResult } from './types.ts';

const MAX_COMMAND_CHARS = 2_000;
const MAX_ITEM_CHARS = 320;
const MAX_REPLY_CHARS = 3_500;
const RESCHEDULE_SENTINEL = '__commitment_reschedule__';

export class CommitmentLifecycleCapability implements Capability {
  readonly name = 'commitment-lifecycle';

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
    const text = message.text.trim();
    if (!text) return undefined;

    const reschedule = this.parseReschedule(text);
    if (reschedule) return this.handleReschedule(reschedule.id, reschedule.schedule);

    const normalized = text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');

    if (['compromisos hoy', 'mis compromisos hoy'].includes(normalized)) {
      const range = localPeriodRange(this.now(), this.timeZone, 'day');
      return {
        handled: true,
        reply: this.renderList(
          this.commitments.listOpenDueBetween(range.startIso, range.endIso, 10),
          '🤝 Compromisos de hoy',
        ),
      };
    }

    if (['compromisos semana', 'compromisos esta semana', 'mis compromisos semana', 'mis compromisos esta semana'].includes(normalized)) {
      const range = localPeriodRange(this.now(), this.timeZone, 'week');
      return {
        handled: true,
        reply: this.renderList(
          this.commitments.listOpenDueBetween(range.startIso, range.endIso, 10),
          '🤝 Compromisos de esta semana',
        ),
      };
    }

    if (['compromisos sin fecha', 'mis compromisos sin fecha'].includes(normalized)) {
      return {
        handled: true,
        reply: this.renderList(this.commitments.listOpenUndated(10), '🤝 Compromisos sin fecha'),
      };
    }

    return undefined;
  }

  private handleReschedule(id: number, schedule: string): CapabilityResult {
    if (schedule.length > MAX_COMMAND_CHARS) {
      return { handled: true, reply: '⚠️ La nueva fecha/hora es demasiado larga.' };
    }

    const parsed = parseReminder(`recuérdame ${schedule} ${RESCHEDULE_SENTINEL}`, this.now(), this.timeZone);
    if (!parsed || parsed.invalidSchedule || !parsed.dueAt || parsed.body !== RESCHEDULE_SENTINEL) {
      return { handled: true, reply: '⚠️ No pude interpretar una nueva fecha/hora futura válida.' };
    }

    const result = this.commitments.reschedule(id, parsed.dueAt);
    if (result.reason === 'unchanged') {
      return {
        handled: true,
        reply: `🤝 Compromiso #${id} ya estaba programado para ${this.formatDate(parsed.dueAt)}.`,
      };
    }
    if (!result.changed) {
      return { handled: true, reply: `No encontré un compromiso abierto #${id} para reprogramar.` };
    }

    this.audit.record({
      eventType: 'commitment.rescheduled',
      entityType: 'commitment',
      entityId: String(id),
      metadata: {
        hadPreviousDueAt: result.hadPreviousDueAt,
        notificationReset: result.notificationReset,
      },
    });

    return {
      handled: true,
      reply: `🤝 Compromiso #${id} reprogramado para ${this.formatDate(parsed.dueAt)}.`,
    };
  }

  private parseReschedule(text: string): { id: number; schedule: string } | undefined {
    const match = text.trim().match(
      /^(?:reprograma|reprogramar|mueve|mover)\s+(?:el\s+)?compromiso\s+#?(\d+)\s+(.+)$/i,
    );
    if (!match?.[1] || !match[2]) return undefined;
    return { id: Number(match[1]), schedule: match[2].trim() };
  }

  private renderList(rows: ReturnType<CommitmentRepository['listOpen']>, title: string): string {
    if (rows.length === 0) return `${title}: ninguno.`;

    const lines = [`${title}:`];
    for (const row of rows) {
      const body = this.compactBody(row.body);
      const line = `• #${row.id} ${body}${row.dueAt ? ` — ${this.formatDate(row.dueAt)}` : ' — sin vencimiento'}`;
      if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
      lines.push(line);
    }
    return lines.join('\n').slice(0, MAX_REPLY_CHARS);
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
