import type { IncomingMessage } from '../core/types.ts';
import type { CommitmentRepository } from '../database/commitment-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { CommitmentLifecycleCapability } from './commitment-lifecycle-capability.ts';
import { foldText, parseReminder } from './parsers.ts';
import type { Capability, CapabilityResult } from './types.ts';

const MAX_COMMAND_CHARS = 2_000;

export class CommitmentCapability implements Capability {
  readonly name = 'commitments';

  private readonly commitments: CommitmentRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;
  private readonly lifecycle: CommitmentLifecycleCapability;

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
    this.lifecycle = new CommitmentLifecycleCapability(commitments, audit, timeZone, now);
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = message.text.trim();
    if (!text) return undefined;

    const lifecycleResult = await this.lifecycle.handle(message);
    if (lifecycleResult) return lifecycleResult;

    const status = this.parseStatus(text);
    if (status) {
      const changed = this.commitments.setStatus(status.id, status.status);
      if (changed) {
        this.audit.record({
          eventType: `commitment.${status.status}`,
          entityType: 'commitment',
          entityId: String(status.id),
        });
      }
      return {
        handled: true,
        reply: changed
          ? `🤝 Compromiso #${status.id} ${status.status === 'completed' ? 'completado' : 'cancelado'}.`
          : `No encontré un compromiso abierto #${status.id}.`,
      };
    }

    const folded = foldText(text);
    if (['compromisos', 'mis compromisos', 'compromisos pendientes'].includes(folded)) {
      return { handled: true, reply: this.renderList(this.commitments.listOpen(10), '🤝 Compromisos abiertos') };
    }
    if (['compromisos vencidos', 'mis compromisos vencidos'].includes(folded)) {
      return {
        handled: true,
        reply: this.renderList(this.commitments.listOverdue(this.now().toISOString(), 10), '⚠️ Compromisos vencidos'),
      };
    }

    const createBody = this.parseCreatePrefix(text);
    if (createBody === undefined) return undefined;
    if (!createBody || text.length > MAX_COMMAND_CHARS) {
      return { handled: true, reply: '⚠️ El compromiso está vacío o es demasiado largo y no fue guardado.' };
    }

    const parsed = parseReminder(`recuérdame ${createBody}`, this.now(), this.timeZone);
    if (!parsed || parsed.invalidSchedule) {
      return { handled: true, reply: '⚠️ No pude interpretar una fecha/hora futura válida. No guardé el compromiso.' };
    }
    if (!parsed.body.trim()) {
      return { handled: true, reply: '⚠️ El compromiso necesita una descripción.' };
    }

    const id = this.commitments.create({ body: parsed.body, dueAt: parsed.dueAt });
    this.audit.record({
      eventType: 'commitment.created',
      entityType: 'commitment',
      entityId: String(id),
      metadata: { hasDueAt: Boolean(parsed.dueAt) },
    });

    return parsed.dueAt
      ? {
          handled: true,
          reply: `🤝 Compromiso #${id} guardado para ${this.formatDate(parsed.dueAt)}: ${parsed.body}`,
        }
      : {
          handled: true,
          reply: `🤝 Compromiso #${id} guardado sin vencimiento: ${parsed.body}`,
        };
  }

  private parseCreatePrefix(text: string): string | undefined {
    const trimmed = text.trim();
    if (/^(?:compromiso|me\s+comprometo\s+a|promet[ií])$/i.test(trimmed)) return '';
    const match = trimmed.match(/^(?:compromiso|me\s+comprometo\s+a|promet[ií])\s+(.+)$/i);
    return match?.[1]?.trim();
  }

  private parseStatus(text: string): { id: number; status: 'completed' | 'cancelled' } | undefined {
    const folded = foldText(text);
    let match = folded.match(/^(?:completa|completar|cumpli|cumplido)\s+(?:el\s+)?compromiso\s+#?(\d+)$/);
    if (match?.[1]) return { id: Number(match[1]), status: 'completed' };
    match = folded.match(/^(?:cancela|cancelar)\s+(?:el\s+)?compromiso\s+#?(\d+)$/);
    if (match?.[1]) return { id: Number(match[1]), status: 'cancelled' };
    return undefined;
  }

  private renderList(rows: ReturnType<CommitmentRepository['listOpen']>, title: string): string {
    if (rows.length === 0) return `${title}: ninguno.`;
    return [
      `${title}:`,
      ...rows.map((row) => `• #${row.id} ${row.body}${row.dueAt ? ` — ${this.formatDate(row.dueAt)}` : ' — sin vencimiento'}`),
    ].join('\n');
  }

  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }
}
