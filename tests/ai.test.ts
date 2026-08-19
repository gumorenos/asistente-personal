import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from '../src/ai/openai-compatible-provider.ts';
import type { AiGenerateInput, AiGenerateResult, AiProvider } from '../src/ai/types.ts';
import { AiCapability } from '../src/capabilities/ai-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';

function message(text: string): IncomingMessage {
  return {
    id: `ai-${text}`,
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text,
    kind: 'text',
    fromMe: true,
    isGroup: false,
  };
}

class FakeProvider implements AiProvider {
  readonly name = 'fake-provider';
  readonly calls: AiGenerateInput[] = [];
  response: AiGenerateResult = { text: 'respuesta de prueba', model: 'fake-model' };
  error?: Error;

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.response;
  }
}

function setup(provider?: AiProvider, enabled = true, maxInputChars = 100, maxReplyChars = 100) {
  const db = new AppDatabase(':memory:');
  const audit = new AuditRepository(db);
  const capability = new AiCapability(provider, audit, { enabled, maxInputChars, maxReplyChars });
  return { db, audit, capability };
}

test('AI capability is explicit-only and ignores ordinary text', async () => {
  const provider = new FakeProvider();
  const { db, capability } = setup(provider);
  assert.equal(await capability.handle(message('resume esta idea')), undefined);
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('disabled AI handles explicit command locally without provider call', async () => {
  const provider = new FakeProvider();
  const { db, capability } = setup(provider, false);
  const result = await capability.handle(message('ia hola'));
  assert.match(result?.reply ?? '', /deshabilitada/);
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('explicit AI sends only the current prompt and audits metadata without prompt content', async () => {
  const provider = new FakeProvider();
  const { db, audit, capability } = setup(provider);
  const result = await capability.handle(message('ia dato secreto del usuario'));

  assert.match(result?.reply ?? '', /respuesta de prueba/);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.userText, 'dato secreto del usuario');
  assert.match(provider.calls[0]?.systemPrompt ?? '', /No tienes herramientas/);

  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /ai\.request\.succeeded/);
  assert.match(auditJson, /ai\.request\.started/);
  assert.doesNotMatch(auditJson, /dato secreto del usuario/);
  db.close();
});

test('AI input and output are bounded', async () => {
  const provider = new FakeProvider();
  provider.response = { text: '1234567890', model: 'fake-model' };
  const { db, capability } = setup(provider, true, 5, 6);

  const rejected = await capability.handle(message('ia 123456'));
  assert.match(rejected?.reply ?? '', /límite de 5/);
  assert.equal(provider.calls.length, 0);

  const accepted = await capability.handle(message('ia 12345'));
  assert.equal(accepted?.reply, '🤖 12345…');
  db.close();
});

test('AI provider failures return a safe local error and are audited without provider error text', async () => {
  const provider = new FakeProvider();
  provider.error = new Error('upstream leaked: dato secreto');
  const { db, audit, capability } = setup(provider);
  const result = await capability.handle(message('ia pregunta privada'));

  assert.match(result?.reply ?? '', /No pude obtener respuesta/);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /ai\.request\.failed/);
  assert.doesNotMatch(auditJson, /dato secreto/);
  assert.doesNotMatch(auditJson, /pregunta privada/);
  db.close();
});

test('OpenAI-compatible provider sends minimal chat-completions payload', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = input instanceof Request ? input.url : String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      model: 'served-model',
      choices: [{ message: { content: 'hola desde proveedor' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://ai.example.test/v1',
    apiKey: 'test-key',
    model: 'requested-model',
    timeoutMs: 5_000,
    maxOutputTokens: 128,
  }, fakeFetch);

  const result = await provider.generate({ userText: 'hola', systemPrompt: 'sistema' });
  assert.deepEqual(result, { text: 'hola desde proveedor', model: 'served-model' });
  assert.equal(capturedUrl, 'https://ai.example.test/v1/chat/completions');
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer test-key');
  const body = JSON.parse(String(capturedInit?.body)) as { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number };
  assert.equal(body.model, 'requested-model');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'sistema' },
    { role: 'user', content: 'hola' },
  ]);
  assert.equal(body.max_tokens, 128);
});

test('OpenAI-compatible provider never includes upstream response body in HTTP error', async () => {
  const fakeFetch = (async () => new Response('echo de contenido privado', { status: 503 })) as typeof fetch;
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://ai.example.test/v1',
    apiKey: 'test-key',
    model: 'model',
    timeoutMs: 5_000,
    maxOutputTokens: 128,
  }, fakeFetch);

  await assert.rejects(
    () => provider.generate({ userText: 'secreto', systemPrompt: 'sistema' }),
    (error: unknown) => error instanceof Error
      && /HTTP 503/.test(error.message)
      && !/contenido privado|secreto/.test(error.message),
  );
});
