import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { TranscriptionProvider } from '../transcription/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

export interface AudioTranscriptionConfig {
  enabled: boolean;
  maxBytes: number;
  maxTranscriptChars: number;
}

export class AudioTranscriptionCapability implements Capability {
  readonly name = 'audio-transcription';

  private readonly provider?: TranscriptionProvider;
  private readonly audit: AuditRepository;
  private readonly config: AudioTranscriptionConfig;

  constructor(
    provider: TranscriptionProvider | undefined,
    audit: AuditRepository,
    config: AudioTranscriptionConfig,
  ) {
    this.provider = provider;
    this.audit = audit;
    this.config = config;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    if (message.kind !== 'audio') return undefined;

    if (!this.config.enabled || !this.provider) {
      return {
        handled: true,
        reply: '🎙️ Recibí un audio, pero la transcripción está deshabilitada.',
      };
    }

    if (!message.loadMedia) {
      return {
        handled: true,
        reply: '⚠️ No pude acceder al contenido del audio para transcribirlo.',
      };
    }

    let media;
    try {
      media = await message.loadMedia();
    } catch (error) {
      this.audit.record({
        eventType: 'transcription.media_load.failed',
        entityType: 'transcription',
        metadata: { errorType: error instanceof Error ? error.name : 'unknown' },
      });
      return {
        handled: true,
        reply: '⚠️ No pude descargar el audio de WhatsApp. No se envió contenido a ningún proveedor.',
      };
    }

    if (media.data.byteLength === 0) {
      return { handled: true, reply: '⚠️ El audio recibido está vacío.' };
    }
    if (media.data.byteLength > this.config.maxBytes) {
      this.audit.record({
        eventType: 'transcription.request.rejected',
        entityType: 'transcription',
        metadata: { reason: 'size_limit', inputBytes: media.data.byteLength },
      });
      return {
        handled: true,
        reply: `⚠️ El audio supera el límite de ${this.config.maxBytes} bytes y no fue enviado al proveedor.`,
      };
    }

    const mimeType = media.mimeType?.trim() || 'audio/ogg';
    const fileName = media.fileName?.trim() || `audio-${message.id}.ogg`;
    this.audit.record({
      eventType: 'transcription.request.started',
      entityType: 'transcription',
      metadata: { provider: this.provider.name, inputBytes: media.data.byteLength, mimeType },
    });

    try {
      const result = await this.provider.transcribe({ data: media.data, mimeType, fileName });
      const transcript = result.text.trim();
      if (!transcript) throw new Error('Transcription provider returned empty text');
      const bounded = transcript.length > this.config.maxTranscriptChars
        ? `${transcript.slice(0, Math.max(0, this.config.maxTranscriptChars - 1)).trimEnd()}…`
        : transcript;

      this.audit.record({
        eventType: 'transcription.request.succeeded',
        entityType: 'transcription',
        metadata: {
          provider: this.provider.name,
          model: result.model,
          inputBytes: media.data.byteLength,
          outputChars: bounded.length,
        },
      });
      return { handled: true, reply: `🎙️ Transcripción:\n${bounded}` };
    } catch (error) {
      this.audit.record({
        eventType: 'transcription.request.failed',
        entityType: 'transcription',
        metadata: { provider: this.provider.name, errorType: error instanceof Error ? error.name : 'unknown' },
      });
      return {
        handled: true,
        reply: '⚠️ No pude transcribir el audio. No se ejecutó ninguna acción a partir de su contenido.',
      };
    }
  }
}
