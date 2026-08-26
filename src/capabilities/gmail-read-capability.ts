import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { GmailReadConfig } from '../gmail/read-config.ts';
import type { GmailMetadataMessage, GmailReadProvider } from '../gmail/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
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

interface ParsedCommand {
  unreadOnly: boolean;
  limit?: number;
}

function parseCommand(text: string): ParsedCommand | undefined {
  const folded = foldText(text);
  let match = folded.match(/^correos(?:\s+recientes)?(?:\s+(\d+))?$/);
  if (match) return { unreadOnly: false, limit: match[1] ? Number(match[1]) : undefined };
  match = folded.match(/^correos\s+no\s+leidos(?:\s+(\d+))?$/);
  if (match) return { unreadOnly: true, limit: match[1] ? Number(match[1]) : undefined };
  return undefined;
}

export class GmailReadCapability implements Capability {
  readonly name = 'gmail-metadata-read';

  private readonly provider: GmailReadProvider | undefined;
  private readonly audit: AuditRepository;
  private readonly config: GmailReadConfig;
  private readonly timeZone: string;

  constructor(
    provider: GmailReadProvider | undefined,
    audit: AuditRepository,
    config: GmailReadConfig,
    timeZone: string,
  ) {
    this.provider = provider;
    this.audit = audit;
    this.config = config;
    this.timeZone = timeZone;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = parseCommand(message.text);
    if (!command) return undefined;

    const limit = command.limit ?? this.config.maxMessages;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.config.maxMessages) {
      return {
        handled: true,
        reply: `⚠️ Pide entre 1 y ${this.config.maxMessages} correos.`,
      };
    }

    if (!this.config.enabled || !this.provider) {
      return { handled: true, reply: '📨 La lectura de metadata de Gmail está deshabilitada.' };
    }

    try {
      const rows = await this.provider.listInbox({ unreadOnly: command.unreadOnly, limit });
      this.audit.record({
        eventType: 'gmail.read',
        entityType: 'gmail',
        metadata: {
          mode: command.unreadOnly ? 'unread' : 'inbox',
          requested: limit,
          returned: rows.length,
          unreadReturned: rows.filter((row) => row.unread).length,
        },
      });
      return { handled: true, reply: this.render(rows, command.unreadOnly) };
    } catch (error) {
      this.audit.record({
        eventType: 'gmail.read.failed',
        entityType: 'gmail',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { handled: true, reply: '⚠️ No pude consultar Gmail en este momento.' };
    }
  }

  private render(rows: GmailMetadataMessage[], unreadOnly: boolean): string {
    const title = unreadOnly ? '📨 Correos no leídos' : '📨 Correos recientes';
    if (rows.length === 0) return `${title}: ninguno.`;
    const lines = [
      `${title} · ${rows.length}`,
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
