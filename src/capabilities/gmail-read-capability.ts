import { GoogleOAuthAccessTokenProvider } from '../calendar/google-oauth-token-provider.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import { loadGmailBodyReadConfig, type GmailBodyReadConfig } from '../gmail/body-read-config.ts';
import { GoogleGmailMessageProvider } from '../gmail/google-gmail-message-provider.ts';
import type { GmailMessageProvider } from '../gmail/message-types.ts';
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

function sanitizeMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]+/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function boundedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1)}…`;
}

type ParsedCommand =
  | { kind: 'list'; unreadOnly: boolean; limit?: number }
  | { kind: 'body'; selection: number };

function parseCommand(text: string): ParsedCommand | undefined {
  const folded = foldText(text);
  const bodyMatch = folded.match(/^correo\s+#(\d+)$/);
  if (bodyMatch) return { kind: 'body', selection: Number(bodyMatch[1]) };

  let match = folded.match(/^correos(?:\s+recientes)?(?:\s+(\d+))?$/);
  if (match) return { kind: 'list', unreadOnly: false, limit: match[1] ? Number(match[1]) : undefined };
  match = folded.match(/^correos\s+no\s+leidos(?:\s+(\d+))?$/);
  if (match) return { kind: 'list', unreadOnly: true, limit: match[1] ? Number(match[1]) : undefined };
  return undefined;
}

interface GmailSelectionCache {
  capturedAtMs: number;
  rows: GmailMetadataMessage[];
}

export interface GmailReadCapabilityOptions {
  bodyConfig?: GmailBodyReadConfig;
  bodyProvider?: GmailMessageProvider;
  now?: () => number;
}

export class GmailReadCapability implements Capability {
  readonly name = 'gmail-metadata-read';

  private readonly provider: GmailReadProvider | undefined;
  private readonly audit: AuditRepository;
  private readonly config: GmailReadConfig;
  private readonly timeZone: string;
  private readonly bodyConfig: GmailBodyReadConfig;
  private readonly bodyProvider: GmailMessageProvider | undefined;
  private readonly now: () => number;
  private selectionCache: GmailSelectionCache | undefined;

  constructor(
    provider: GmailReadProvider | undefined,
    audit: AuditRepository,
    config: GmailReadConfig,
    timeZone: string,
    options: GmailReadCapabilityOptions = {},
  ) {
    this.provider = provider;
    this.audit = audit;
    this.config = config;
    this.timeZone = timeZone;
    this.now = options.now ?? Date.now;
    this.bodyConfig = options.bodyConfig ?? loadGmailBodyReadConfig(process.env, config.enabled);

    if (options.bodyProvider) {
      this.bodyProvider = options.bodyProvider;
    } else if (this.bodyConfig.enabled) {
      const tokenProvider = new GoogleOAuthAccessTokenProvider({
        clientId: this.bodyConfig.clientId!,
        clientSecret: this.bodyConfig.clientSecret!,
        refreshToken: this.bodyConfig.refreshToken!,
        timeoutMs: this.bodyConfig.timeoutMs,
      });
      this.bodyProvider = new GoogleGmailMessageProvider({
        timeoutMs: this.bodyConfig.timeoutMs,
        maxResponseBytes: this.bodyConfig.maxResponseBytes,
        maxBodyChars: this.bodyConfig.maxReplyChars,
      }, tokenProvider);
    }
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const command = parseCommand(message.text);
    if (!command) return undefined;
    if (command.kind === 'body') return this.handleBody(command.selection);

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

    // A new list attempt invalidates the prior ephemeral selection, even if the
    // provider fails. This avoids accidentally opening a stale message by index.
    this.selectionCache = undefined;
    try {
      const rows = await this.provider.listInbox({ unreadOnly: command.unreadOnly, limit });
      this.selectionCache = { capturedAtMs: this.now(), rows: [...rows] };
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

  private async handleBody(selection: number): Promise<CapabilityResult> {
    if (!Number.isInteger(selection) || selection < 1) {
      return { handled: true, reply: '⚠️ Usa `correo #N` con un número de la última lista de correos.' };
    }
    if (!this.bodyConfig.enabled || !this.bodyProvider) {
      return { handled: true, reply: '📨 La lectura del cuerpo de Gmail está deshabilitada.' };
    }

    const cache = this.selectionCache;
    if (!cache || this.now() - cache.capturedAtMs >= this.bodyConfig.selectionTtlMs) {
      this.selectionCache = undefined;
      return { handled: true, reply: '⚠️ La selección de correos no existe o venció. Ejecuta `correos` nuevamente.' };
    }
    const selected = cache.rows[selection - 1];
    if (!selected) {
      return { handled: true, reply: `⚠️ No existe el correo #${selection} en la última lista.` };
    }

    try {
      const body = await this.bodyProvider.getMessage({ id: selected.id, threadId: selected.threadId });
      if (body.id !== selected.id || body.threadId !== selected.threadId) {
        throw new Error('Gmail message provider returned a mismatched selection');
      }
      this.audit.record({
        eventType: 'gmail.body.read',
        entityType: 'gmail',
        metadata: {
          selection,
          format: body.format,
          truncated: body.truncated,
          omittedParts: body.omittedParts,
        },
      });
      return { handled: true, reply: this.renderBody(selection, selected, body.text, body.omittedParts) };
    } catch (error) {
      this.audit.record({
        eventType: 'gmail.body.read.failed',
        entityType: 'gmail',
        metadata: {
          selection,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      return { handled: true, reply: '⚠️ No pude leer ese correo en este momento.' };
    }
  }

  private render(rows: GmailMetadataMessage[], unreadOnly: boolean): string {
    const title = unreadOnly ? '📨 Correos no leídos' : '📨 Correos recientes';
    if (rows.length === 0) return `${title}: ninguno.`;
    const lines = [
      `${title} · ${rows.length}`,
      ...rows.map((row, index) => {
        const date = this.formatDate(row.internalDate);
        return `#${index + 1} · ${date}${row.unread ? ' · no leído' : ''} — ${compact(row.from, 180)} — ${compact(row.subject, 220)}`;
      }),
    ];
    return boundedLines(lines, this.config.maxReplyChars);
  }

  private renderBody(
    selection: number,
    row: GmailMetadataMessage,
    bodyText: string,
    omittedParts: number,
  ): string {
    const body = sanitizeMultiline(bodyText) || '(sin cuerpo de texto inline disponible)';
    const attachmentNote = omittedParts > 0
      ? `\n\nℹ️ ${omittedParts} parte(s) adjunta(s) omitida(s); Stage 7B no descarga adjuntos.`
      : '';
    const output = [
      `📨 Correo #${selection}`,
      `Fecha: ${this.formatDate(row.internalDate)}`,
      `De: ${compact(row.from, 320)}`,
      `Asunto: ${compact(row.subject, 300)}`,
      '',
      body,
    ].join('\n') + attachmentNote;
    return boundedText(output, this.bodyConfig.maxReplyChars);
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
}
