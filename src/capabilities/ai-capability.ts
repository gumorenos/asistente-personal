import type { AiProvider } from '../ai/types.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { Capability, CapabilityResult } from './types.ts';

export interface AiCapabilityConfig {
  enabled: boolean;
  maxInputChars: number;
  maxReplyChars: number;
}

const SYSTEM_PROMPT = [
  'Eres un asistente personal de propósito general.',
  'Responde en español salvo que el usuario pida otro idioma.',
  'Sé claro y conciso.',
  'No afirmes haber realizado acciones, enviado mensajes, modificado calendarios ni consultado datos que no recibiste en este prompt.',
  'No tienes herramientas ni acceso automático a historial, notas, gastos, recordatorios, archivos o conversaciones.',
].join(' ');

export class AiCapability implements Capability {
  readonly name = 'ai';

  private readonly provider?: AiProvider;
  private readonly audit: AuditRepository;
  private readonly config: AiCapabilityConfig;

  constructor(provider: AiProvider | undefined, audit: AuditRepository, config: AiCapabilityConfig) {
    this.provider = provider;
    this.audit = audit;
    this.config = config;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const match = message.text.trim().match(/^(?:\/?ia|\/?ai)(?:\s+([\s\S]+))?$/i);
    if (!match) return undefined;

    if (!this.config.enabled || !this.provider) {
      return {
        handled: true,
        reply: '🤖 La IA está deshabilitada. Los comandos locales siguen funcionando normalmente.',
      };
    }

    const prompt = match[1]?.trim();
    if (!prompt) {
      return { handled: true, reply: '🤖 Usa `ia <pregunta>` para enviar una consulta explícita al proveedor configurado.' };
    }
    if (prompt.length > this.config.maxInputChars) {
      return {
        handled: true,
        reply: `⚠️ La consulta supera el límite de ${this.config.maxInputChars} caracteres y no fue enviada al proveedor.`,
      };
    }

    this.audit.record({
      eventType: 'ai.request.started',
      entityType: 'ai_request',
      metadata: { provider: this.provider.name, inputChars: prompt.length },
    });

    try {
      const result = await this.provider.generate({ userText: prompt, systemPrompt: SYSTEM_PROMPT });
      const reply = result.text.trim();
      if (!reply) throw new Error('AI provider returned an empty response');
      const boundedReply = reply.length > this.config.maxReplyChars
        ? `${reply.slice(0, Math.max(0, this.config.maxReplyChars - 1)).trimEnd()}…`
        : reply;

      this.audit.record({
        eventType: 'ai.request.succeeded',
        entityType: 'ai_request',
        metadata: {
          provider: this.provider.name,
          model: result.model,
          inputChars: prompt.length,
          outputChars: boundedReply.length,
        },
      });
      return { handled: true, reply: `🤖 ${boundedReply}` };
    } catch (error) {
      this.audit.record({
        eventType: 'ai.request.failed',
        entityType: 'ai_request',
        metadata: {
          provider: this.provider.name,
          errorType: error instanceof Error ? error.name : 'unknown',
        },
      });
      return {
        handled: true,
        reply: '⚠️ No pude obtener respuesta del proveedor de IA. No se ejecutó ninguna acción externa.',
      };
    }
  }
}
