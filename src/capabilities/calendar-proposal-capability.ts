import type { IncomingMessage } from '../core/types.ts';
import type { ActionRequestRepository } from '../database/action-request-repository.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { foldText, parseReminder } from './parsers.ts';
import type { Capability, CapabilityResult } from './types.ts';

interface CalendarProposal {
  title: string;
  startAt: string;
  durationMinutes: number;
}

function parseDuration(body: string): { title: string; durationMinutes: number } | undefined {
  const match = body.match(/^(.+?)\s+(?:durante|por)\s+(\d{1,3})\s*(min(?:uto)?s?|h(?:ora)?s?)$/i);
  if (!match?.[1] || !match[2] || !match[3]) return { title: body.trim(), durationMinutes: 60 };

  const amount = Number(match[2]);
  const unit = foldText(match[3]);
  const durationMinutes = unit.startsWith('h') ? amount * 60 : amount;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) return undefined;
  return { title: match[1].trim(), durationMinutes };
}

export class CalendarProposalCapability implements Capability {
  readonly name = 'calendar-proposal';

  private readonly actions: ActionRequestRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    actions: ActionRequestRepository,
    audit: AuditRepository,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.actions = actions;
    this.audit = audit;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(/^(?:agenda|agendar)\s+(.+)$/i);
    if (!match?.[1]) return undefined;

    const parsed = parseReminder(`recuérdame ${match[1]}`, this.now(), this.timeZone);
    if (!parsed || parsed.invalidSchedule || !parsed.dueAt) {
      return {
        handled: true,
        reply: '📅 No pude obtener una fecha/hora futura válida. No creé ninguna propuesta de Calendar.',
      };
    }

    const duration = parseDuration(parsed.body);
    if (!duration || !duration.title || duration.title.length > 200) {
      return {
        handled: true,
        reply: '📅 El título o duración no son válidos. Usa entre 5 minutos y 8 horas.',
      };
    }

    const proposal: CalendarProposal = {
      title: duration.title,
      startAt: parsed.dueAt,
      durationMinutes: duration.durationMinutes,
    };
    const localStart = new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(proposal.startAt));
    const summary = `Crear “${proposal.title}” — ${localStart} (${proposal.durationMinutes} min)`;

    const id = this.actions.create({
      actionType: 'calendar.create_event',
      summary,
      payload: { ...proposal, timeZone: this.timeZone },
      expiresAt: proposal.startAt,
    });
    this.audit.record({
      eventType: 'calendar.proposal.created',
      entityType: 'action_request',
      entityId: String(id),
      metadata: { actionType: 'calendar.create_event', startAt: proposal.startAt, durationMinutes: proposal.durationMinutes },
    });

    return {
      handled: true,
      reply: [
        `📅 Propuesta #${id}: ${summary}`,
        'No se creó nada en Google Calendar.',
        `Usa “aprueba acción #${id}” o “rechaza acción #${id}”. Incluso aprobada, todavía no se ejecuta en esta etapa.`,
      ].join('\n'),
    };
  }
}
