import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { GmailReadConfig } from '../gmail/read-config.ts';
import type { GmailContentMessage, GmailMetadataMessage, GmailReadProvider } from '../gmail/types.ts';
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

interface ParsedListCommand {
  type: 'list';
  unreadOnly: boolean;
  limit?: number;
}

interface ParsedContentCommand {
  type: 'message' | 'thread';
  unreadOnly: boolean;
  index: number;
}

type ParsedCommand = ParsedListCommand | ParsedContentCommand;

function parseCommand(text: string): ParsedCommand | undefined {
  const folded = foldText(text);
  let match = folded.match(/^correos(?:\s+recientes)?(?:\s+(\d+))?$/);
  if (match) return { type: 'list', unreadOnly: false, limit: match[1] ? Number(match[1]) : undefined };
  match = folded.match(/^correos\s+no\s+leidos(?:\s+(\d+))?$/);
  if (match) return { type: 'list', unreadOnly: true, limit: match[1] ? Number(match[1]) : undefined };

  match = folded.match(/^lee\s+correo(?:\s+no\s+leido)?\s+#?(\d+)$/);
  if (match) {
    return {
      type: 'message',
      unreadOnly: /\bno\s+leido\b/.test(folded),
      index: Number(match[1]),
    };
  }
  match = folded.match(/^lee\s+hilo(?:\s+no\s+leido)?\s+#?(\d+)$/);
  if (match) {
    return {
      type: 'thread',
      unreadOnly: /\bno\s+leido\b/.test(folded),
      index: Number(match[1]),
    };
  }
  return undefined;
}

export class GmailReadCapability implements Capability {
  readonly name = 'gmail-read';

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
    if (command.type === 'list') return this.handleList(command);
    return this.handleContent(command);
  }

  private async handleList(command: ParsedListCommand): Promise<CapabilityResult> {
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
      return { handled: true, reply: this.renderList(rows, command.unreadOnly) };
    } catch (error) {
      this.audit.record({
        eventType: 'gmail.read.failed',
        entityType: 'gmail',
        metadata: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { handled: true, reply: '⚠️ No pude consultar Gmail en este momento.' };
    }
  }

  private async handleContent(command: ParsedContentCommand): Promise<CapabilityResult> {
    if (!Number.isInteger(command.index) || command.index < 1 || command.index > this.config.maxMessages) {
      return { handled: true, reply: `⚠️ Elige una posición entre 1 y ${this.config.maxMessages}.` };
    }
    const content = this.config.content;
    if (!this.config.enabled || !this.provider || !content?.enabled) {
      return { handled: true, reply: '📨 La lectura del contenido de Gmail está deshabilitada.' };
    }
    if (!this.provider.readMessage || !this.provider.readThread) {
      return { handled: true, reply: '⚠️ El proveedor Gmail no soporta lectura de contenido.' };
    }

    try {
      // The selector is positional over the current Inbox/Unread view. IDs are never exposed or persisted.
      const rows = await this.provider.listInbox({ unreadOnly: command.unreadOnly, limit: command.index });
      const selected = rows[command.index - 1];
      if (!selected) {
        return {
          handled: true,
          reply: command.unreadOnly
            ? `📨 No existe un correo no leído en la posición ${command.index}.`
            : `📨 No existe un correo reciente en la posición ${command.index}.`,
        };
      }

      if (command.type === 'message') {
        const row = await this.provider.readMessage(selected.id, {
          maxBodyChars: content.maxBodyChars,
          maxMessageBytes: content.maxMessageBytes,
        });
        if (row.id !== selected.id || row.threadId !== selected.threadId) {
          throw new Error('Gmail content selection mismatch');
        }
        this.recordContentAudit(command, 1, row.truncated);
        return { handled: true, reply: this.renderMessage(row, command.index, content.maxReplyChars) };
      }

      const thread = await this.provider.readThread(selected.threadId, {
        maxBodyChars: content.maxBodyChars,
        maxMessageBytes: content.maxMessageBytes,
        maxMessages: content.maxThreadMessages,
      });
      if (thread.some((row) => row.threadId !== selected.threadId)) {
        throw new Error('Gmail thread selection mismatch');
      }
      this.recordContentAudit(command, thread.length, thread.some((row) => row.truncated));
      return { handled: true, reply: this.renderThread(thread, command.index, content.maxReplyChars) };
    } catch (error) {
      this.audit.record({
        eventType: 'gmail.content.read.failed',
        entityType: 'gmail',
        metadata: {
          mode: command.type,
          selector: command.unreadOnly ? 'unread' : 'inbox',
          position: command.index,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      return { handled: true, reply: '⚠️ No pude leer ese correo de Gmail en este momento.' };
    }
  }

  private recordContentAudit(command: ParsedContentCommand, returned: number, truncated: boolean): void {
    this.audit.record({
      eventType: 'gmail.content.read',
      entityType: 'gmail',
      metadata: {
        mode: command.type,
        selector: command.unreadOnly ? 'unread' : 'inbox',
        position: command.index,
        returned,
        truncated,
      },
    });
  }

  private formatDate(internalDate: string): string {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: this.timeZone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(internalDate));
  }

  private renderList(rows: GmailMetadataMessage[], unreadOnly: boolean): string {
    const title = unreadOnly ? '📨 Correos no leídos' : '📨 Correos recientes';
    if (rows.length === 0) return `${title}: ninguno.`;
    const lines = [
      `${title} · ${rows.length}`,
      ...rows.map((row, index) => {
        const date = this.formatDate(row.internalDate);
        return `${index + 1}. ${date}${row.unread ? ' · no leído' : ''} — ${compact(row.from, 180)} — ${compact(row.subject, 220)}`;
      }),
      'Usa “lee correo N” o “lee hilo N” para pedir contenido explícitamente.',
    ];
    return boundedLines(lines, this.config.maxReplyChars);
  }

  private renderMessage(row: GmailContentMessage, index: number, maxReplyChars: number): string {
    const lines = [
      `📨 Correo ${index} · ${this.formatDate(row.internalDate)}`,
      `De: ${compact(row.from, 180)}`,
      `Asunto: ${compact(row.subject, 220)}`,
      '',
      row.body,
      ...(row.truncated ? ['', '… cuerpo truncado por límite local'] : []),
    ];
    return boundedLines(lines, maxReplyChars);
  }

  private renderThread(rows: GmailContentMessage[], index: number, maxReplyChars: number): string {
    if (rows.length === 0) return `📨 Hilo ${index}: sin mensajes de texto disponibles.`;
    const lines: string[] = [`📨 Hilo ${index} · ${rows.length} mensaje(s)`];
    for (const [messageIndex, row] of rows.entries()) {
      lines.push(
        '',
        `${messageIndex + 1}. ${this.formatDate(row.internalDate)} — ${compact(row.from, 160)}`,
        `Asunto: ${compact(row.subject, 200)}`,
        row.body,
        ...(row.truncated ? ['… cuerpo truncado por límite local'] : []),
      );
    }
    return boundedLines(lines, maxReplyChars);
  }
}
