import type { CalendarReadService, CalendarAgendaResult, CalendarAvailabilityResult } from '../calendar/calendar-read-service.ts';
import type { CalendarReadConfig } from '../calendar/read-config.ts';
import type { CalendarReadEvent, CalendarReadPeriod } from '../calendar/read-types.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

function normalizePeriod(value: string): CalendarReadPeriod | undefined {
  const normalized = value.toLocaleLowerCase('es-PE').replace(/\s+/g, ' ').trim();
  if (normalized === 'hoy') return 'today';
  if (normalized === 'mañana' || normalized === 'manana') return 'tomorrow';
  if (normalized === 'semana' || normalized === 'esta semana') return 'week';
  return undefined;
}

function compact(text: string, maxChars = 180): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function periodLabel(period: CalendarReadPeriod): string {
  if (period === 'today') return 'hoy';
  if (period === 'tomorrow') return 'mañana';
  return 'esta semana';
}

function formatDateTime(value: string, timeZone: string, includeDate: boolean): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    ...(includeDate ? { weekday: 'short', day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function formatEvent(event: CalendarReadEvent, timeZone: string, includeDate: boolean): string {
  if (event.startDate && event.endDate) {
    return `• ${includeDate ? `${event.startDate} · ` : ''}Todo el día — ${compact(event.title)}`;
  }
  if (event.startDateTime && event.endDateTime) {
    const start = formatDateTime(event.startDateTime, timeZone, includeDate);
    const end = formatDateTime(event.endDateTime, timeZone, false);
    return `• ${start}–${end} — ${compact(event.title)}`;
  }
  return `• Hora desconocida — ${compact(event.title)}`;
}

function durationLabel(startAt: string, endAt: string): string {
  const minutes = Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function boundedLines(lines: string[], maxChars: number): string {
  const output: string[] = [];
  for (const line of lines) {
    if ([...output, line].join('\n').length > maxChars) {
      const marker = '… salida truncada';
      if ([...output, marker].join('\n').length <= maxChars) output.push(marker);
      break;
    }
    output.push(line);
  }
  return output.join('\n').slice(0, maxChars);
}

export class CalendarReadCapability implements Capability {
  readonly name = 'calendar-read';

  private readonly service: CalendarReadService | undefined;
  private readonly audit: AuditRepository;
  private readonly config: CalendarReadConfig;
  private readonly timeZone: string;

  constructor(
    service: CalendarReadService | undefined,
    audit: AuditRepository,
    config: CalendarReadConfig,
    timeZone: string,
  ) {
    this.service = service;
    this.audit = audit;
    this.config = config;
    this.timeZone = timeZone;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = message.text.trim();
    const agendaMatch = text.match(/^(?:agenda|calendario)\s+(hoy|mañana|manana|semana|esta\s+semana)$/i);
    const availabilityMatch = text.match(/^(?:disponibilidad|libre)\s+(hoy|mañana|manana)$/i);
    if (!agendaMatch && !availabilityMatch) return undefined;

    if (!this.config.enabled || !this.service) {
      return { handled: true, reply: '📅 La lectura de Google Calendar está deshabilitada.' };
    }

    try {
      if (agendaMatch?.[1]) {
        const period = normalizePeriod(agendaMatch[1]);
        if (!period) return { handled: true, reply: '⚠️ Periodo de agenda inválido.' };
        const result = await this.service.agenda(period);
        this.auditAgenda(result);
        return { handled: true, reply: this.renderAgenda(result) };
      }

      const period = availabilityMatch?.[1] ? normalizePeriod(availabilityMatch[1]) : undefined;
      if (period !== 'today' && period !== 'tomorrow') {
        return { handled: true, reply: '⚠️ Usa `disponibilidad hoy` o `disponibilidad mañana`.' };
      }
      const result = await this.service.availability(period);
      if (!result) {
        this.audit.record({
          eventType: 'calendar.read.availability',
          entityType: 'calendar',
          metadata: { period, busyIntervals: 0, freeSlots: 0, windowElapsed: true },
        });
        return { handled: true, reply: `📅 La ventana de disponibilidad de ${periodLabel(period)} ya terminó.` };
      }
      this.auditAvailability(result);
      return { handled: true, reply: this.renderAvailability(result) };
    } catch (error) {
      this.audit.record({
        eventType: 'calendar.read.failed',
        entityType: 'calendar',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { handled: true, reply: '⚠️ No pude consultar Google Calendar en este momento.' };
    }
  }

  private auditAgenda(result: CalendarAgendaResult): void {
    this.audit.record({
      eventType: 'calendar.read.agenda',
      entityType: 'calendar',
      metadata: { period: result.period, returned: result.events.length },
    });
  }

  private auditAvailability(result: CalendarAvailabilityResult): void {
    this.audit.record({
      eventType: 'calendar.read.availability',
      entityType: 'calendar',
      metadata: {
        period: result.period,
        busyIntervals: result.busyIntervals.length,
        freeSlots: result.freeSlots.length,
      },
    });
  }

  private renderAgenda(result: CalendarAgendaResult): string {
    const label = periodLabel(result.period);
    if (result.events.length === 0) return `📅 Agenda ${label}: no hay eventos.`;
    const includeDate = result.period === 'week';
    return boundedLines([
      `📅 Agenda ${label} · ${result.events.length} evento${result.events.length === 1 ? '' : 's'}`,
      ...result.events.map((event) => formatEvent(event, this.timeZone, includeDate)),
    ], this.config.maxReplyChars);
  }

  private renderAvailability(result: CalendarAvailabilityResult): string {
    const label = periodLabel(result.period);
    if (result.freeSlots.length === 0) {
      return `📅 Disponibilidad ${label}: no hay huecos de al menos ${this.config.minFreeMinutes} min en la ventana configurada.`;
    }
    return boundedLines([
      `📅 Disponibilidad ${label} · huecos ≥ ${this.config.minFreeMinutes} min`,
      ...result.freeSlots.map((slot) => {
        const start = formatDateTime(slot.startAt, this.timeZone, false);
        const end = formatDateTime(slot.endAt, this.timeZone, false);
        return `• ${start}–${end} (${durationLabel(slot.startAt, slot.endAt)})`;
      }),
    ], this.config.maxReplyChars);
  }
}
