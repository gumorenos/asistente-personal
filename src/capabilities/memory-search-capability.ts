import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type {
  LocalMemorySearchRepository,
  LocalMemorySearchResult,
  LocalMemorySource,
} from '../database/local-memory-search-repository.ts';
import { compileFtsQuery, FTS_QUERY_LIMITS } from '../search/fts-query.ts';
import type { Capability, CapabilityResult } from './types.ts';

const DEFAULT_LIMIT = 5;
const MAX_ITEM_CHARS = 320;
const MAX_REPLY_CHARS = 3_500;

const SOURCE_ALIASES: Record<string, LocalMemorySource> = {
  mensaje: 'message',
  mensajes: 'message',
  nota: 'note',
  notas: 'note',
  recordatorio: 'reminder',
  recordatorios: 'reminder',
  gasto: 'expense',
  gastos: 'expense',
};

const SOURCE_LABELS: Record<LocalMemorySource, string> = {
  message: 'mensajes',
  note: 'notas',
  reminder: 'recordatorios',
  expense: 'gastos',
};

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
    default: source = 'Mensaje';
  }
  return `• ${source} · ${formatLocalTimestamp(result.occurredAt, timeZone)} — ${compactText(result.text)}`;
}

export class MemorySearchCapability implements Capability {
  readonly name = 'memory-search';

  private readonly searchRepository: LocalMemorySearchRepository;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;

  constructor(
    searchRepository: LocalMemorySearchRepository,
    audit: AuditRepository,
    timeZone: string,
  ) {
    this.searchRepository = searchRepository;
    this.audit = audit;
    this.timeZone = timeZone;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(
      /^(?:busca|buscar)(?:\s+(mensajes?|notas?|recordatorios?|gastos?))?\s+(.+)$/i,
    );
    if (!match?.[2]) return undefined;

    const rawSource = match[1]?.toLocaleLowerCase('es-PE');
    const source = rawSource ? SOURCE_ALIASES[rawSource] : undefined;
    const query = match[2].trim();
    if (!source && /^observaciones\s+/i.test(query)) return undefined;

    const compiled = compileFtsQuery(query);
    if (!compiled) {
      return {
        handled: true,
        reply: `⚠️ Búsqueda inválida. Usa hasta ${FTS_QUERY_LIMITS.maxQueryChars} caracteres de texto.`,
      };
    }

    const results = this.searchRepository.search(query, {
      limit: DEFAULT_LIMIT,
      excludeMessageId: message.id,
      source,
    });
    const counts = {
      messages: results.filter((result) => result.source === 'message').length,
      notes: results.filter((result) => result.source === 'note').length,
      reminders: results.filter((result) => result.source === 'reminder').length,
      expenses: results.filter((result) => result.source === 'expense').length,
    };

    this.audit.record({
      eventType: 'memory.search',
      entityType: 'local_memory',
      metadata: {
        tokenCount: compiled.tokenCount,
        returned: results.length,
        source: source ?? 'all',
        ...counts,
      },
    });

    if (results.length === 0) {
      const scope = source ? ` en ${SOURCE_LABELS[source]}` : '';
      return { handled: true, reply: `🔎 No encontré coincidencias${scope} en tu memoria local.` };
    }

    const scope = source ? ` · ${SOURCE_LABELS[source]}` : '';
    const lines = [`🔎 Memoria local${scope} · ${results.length} resultado${results.length === 1 ? '' : 's'}`];
    for (const result of results) {
      const line = formatResult(result, this.timeZone);
      if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
      lines.push(line);
    }

    return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
  }
}
