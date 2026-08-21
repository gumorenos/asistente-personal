import type { AiGenerateInput, AiGenerateResult, AiProvider } from './types.ts';

export interface OpenAICompatibleProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return undefined;
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  const content = choice.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const parts = content.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.text === 'string') return [item.text];
    return [];
  });
  return parts.length ? parts.join('\n') : undefined;
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';

  private readonly config: OpenAICompatibleProviderConfig;
  private readonly fetchImpl: FetchImplementation;

  constructor(config: OpenAICompatibleProviderConfig, fetchImpl: FetchImplementation = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref();

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userText },
          ],
          max_tokens: this.config.maxOutputTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI provider request failed with HTTP ${response.status}`);
      }

      const payload: unknown = await response.json();
      const text = extractText(payload)?.trim();
      if (!text) throw new Error('AI provider returned no text');

      const responseModel = isRecord(payload) && typeof payload.model === 'string' ? payload.model : undefined;
      return { text, model: responseModel ?? this.config.model };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('AI provider request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
