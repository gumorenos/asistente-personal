import {
  addCalendarDays,
  isValidCalendarDate,
  zonedLocalToUtcIso,
} from './time-utils.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { GmailSearchConfig } from '../gmail/search-config.ts';
import type { GmailSearchFilter, GmailSearchProvider } from '../gmail/search-types.ts';
import type { GmailMetadataMessage } from '../gmail/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

type ParsedCommand =
  | { kind: 'from'; raw: string }
  | { kind: 'subject'; raw: string }
  | { kind: 'date_range'; start: string; end: string }
  | { kind: 'invalid' };

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim();
  if (!/^busca\s+correos(?:\s|$)/iu.test(trimmed)) return undefined;

  let match = trimmed.match(/^busca\s+correos\s+desde\s+(\d{4}-\d{2}-\d{2})\s+hasta\s+(\d{4}-\d{2}-\d{2})$/iu);
  if (match) return { kind: 'date_range', start: match[1]!, end: match[2]! };

  match = trimmed.match(/^busca\s+correos\s+de(?:\s+(.*))?$/iu);
  if (match) return match[1]?.trim() ? { kind: 'from', raw: match[1] } : { kind: 'invalid' };

  match = trimmed.match(/^busca\s+correos\s+asunto(?:\s+(.*))?$/iu);
  if (match) return match[1]?.trim() ? { kind: 'subject', raw: match[1] } : { kind: 'invalid' };

  return { kind: 'invalid' };
}

function safeTerm(raw: string, maxChars: number): string | undefined {
  const compacted = raw.replace(/\s+/g, ' ').trim();
  if (compacted.length < 2 || compacted.length > maxChars) return undefined;
  // Quotes/backslashes can alter Gmail query phrase parsing. Controls include bidi marks.
  if (/["\\\p{Cc}\p{Cf}]/u.test(compacted)) return undefined;
  return compacted;
}

function parseDate(value: string): CalendarDate | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDate(year, month, day) ? { year, month, day } : undefined;
}

function ordinalDays(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function dateRangeFilter(
  startRaw: string,
  endRaw: string,
  timeZone: string,
  maxDateRangeDays: number,
): GmailSearchFilter | undefined {
  const start = parseDate(startRaw);
  const end = parseDate(endRaw);
  if (!start || !end) return undefined;
  const days = ordinalDays(end) - ordinalDays(start) + 1;
  if (days < 1 || days > maxDateRangeDays) return undefined;

  const nextDay = addCalendarDays(end, 1);
  const startIso = zonedLocalToUtcIso({ ...start, hour: 0, minute: 0 }, timeZone);
  const endIso = zonedLocalToUtcIso({ ...nextDay, hour: 0, minute: 0 }, timeZone);
  return {
    kind: 'date_range',
    startEpochSeconds: Math.floor(new Date(startIso).getTime() / 1_000),
    endExclusiveEpochSeconds: Math.floor(new Date(endIso).getTime() / 1_000),
  };
}

function compact(value: string, maxChars: number): string {
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
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

export class GmailSearchCapability implements Capability {
  readonly name = 'gmail-search';

  constructor(
    private readonly provider: GmailSearchProvider | undefined,
    private readonly audit: AuditRepository,
    private readonly config: GmailSearchConfig,
    private readonly timeZone: string,
  ) {}

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = parseCommand(message.text);
    if (!command) return undefined;
    if (!this.config.enabled || !this.provider) {
      return { handled: true, reply: '📨 La búsqueda de Gmail está deshabilitada.' };
    }

    const filter = this.toFilter(command);
    if (!filter) {
      return {
        handled: true,
        reply: '⚠️ Usa `busca correos de <remitente>`, `busca correos asunto <texto>` o `busca correos desde YYYY-MM-DD hasta YYYY-MM-DD`.',
      };
    }

    try {
      const rows = await this.provider.searchInbox(filter, this.config.maxMessages);
      this.audit.record({
        eventType: 'gmail.search',
        entityType: 'gmail',
        metadata: {
          mode: filter.kind,
          requested: this.config.maxMessages,
          returned: rows.length,
        },
      });
      return {
        handled: true,
        reply: this.render(rows),
        // Search results contain external From/Subject data; do not retain their payload locally for retry.
        replyPersistence: 'ephemeral',
      };
    } catch (error) {
      this.audit.record({
        eventType: 'gmail.search.failed',
        entityType: 'gmail',
        metadata: {
          mode: filter.kind,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      return { handled: true, reply: '⚠️ No pude buscar en Gmail en este momento.' };
    }
  }

  private toFilter(command: ParsedCommand): GmailSearchFilter | undefined {
    if (command.kind === 'invalid') return undefined;
    if (command.kind === 'date_range') {
      return dateRangeFilter(command.start, command.end, this.timeZone, this.config.maxDateRangeDays);
    }
    const value = safeTerm(command.raw, this.config.maxTermChars);
    return value ? { kind: command.kind, value } : undefined;
  }

  private render(rows: GmailMetadataMessage[]): string {
    if (rows.length === 0) return '📨 Búsqueda Gmail: sin resultados.';
    const lines = [
      `📨 Búsqueda Gmail · ${rows.length}`,
      ...rows.map((row) => {
        const date = new Intl.DateTimeFormat('es-PE', {
          timeZone: this.timeZone,
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(row.internalDate));
        return `• ${date}${row.unread ? ' · no leído' : ''} — ${compact(row.from, 180)} — ${compact(row.subject, 220)}`;
      }),
    ];
    return boundedLines(lines, this.config.maxReplyChars);
  }
}
