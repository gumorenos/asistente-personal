import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { normalizeObservedJid, type ObservedChatRepository } from '../database/observed-chat-repository.ts';
import type { SqliteObservationSink, StoredObservation } from '../observer/sqlite-observation-sink.ts';
import { compileFtsQuery, FTS_QUERY_LIMITS } from '../search/fts-query.ts';
import type { Capability, CapabilityResult } from './types.ts';

const DEFAULT_LIMIT = 5;
const MAX_ITEM_CHARS = 280;
const MAX_REPLY_CHARS = 3_500;

function auditEntity(jid: string): string {
  return createHash('sha256').update(jid).digest('hex').slice(0, 16);
}

function compactText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= MAX_ITEM_CHARS ? compact : `${compact.slice(0, MAX_ITEM_CHARS - 1)}…`;
}

function formatLocalTimestamp(epochSeconds: number, timeZone: string): string {
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

function formatRow(row: StoredObservation, timeZone: string): string {
  const sender = row.isGroup && row.senderId ? ` · ${row.senderId}` : '';
  return `• ${formatLocalTimestamp(row.timestamp, timeZone)}${sender} — ${compactText(row.text)}`;
}

export class ObserverSearchCapability implements Capability {
  readonly name = 'observer-search';

  private readonly chats: ObservedChatRepository;
  private readonly sink: SqliteObservationSink;
  private readonly audit: AuditRepository;
  private readonly timeZone: string;

  constructor(
    chats: ObservedChatRepository,
    sink: SqliteObservationSink,
    audit: AuditRepository,
    timeZone: string,
  ) {
    this.chats = chats;
    this.sink = sink;
    this.audit = audit;
    this.timeZone = timeZone;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(/^(?:busca|buscar)\s+observaciones\s+([^\s]+)\s+(.+)$/i);
    if (!match?.[1] || !match[2]) return undefined;

    let jid: string;
    try {
      jid = normalizeObservedJid(match[1]);
    } catch {
      return { handled: true, reply: '⚠️ JID inválido. Usa “busca observaciones <jid> <texto>”.' };
    }

    const chat = this.chats.get(jid);
    if (!chat) {
      return { handled: true, reply: 'No existe ese JID en la allowlist/historial administrativo de Observer.' };
    }

    const query = match[2].trim();
    const compiled = compileFtsQuery(query);
    if (!compiled) {
      return {
        handled: true,
        reply: `⚠️ Búsqueda inválida. Usa hasta ${FTS_QUERY_LIMITS.maxQueryChars} caracteres de texto.`,
      };
    }

    const rows = this.sink.search(jid, query, DEFAULT_LIMIT);
    this.audit.record({
      eventType: 'observer.search',
      entityType: 'observed_chat',
      entityId: auditEntity(jid),
      metadata: {
        tokenCount: compiled.tokenCount,
        returned: rows.length,
        enabled: chat.enabled,
      },
    });

    if (rows.length === 0) {
      return { handled: true, reply: '🔎 No encontré coincidencias en ese chat observado.' };
    }

    const header = `🔎 Observer local · ${chat.label ? `${chat.label} — ` : ''}${jid}${chat.enabled ? '' : ' · chat deshabilitado'}`;
    const lines = [header];
    for (const row of rows) {
      const line = formatRow(row, this.timeZone);
      if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
      lines.push(line);
    }

    return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
  }
}
