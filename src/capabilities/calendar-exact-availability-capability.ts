import type { CalendarExactAvailabilityConfig } from '../calendar/exact-availability-config.ts';
import type { CalendarReadService } from '../calendar/calendar-read-service.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { parseReminder } from './parsers.ts';
import type { Capability, CapabilityResult } from './types.ts';

function formatInterval(startAt: string, endAt: string, timeZone: string): string {
  const date = new Intl.DateTimeFormat('es-PE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(startAt));
  const time = (value: string) => new Intl.DateTimeFormat('es-PE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
  return `${date}, ${time(startAt)}–${time(endAt)}`;
}

export class CalendarExactAvailabilityCapability implements Capability {
  readonly name = 'calendar-exact-availability';

  private readonly service: CalendarReadService | undefined;
  private readonly audit: AuditRepository;
  private readonly config: CalendarExactAvailabilityConfig;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    service: CalendarReadService | undefined,
    audit: AuditRepository,
    config: CalendarExactAvailabilityConfig,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.service = service;
    this.audit = audit;
    this.config = config;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(
      /^¿?(?:(?:estoy|tengo)\s+)?libre\s+(.+?)\s+(?:por|durante)\s+(\d{1,3})\s+minutos?\??$/i,
    );
    if (!match?.[1] || !match[2]) return undefined;

    const durationMinutes = Number(match[2]);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      return { handled: true, reply: '⚠️ La duración debe estar entre 5 y 480 minutos.' };
    }

    const parsed = parseReminder(`recuérdame ${match[1]} comprobar disponibilidad`, this.now(), this.timeZone);
    if (!parsed?.dueAt || parsed.invalidSchedule) {
      return {
        handled: true,
        reply: '📅 No pude obtener una fecha/hora futura válida. No consulté Calendar.',
      };
    }

    if (!this.config.enabled || !this.service) {
      return { handled: true, reply: '📅 La comprobación exacta de disponibilidad está deshabilitada.' };
    }

    try {
      const result = await this.service.exactAvailability(parsed.dueAt, durationMinutes);
      this.audit.record({
        eventType: 'calendar.exact_availability',
        entityType: 'calendar',
        metadata: {
          durationMinutes,
          isFree: result.isFree,
          conflictCount: result.busyIntervals.length,
        },
      });

      const interval = formatInterval(result.range.startAt, result.range.endAt, this.timeZone);
      return result.isFree
        ? { handled: true, reply: `📅 Sí. Estás libre el ${interval}. No se creó ninguna acción ni evento.` }
        : { handled: true, reply: `📅 No. El intervalo ${interval} aparece ocupado. No se creó ninguna acción ni evento.` };
    } catch (error) {
      this.audit.record({
        eventType: 'calendar.exact_availability.failed',
        entityType: 'calendar',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { handled: true, reply: '⚠️ No pude comprobar esa disponibilidad en este momento.' };
    }
  }
}
