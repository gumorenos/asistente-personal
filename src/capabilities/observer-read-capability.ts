import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { normalizeObservedJid, type ObservedChatRepository } from '../database/observed-chat-repository.ts';
import type { SqliteObservationSink, StoredObservation } from '../observer/sqlite-observation-sink.ts';
import type { Capability, CapabilityResult } from './types.ts';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_ITEM_CHARS = 280;
const MAX_REPLY_CHARS = 3_500;

function auditEntity(jid: string): string {
  return createHash('sha256').update(jid).digest('hex').slice(0, 16);
}

function compactText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_ITEM_CHARS) return compact;
  return `${compact.slice(0, MAX_ITEM_CHARS - 1)}…`;
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

export class ObserverReadCapability implements Capability {
  readonly name = 'observer-read';

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
    const match = message.text.trim().match(/^observaciones\s+([^\s]+)(?:\s+(\d+))?$/i);
    if (!match?.[1]) return undefined;

    let jid: string;
    try {
      jid = normalizeObservedJid(match[1]);
    } catch {
      return { handled: true, reply: '⚠️ JID inválido. Usa “observaciones <jid> [1-10]”.' };
    }

    const limit = match[2] ? Number(match[2]) : DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { handled: true, reply: '⚠️ El límite debe estar entre 1 y 10.' };
    }

    const chat = this.chats.get(jid);
    if (!chat) {
      return { handled: true, reply: 'No existe ese JID en la allowlist/historial administrativo de Observer.' };
    }

    const rows = this.sink.listRecent(jid, limit);
    this.audit.record({
      eventType: 'observer.read',
      entityType: 'observed_chat',
      entityId: auditEntity(jid),
      metadata: { requested: limit, returned: rows.length, enabled: chat.enabled },
    });

    if (rows.length === 0) {
      return {
        handled: true,
        reply: `👁️ No hay observaciones almacenadas para ${chat.label ? `${chat.label} — ` : ''}${jid}.`,
      };
    }

    const header = `👁️ Observaciones locales · ${chat.label ? `${chat.label} — ` : ''}${jid}${chat.enabled ? '' : ' · chat deshabilitado'}`;
    const lines = [header];
    for (const row of rows) {
      const candidate = [...lines, formatRow(row, this.timeZone)].join('\n');
      if (candidate.length > MAX_REPLY_CHARS) {
        lines.push('… salida truncada por límite de seguridad.');
        break;
      }
      lines.push(formatRow(row, this.timeZone));
    }
    return { handled: true, reply: lines.join('\n') };
  }
}
