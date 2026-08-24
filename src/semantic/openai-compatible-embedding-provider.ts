import type { EmbeddingProvider } from './types.ts';

export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
}

function validateVector(value: unknown, dimensions: number): number[] {
  if (!Array.isArray(value) || value.length !== dimensions) throw new Error('Embedding response dimension mismatch');
  const vector = value.map((item) => Number(item));
  if (vector.some((item) => !Number.isFinite(item))) throw new Error('Embedding response contains invalid values');
  return vector;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleEmbeddingConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.timeoutMs = config.timeoutMs;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length < 1 || texts.length > 100) throw new Error('Invalid embedding batch size');
    if (texts.some((text) => !text.trim() || text.length > 8_000)) throw new Error('Invalid embedding input');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Embedding provider HTTP ${response.status}`);
      const body = await response.json() as EmbeddingResponse;
      if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error('Invalid embedding response count');

      const ordered = [...body.data].sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
      return ordered.map((item) => validateVector(item.embedding, this.dimensions));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('Embedding provider timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
