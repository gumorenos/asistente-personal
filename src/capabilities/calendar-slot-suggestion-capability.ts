import type { CalendarSlotSuggestionService } from '../calendar/calendar-slot-suggestion-service.ts';
import type { CalendarSlotSuggestionConfig } from '../calendar/slot-suggestion-config.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

function normalizePeriod(value: string): 'today' | 'tomorrow' | undefined {
  const normalized = value.toLocaleLowerCase('es-PE').trim();
  if (normalized === 'hoy') return 'today';
  if (normalized === 'mañana' || normalized === 'manana') return 'tomorrow';
  return undefined;
}

function formatLocal(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function periodLabel(period: 'today' | 'tomorrow'): string {
  return period === 'today' ? 'hoy' : 'mañana';
}

export class CalendarSlotSuggestionCapability implements Capability {
  readonly name = 'calendar-slot-suggestions';

  private readonly service: CalendarSlotSuggestionService | undefined;
  private readonly audit: AuditRepository;
  private readonly config: CalendarSlotSuggestionConfig;
  private readonly timeZone: string;

  constructor(
    service: CalendarSlotSuggestionService | undefined,
    audit: AuditRepository,
    config: CalendarSlotSuggestionConfig,
    timeZone: string,
  ) {
    this.service = service;
    this.audit = audit;
    this.config = config;
    this.timeZone = timeZone;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(
      /^(?:prop[oó]n|sugiere)\s+horarios\s+(hoy|mañana|manana)\s+para\s+(\d{1,3})\s+minutos?$/i,
    );
    if (!match?.[1] || !match[2]) return undefined;

    const period = normalizePeriod(match[1]);
    const durationMinutes = Number(match[2]);
    if (!period) return { handled: true, reply: '⚠️ Periodo inválido.' };
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      return { handled: true, reply: '⚠️ La duración debe estar entre 15 y 240 minutos.' };
    }
    if (durationMinutes % this.config.alignmentMinutes !== 0) {
      return {
        handled: true,
        reply: `⚠️ La duración debe ser múltiplo de ${this.config.alignmentMinutes} minutos.`,
      };
    }

    if (!this.config.enabled || !this.service) {
      return { handled: true, reply: '📅 Las sugerencias de horarios están deshabilitadas.' };
    }

    try {
      const result = await this.service.suggest(period, durationMinutes);
      this.audit.record({
        eventType: 'calendar.slot_suggestions',
        entityType: 'calendar',
        metadata: {
          period,
          durationMinutes,
          returned: result.suggestions.length,
          windowElapsed: result.windowElapsed,
        },
      });

      if (result.windowElapsed) {
        return { handled: true, reply: `📅 La ventana de disponibilidad de ${periodLabel(period)} ya terminó.` };
      }
      if (result.suggestions.length === 0) {
        return {
          handled: true,
          reply: `📅 No encontré huecos de ${durationMinutes} min ${periodLabel(period)} dentro de la ventana configurada.`,
        };
      }

      const lines = [
        `📅 Opciones ${periodLabel(period)} · ${durationMinutes} min`,
        ...result.suggestions.map((slot, index) =>
          `${index + 1}. ${formatLocal(slot.startAt, this.timeZone)}–${formatLocal(slot.endAt, this.timeZone)}`),
        '',
        'Solo son sugerencias: no se creó ninguna acción ni evento.',
      ];
      return { handled: true, reply: lines.join('\n').slice(0, this.config.maxReplyChars) };
    } catch (error) {
      this.audit.record({
        eventType: 'calendar.slot_suggestions.failed',
        entityType: 'calendar',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { handled: true, reply: '⚠️ No pude calcular sugerencias de horario en este momento.' };
    }
  }
}
