import type { TranscriptionInput, TranscriptionProvider, TranscriptionResult } from './types.ts';

export interface OpenAICompatibleTranscriptionConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class OpenAICompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'openai-compatible';

  private readonly config: OpenAICompatibleTranscriptionConfig;
  private readonly fetchImpl: FetchImplementation;

  constructor(config: OpenAICompatibleTranscriptionConfig, fetchImpl: FetchImplementation = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref();

    try {
      const form = new FormData();
      const start = input.data.byteOffset;
      const end = start + input.data.byteLength;
      const arrayBuffer = input.data.buffer.slice(start, end) as ArrayBuffer;
      form.append('file', new Blob([arrayBuffer], { type: input.mimeType }), input.fileName);
      form.append('model', this.config.model);

      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : undefined,
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Transcription provider request failed with HTTP ${response.status}`);
      }

      const payload: unknown = await response.json();
      const text = isRecord(payload) && typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) throw new Error('Transcription provider returned no text');
      const responseModel = isRecord(payload) && typeof payload.model === 'string' ? payload.model : undefined;
      return { text, model: responseModel ?? this.config.model };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Transcription provider request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
