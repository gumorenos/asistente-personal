import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type {
  LocalMemorySearchRepository,
  LocalMemorySearchResult,
  LocalMemorySource,
} from '../database/local-memory-search-repository.ts';
import { compileFtsQuery, FTS_QUERY_LIMITS } from '../search/fts-query.ts';
import {
  addCalendarDays,
  isValidCalendarDate,
  localPeriodRange,
  zonedLocalToUtcIso,
} from './time-utils.ts';
import type { Capability, CapabilityResult } from './types.ts';

const DEFAULT_LIMIT = 5;
const MAX_ITEM_CHARS = 320;
const MAX_REPLY_CHARS = 3_500;
const MAX_CUSTOM_RANGE_DAYS = 3_660;

const SOURCE_ALIASES: Record<string, LocalMemorySource> = {
  mensaje: 'message',
  mensajes: 'message',
  nota: 'note',
  notas: 'note',
  recordatorio: 'reminder',
  recordatorios: 'reminder',
  gasto: 'expense',
  gastos: 'expense',
  documento: 'document',
  documentos: 'document',
  compromiso: 'commitment',
  compromisos: 'commitment',
};

const SOURCE_LABELS: Record<LocalMemorySource, string> = {
  message: 'mensajes',
  note: 'notas',
  reminder: 'recordatorios',
  expense: 'gastos',
  document: 'documentos',
  commitment: 'compromisos',
};

type TemporalScopeKind = 'all-time' | 'day' | 'week' | 'month' | 'custom';

interface TemporalScope {
  query: string;
  kind: TemporalScopeKind;
  label?: string;
  fromEpochSeconds?: number;
  toEpochSeconds?: number;
  error?: string;
}

function compactText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= MAX_ITEM_CHARS ? compact : `${compact.slice(0, MAX_ITEM_CHARS - 1)}…`;
}

function formatLocalTimestamp(epochSeconds: number, timeZone: string): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return 'fecha desconocida';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epochSeconds * 1_000));
}

function formatResult(result: LocalMemorySearchResult, timeZone: string): string {
  let source: string;
  switch (result.source) {
    case 'note': source = `Nota #${result.sourceId}`; break;
    case 'reminder': source = `Recordatorio #${result.sourceId}`; break;
    case 'expense': source = `Gasto #${result.sourceId}`; break;
    case 'document': source = `Documento #${result.sourceId}`; break;
    case 'commitment': source = `Compromiso #${result.sourceId}`; break;
    default: source = 'Mensaje';
  }
  return `• ${source} · ${formatLocalTimestamp(result.occurredAt, timeZone)} — ${compactText(result.text)}`;
}

function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1_000);
}

function parseIsoCalendarDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDate(year, month, day) ? { year, month, day } : undefined;
}

function resolveTemporalScope(input: string, now: Date, timeZone: string): TemporalScope {
  const text = input.trim();
  const periodMatch = text.match(/^(hoy|semana|esta\s+semana|mes|este\s+mes)\s+(.+)$/i);
  if (periodMatch?.[1] && periodMatch[2]) {
    const raw = periodMatch[1].toLocaleLowerCase('es-PE').replace(/\s+/g, ' ');
    const kind = raw === 'hoy' ? 'day' : raw.includes('semana') ? 'week' : 'month';
    const range = localPeriodRange(now, timeZone, kind);
    return {
      query: periodMatch[2].trim(),
      kind,
      label: kind === 'day' ? 'hoy' : kind === 'week' ? 'esta semana' : 'este mes',
      fromEpochSeconds: epochSeconds(range.startIso),
      toEpochSeconds: epochSeconds(range.endIso),
    };
  }

  const customMatch = text.match(/^desde\s+(\d{4}-\d{2}-\d{2})\s+hasta\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/i);
  if (customMatch?.[1] && customMatch[2] && customMatch[3]) {
    const start = parseIsoCalendarDate(customMatch[1]);
    const endInclusive = parseIsoCalendarDate(customMatch[2]);
    if (!start || !endInclusive) {
      return { query: customMatch[3].trim(), kind: 'custom', error: 'Rango de fechas inválido. Usa YYYY-MM-DD.' };
    }
    const startDay = Date.UTC(start.year, start.month - 1, start.day);
    const endDay = Date.UTC(endInclusive.year, endInclusive.month - 1, endInclusive.day);
    const spanDays = Math.floor((endDay - startDay) / 86_400_000) + 1;
    if (spanDays < 1) {
      return { query: customMatch[3].trim(), kind: 'custom', error: 'La fecha “desde” debe ser anterior o igual a “hasta”.' };
    }
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
      return { query: customMatch[3].trim(), kind: 'custom', error: `El rango máximo es ${MAX_CUSTOM_RANGE_DAYS} días.` };
    }
    const endExclusive = addCalendarDays(endInclusive, 1);
    const startIso = zonedLocalToUtcIso({ ...start, hour: 0, minute: 0 }, timeZone);
    const endIso = zonedLocalToUtcIso({ ...endExclusive, hour: 0, minute: 0 }, timeZone);
    return {
      query: customMatch[3].trim(),
      kind: 'custom',
      label: `${customMatch[1]} → ${customMatch[2]}`,
      fromEpochSeconds: epochSeconds(startIso),
      toEpochSeconds: epochSeconds(endIso),
    };
  }

  return { query: text, kind: 'all-time' };
}

export class MemorySearchCapability implements Capability {
  readonly name = 'memory-search';

  private readonly searchRepository: LocalMemorySearchRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    searchRepository: LocalMemorySearchRepository,
    audit: AuditRepository,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.searchRepository = searchRepository;
    this.audit = audit;
    this.timeZone = timeZone;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(
      /^(?:busca|buscar)(?:\s+(mensajes?|notas?|recordatorios?|gastos?|documentos?|compromisos?))?\s+(.+)$/i,
    );
    if (!match?.[2]) return undefined;

    const rawSource = match[1]?.toLocaleLowerCase('es-PE');
    const source = rawSource ? SOURCE_ALIASES[rawSource] : undefined;
    const rawQuery = match[2].trim();
    if (!source && /^observaciones\s+/i.test(rawQuery)) return undefined;

    const scope = resolveTemporalScope(rawQuery, this.now(), this.timeZone);
    if (scope.error) return { handled: true, reply: `⚠️ ${scope.error}` };

    const compiled = compileFtsQuery(scope.query);
    if (!compiled) {
      return {
        handled: true,
        reply: `⚠️ Búsqueda inválida. Usa hasta ${FTS_QUERY_LIMITS.maxQueryChars} caracteres de texto.`,
      };
    }

    const results = this.searchRepository.search(scope.query, {
      limit: DEFAULT_LIMIT,
      excludeMessageId: message.id,
      source,
      fromEpochSeconds: scope.fromEpochSeconds,
      toEpochSeconds: scope.toEpochSeconds,
    });
    const counts = {
      messages: results.filter((result) => result.source === 'message').length,
      notes: results.filter((result) => result.source === 'note').length,
      reminders: results.filter((result) => result.source === 'reminder').length,
      expenses: results.filter((result) => result.source === 'expense').length,
      documents: results.filter((result) => result.source === 'document').length,
      commitments: results.filter((result) => result.source === 'commitment').length,
    };

    this.audit.record({
      eventType: 'memory.search',
      entityType: 'local_memory',
      metadata: {
        tokenCount: compiled.tokenCount,
        returned: results.length,
        source: source ?? 'all',
        temporalScope: scope.kind,
        ...counts,
      },
    });

    const sourceScope = source ? ` en ${SOURCE_LABELS[source]}` : '';
    const timeScope = scope.label ? ` · ${scope.label}` : '';
    if (results.length === 0) {
      return { handled: true, reply: `🔎 No encontré coincidencias${sourceScope}${timeScope} en tu memoria local.` };
    }

    const sourceHeader = source ? ` · ${SOURCE_LABELS[source]}` : '';
    const lines = [`🔎 Memoria local${sourceHeader}${timeScope} · ${results.length} resultado${results.length === 1 ? '' : 's'}`];
    for (const result of results) {
      const line = formatResult(result, this.timeZone);
      if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
      lines.push(line);
    }

    return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
  }
}
