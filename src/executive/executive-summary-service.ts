import type { CalendarAgendaResult, CalendarReadService } from '../calendar/calendar-read-service.ts';
import { localPeriodRange } from '../capabilities/time-utils.ts';
import type { CommitmentOpenSummary, CommitmentRecord, CommitmentRepository } from '../database/commitment-repository.ts';
import type { ReminderRecord, ReminderRepository } from '../database/reminder-repository.ts';
import type { GmailMetadataMessage, GmailReadProvider } from '../gmail/types.ts';
import type { ExecutiveSummaryConfig } from './summary-config.ts';

export type ExecutiveSourceStatus = 'disabled' | 'ok' | 'failed';

export interface ExecutiveSummaryResult {
  text: string;
  local: {
    openCommitments: number;
    overdueCommitments: number;
    pendingReminders: number;
  };
  calendar: {
    status: ExecutiveSourceStatus;
    returned: number;
  };
  gmail: {
    status: ExecutiveSourceStatus;
    returned: number;
    unread: number;
  };
}

function cleanSingleLine(value: string, maxChars: number): string {
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1))}…`;
}

function boundedLines(lines: string[], maxChars: number): string {
  const output: string[] = [];
  const marker = '… salida truncada';
  for (const line of lines) {
    const candidate = [...output, line].join('\n');
    if (candidate.length > maxChars) {
      if ([...output, marker].join('\n').length <= maxChars) output.push(marker);
      break;
    }
    output.push(line);
  }
  return output.join('\n').slice(0, maxChars);
}

function formatDateTime(value: string, timeZone: string, includeDate = false): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    ...(includeDate ? { weekday: 'short', day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function formatCommitment(row: CommitmentRecord, timeZone: string, now: Date): string {
  const body = cleanSingleLine(row.body, 180);
  if (!row.dueAt) return `• #${row.id} ${body} — sin vencimiento`;
  const overdue = new Date(row.dueAt).getTime() <= now.getTime();
  return `• #${row.id} ${body} — ${formatDateTime(row.dueAt, timeZone, true)}${overdue ? ' ⚠️ vencido' : ''}`;
}

function formatReminder(row: ReminderRecord, timeZone: string): string {
  const body = cleanSingleLine(row.body, 180);
  return row.dueAt
    ? `• #${row.id} ${body} — ${formatDateTime(row.dueAt, timeZone, true)}`
    : `• #${row.id} ${body} — sin hora`;
}

function formatCalendar(result: CalendarAgendaResult, timeZone: string, maxEvents: number): string[] {
  return result.events.slice(0, maxEvents).map((event) => {
    const title = cleanSingleLine(event.title, 180);
    if (event.startDate && event.endDate) return `• Todo el día — ${title}`;
    if (event.startDateTime && event.endDateTime) {
      return `• ${formatDateTime(event.startDateTime, timeZone)}–${formatDateTime(event.endDateTime, timeZone)} — ${title}`;
    }
    return `• Hora desconocida — ${title}`;
  });
}

function prioritizeGmail(rows: GmailMetadataMessage[]): GmailMetadataMessage[] {
  return [...rows].sort((a, b) => {
    const unreadDelta = Number(b.unread) - Number(a.unread);
    if (unreadDelta !== 0) return unreadDelta;
    return new Date(b.internalDate).getTime() - new Date(a.internalDate).getTime();
  });
}

function formatGmail(rows: GmailMetadataMessage[]): string[] {
  return rows.map((row) => {
    const unread = row.unread ? 'no leído · ' : '';
    const from = cleanSingleLine(row.from, 100);
    const subject = cleanSingleLine(row.subject, 160);
    return `• ${unread}${from} — ${subject}`;
  });
}

function commitmentSummaryLine(summary: CommitmentOpenSummary): string {
  return `• ${summary.total} abiertos · ${summary.overdue} vencidos · ${summary.today} para hoy · ${summary.thisWeek} esta semana · ${summary.undated} sin fecha`;
}

export class ExecutiveSummaryService {
  private readonly commitments: CommitmentRepository;
  private readonly reminders: ReminderRepository;
  private readonly calendar: CalendarReadService | undefined;
  private readonly gmail: GmailReadProvider | undefined;
  private readonly config: ExecutiveSummaryConfig;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    commitments: CommitmentRepository,
    reminders: ReminderRepository,
    calendar: CalendarReadService | undefined,
    gmail: GmailReadProvider | undefined,
    config: ExecutiveSummaryConfig,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.commitments = commitments;
    this.reminders = reminders;
    this.calendar = calendar;
    this.gmail = gmail;
    this.config = config;
    this.timeZone = timeZone;
    this.now = now;
  }

  async render(): Promise<ExecutiveSummaryResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    const day = localPeriodRange(now, this.timeZone, 'day');
    const week = localPeriodRange(now, this.timeZone, 'week');
    const summary = this.commitments.summarizeOpen(nowIso, day.endIso, week.endIso);
    const overdue = this.commitments.listOverdue(nowIso, this.config.maxLocalItems);
    const upcoming = this.commitments.listOpenUpcoming(nowIso, this.config.maxLocalItems);
    const reminders = this.reminders.listPending(this.config.maxLocalItems);

    let calendarStatus: ExecutiveSourceStatus = this.calendar ? 'ok' : 'disabled';
    let calendarResult: CalendarAgendaResult | undefined;
    if (this.calendar) {
      try {
        calendarResult = await this.calendar.agenda('today', this.config.maxCalendarEvents);
      } catch {
        calendarStatus = 'failed';
      }
    }

    let gmailStatus: ExecutiveSourceStatus = this.gmail ? 'ok' : 'disabled';
    let gmailRows: GmailMetadataMessage[] = [];
    if (this.gmail) {
      try {
        gmailRows = prioritizeGmail(await this.gmail.listInbox({
          unreadOnly: false,
          limit: this.config.maxGmailMessages,
        })).slice(0, this.config.maxGmailMessages);
      } catch {
        gmailStatus = 'failed';
      }
    }

    const dateLabel = new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      dateStyle: 'full',
    }).format(now);
    const lines = [`🧭 Resumen ejecutivo — ${dateLabel}`];

    lines.push('', '🤝 Compromisos', commitmentSummaryLine(summary));
    const commitmentRows = [...overdue, ...upcoming.filter((row) => !overdue.some((item) => item.id === row.id))]
      .slice(0, this.config.maxLocalItems);
    if (commitmentRows.length === 0) lines.push('• Sin compromisos con fecha pendientes.');
    else lines.push(...commitmentRows.map((row) => formatCommitment(row, this.timeZone, now)));

    lines.push('', '⏰ Recordatorios');
    if (reminders.length === 0) lines.push('• Sin recordatorios pendientes.');
    else lines.push(...reminders.map((row) => formatReminder(row, this.timeZone)));

    lines.push('', '📅 Agenda de hoy');
    if (calendarStatus === 'disabled') lines.push('• Calendar read deshabilitado.');
    else if (calendarStatus === 'failed') lines.push('• No disponible en este momento.');
    else if (!calendarResult || calendarResult.events.length === 0) lines.push('• Sin eventos.');
    else lines.push(...formatCalendar(calendarResult, this.timeZone, this.config.maxCalendarEvents));

    lines.push('', '📨 Gmail reciente');
    if (gmailStatus === 'disabled') lines.push('• Gmail read deshabilitado.');
    else if (gmailStatus === 'failed') lines.push('• No disponible en este momento.');
    else if (gmailRows.length === 0) lines.push('• Sin mensajes recientes en INBOX.');
    else lines.push(...formatGmail(gmailRows));

    const unread = gmailRows.filter((row) => row.unread).length;
    return {
      text: boundedLines(lines, this.config.maxReplyChars),
      local: {
        openCommitments: summary.total,
        overdueCommitments: summary.overdue,
        pendingReminders: reminders.length,
      },
      calendar: {
        status: calendarStatus,
        returned: calendarResult?.events.slice(0, this.config.maxCalendarEvents).length ?? 0,
      },
      gmail: {
        status: gmailStatus,
        returned: gmailRows.length,
        unread,
      },
    };
  }
}
