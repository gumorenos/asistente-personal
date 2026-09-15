import type { CalendarAgendaResult, CalendarReadService } from '../calendar/calendar-read-service.ts';
import { localPeriodRange } from '../capabilities/time-utils.ts';
import type { CommitmentRecord, CommitmentRepository } from '../database/commitment-repository.ts';
import type { ReminderRecord, ReminderRepository } from '../database/reminder-repository.ts';
import type { GmailMetadataMessage, GmailReadProvider } from '../gmail/types.ts';
import type { ExecutivePrioritiesConfig } from './priorities-config.ts';

export type ExecutivePrioritySourceStatus = 'disabled' | 'ok' | 'failed';

type ActionSource = 'commitment' | 'reminder';
type ActionBucket = 'now' | 'today';

interface PriorityAction {
  source: ActionSource;
  id: number;
  body: string;
  dueAt: string;
  bucket: ActionBucket;
}

export interface ExecutivePrioritiesResult {
  text: string;
  actions: {
    now: number;
    today: number;
    returned: number;
  };
  calendar: {
    status: ExecutivePrioritySourceStatus;
    returned: number;
  };
  gmail: {
    status: ExecutivePrioritySourceStatus;
    unreadReturned: number;
  };
}

function cleanSingleLine(value: string, maxChars: number): string {
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
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

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function actionFromCommitment(row: CommitmentRecord, bucket: ActionBucket): PriorityAction | undefined {
  if (!row.dueAt) return undefined;
  return { source: 'commitment', id: row.id, body: row.body, dueAt: row.dueAt, bucket };
}

function actionFromReminder(row: ReminderRecord, bucket: ActionBucket): PriorityAction | undefined {
  if (!row.dueAt) return undefined;
  return { source: 'reminder', id: row.id, body: row.body, dueAt: row.dueAt, bucket };
}

function compareActions(left: PriorityAction, right: PriorityAction): number {
  const dueDelta = new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
  if (dueDelta !== 0) return dueDelta;
  if (left.source !== right.source) return left.source.localeCompare(right.source);
  return left.id - right.id;
}

function compareUnreadGmail(left: GmailMetadataMessage, right: GmailMetadataMessage): number {
  const dateDelta = new Date(right.internalDate).getTime() - new Date(left.internalDate).getTime();
  if (dateDelta !== 0) return dateDelta;
  const fromDelta = left.from.localeCompare(right.from);
  if (fromDelta !== 0) return fromDelta;
  return left.subject.localeCompare(right.subject);
}

function formatAction(item: PriorityAction, timeZone: string): string {
  const icon = item.source === 'commitment' ? '🤝' : '⏰';
  const label = item.source === 'commitment' ? 'compromiso' : 'recordatorio';
  return `• ${icon} ${label} #${item.id} · ${formatTime(item.dueAt, timeZone)} — ${cleanSingleLine(item.body, 180)}`;
}

function formatNextEvent(result: CalendarAgendaResult, timeZone: string): string | undefined {
  const event = result.events[0];
  if (!event) return undefined;
  const title = cleanSingleLine(event.title, 180);
  if (event.startDate && event.endDate) return `• Todo el día — ${title}`;
  if (event.startDateTime) return `• ${formatTime(event.startDateTime, timeZone)} — ${title}`;
  return `• Hora desconocida — ${title}`;
}

function formatUnreadGmail(rows: GmailMetadataMessage[]): string[] {
  return rows.map((row) => `• ${cleanSingleLine(row.from, 100)} — ${cleanSingleLine(row.subject, 160)}`);
}

export class ExecutivePrioritiesService {
  private readonly commitments: CommitmentRepository;
  private readonly reminders: ReminderRepository;
  private readonly calendar: CalendarReadService | undefined;
  private readonly gmail: GmailReadProvider | undefined;
  private readonly config: ExecutivePrioritiesConfig;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    commitments: CommitmentRepository,
    reminders: ReminderRepository,
    calendar: CalendarReadService | undefined,
    gmail: GmailReadProvider | undefined,
    config: ExecutivePrioritiesConfig,
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

  async render(): Promise<ExecutivePrioritiesResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();
    const day = localPeriodRange(now, this.timeZone, 'day');
    const fetchLimit = Math.min(100, Math.max(this.config.maxActionItems * 2, 10));

    const overdueCommitments = this.commitments.listOverdue(nowIso, fetchLimit)
      .map((row) => actionFromCommitment(row, 'now'))
      .filter((row): row is PriorityAction => Boolean(row));
    const todayCommitments = this.commitments.listOpenDueBetween(
      new Date(nowMs + 1).toISOString(),
      day.endIso,
      fetchLimit,
    )
      .map((row) => actionFromCommitment(row, 'today'))
      .filter((row): row is PriorityAction => Boolean(row));
    const pendingReminders = this.reminders.listPendingDueBefore(day.endIso, fetchLimit);
    const reminderActions = pendingReminders
      .map((row) => actionFromReminder(row, new Date(row.dueAt!).getTime() <= nowMs ? 'now' : 'today'))
      .filter((row): row is PriorityAction => Boolean(row));

    const nowActions = [...overdueCommitments, ...reminderActions.filter((row) => row.bucket === 'now')]
      .sort(compareActions);
    const todayActions = [...todayCommitments, ...reminderActions.filter((row) => row.bucket === 'today')]
      .sort(compareActions);
    const selectedActions = [...nowActions, ...todayActions].slice(0, this.config.maxActionItems);
    const selectedNow = selectedActions.filter((row) => row.bucket === 'now');
    const selectedToday = selectedActions.filter((row) => row.bucket === 'today');

    let calendarStatus: ExecutivePrioritySourceStatus = this.calendar ? 'ok' : 'disabled';
    let calendarResult: CalendarAgendaResult | undefined;
    if (this.calendar) {
      try {
        calendarResult = await this.calendar.agendaRemainingToday(1);
      } catch {
        calendarStatus = 'failed';
      }
    }

    let gmailStatus: ExecutivePrioritySourceStatus = this.gmail ? 'ok' : 'disabled';
    let unreadRows: GmailMetadataMessage[] = [];
    if (this.gmail) {
      try {
        unreadRows = (await this.gmail.listInbox({
          unreadOnly: true,
          limit: this.config.maxGmailMessages,
        }))
          .filter((row) => row.unread)
          .sort(compareUnreadGmail)
          .slice(0, this.config.maxGmailMessages);
      } catch {
        gmailStatus = 'failed';
      }
    }

    const lines = ['🎯 Prioridades de hoy'];
    lines.push('', '🔴 Atiende ahora');
    if (selectedNow.length === 0) lines.push('• Nada vencido entre los elementos revisados.');
    else lines.push(...selectedNow.map((row) => formatAction(row, this.timeZone)));

    lines.push('', '🟠 Después hoy');
    if (selectedToday.length === 0) lines.push('• Sin compromisos o recordatorios adicionales para hoy.');
    else lines.push(...selectedToday.map((row) => formatAction(row, this.timeZone)));

    lines.push('', '📅 Próximo evento');
    if (calendarStatus === 'disabled') lines.push('• Calendar read deshabilitado.');
    else if (calendarStatus === 'failed') lines.push('• Calendar no disponible en este momento.');
    else lines.push(formatNextEvent(calendarResult!, this.timeZone) ?? '• Sin eventos restantes hoy.');

    lines.push('', '📨 Inbox no leído para revisar');
    if (gmailStatus === 'disabled') lines.push('• Gmail read deshabilitado.');
    else if (gmailStatus === 'failed') lines.push('• Gmail no disponible en este momento.');
    else if (unreadRows.length === 0) lines.push('• Sin correos no leídos entre los resultados solicitados.');
    else {
      lines.push(...formatUnreadGmail(unreadRows));
      lines.push('• Nota: estar no leído no implica urgencia; esta sección no analiza el cuerpo.');
    }

    return {
      text: boundedLines(lines, this.config.maxReplyChars),
      actions: {
        now: selectedNow.length,
        today: selectedToday.length,
        returned: selectedActions.length,
      },
      calendar: {
        status: calendarStatus,
        returned: calendarResult?.events.length ?? 0,
      },
      gmail: {
        status: gmailStatus,
        unreadReturned: unreadRows.length,
      },
    };
  }
}
