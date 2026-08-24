import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleEmbeddingProvider } from '../src/semantic/openai-compatible-embedding-provider.ts';

test('embedding provider sends only model and requested input and preserves response order', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody: unknown;
  let capturedAuth = '';
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({
      data: [
        { index: 1, embedding: [0, 1, 0] },
        { index: 0, embedding: [1, 0, 0] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: 'https://embeddings.example.test/v1/',
      apiKey: 'secret-key',
      model: 'embed-test',
      dimensions: 3,
      timeoutMs: 2_000,
    });
    const result = await provider.embed(['uno', 'dos']);
    assert.equal(capturedUrl, 'https://embeddings.example.test/v1/embeddings');
    assert.equal(capturedAuth, 'Bearer secret-key');
    assert.deepEqual(capturedBody, { model: 'embed-test', input: ['uno', 'dos'] });
    assert.deepEqual(result, [[1, 0, 0], [0, 1, 0]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('embedding provider validates count, dimensions and finite values', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [
      { data: [] },
      { data: [{ index: 0, embedding: [1, 2] }] },
      { data: [{ index: 0, embedding: [1, Number.NaN, 3] }] },
    ]) {
      globalThis.fetch = (async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', dimensions: 3, timeoutMs: 2_000,
      });
      await assert.rejects(() => provider.embed(['texto']));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('embedding provider HTTP failures expose status but never upstream response body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('SUPER_PRIVATE_PROVIDER_ERROR', { status: 429 })) as typeof fetch;
  try {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: 'http://127.0.0.1:9999/v1', model: 'test', dimensions: 3, timeoutMs: 2_000,
    });
    await assert.rejects(
      () => provider.embed(['texto']),
      (error: unknown) => error instanceof Error && /HTTP 429/.test(error.message) && !error.message.includes('SUPER_PRIVATE_PROVIDER_ERROR'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
