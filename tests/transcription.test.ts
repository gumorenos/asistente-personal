import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioTranscriptionCapability } from '../src/capabilities/audio-transcription-capability.ts';
import type { IncomingMessage } from '../src/core/types.ts';
import { AuditRepository } from '../src/database/audit-repository.ts';
import { AppDatabase } from '../src/database/db.ts';
import { OpenAICompatibleTranscriptionProvider } from '../src/transcription/openai-compatible-provider.ts';
import type { TranscriptionInput, TranscriptionProvider, TranscriptionResult } from '../src/transcription/types.ts';

function audioMessage(loadMedia?: IncomingMessage['loadMedia']): IncomingMessage {
  return {
    id: 'audio-1',
    chatId: '51999999999@s.whatsapp.net',
    timestamp: 1,
    text: '',
    kind: 'audio',
    fromMe: true,
    isGroup: false,
    loadMedia,
  };
}

class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'fake-transcription';
  readonly calls: TranscriptionInput[] = [];
  response: TranscriptionResult = { text: 'texto transcrito', model: 'fake-whisper' };
  error?: Error;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.response;
  }
}

function setup(provider?: TranscriptionProvider, enabled = true, maxBytes = 100, maxTranscriptChars = 100) {
  const db = new AppDatabase(':memory:');
  const audit = new AuditRepository(db);
  const capability = new AudioTranscriptionCapability(provider, audit, { enabled, maxBytes, maxTranscriptChars });
  return { db, audit, capability };
}

test('transcription capability ignores non-audio messages', async () => {
  const provider = new FakeTranscriptionProvider();
  const { db, capability } = setup(provider);
  const message = { ...audioMessage(), kind: 'text' as const, text: 'hola' };
  assert.equal(await capability.handle(message), undefined);
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('disabled transcription does not load or upload audio', async () => {
  const provider = new FakeTranscriptionProvider();
  let loaded = false;
  const { db, capability } = setup(provider, false);
  const result = await capability.handle(audioMessage(async () => {
    loaded = true;
    return { data: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg' };
  }));
  assert.match(result?.reply ?? '', /deshabilitada/);
  assert.equal(loaded, false);
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('enabled transcription loads media once, returns text and audits without content', async () => {
  const provider = new FakeTranscriptionProvider();
  let loads = 0;
  const { db, audit, capability } = setup(provider);
  const result = await capability.handle(audioMessage(async () => {
    loads += 1;
    return { data: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg', fileName: 'voice.ogg' };
  }));

  assert.equal(loads, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.fileName, 'voice.ogg');
  assert.match(result?.reply ?? '', /texto transcrito/);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /transcription\.request\.succeeded/);
  assert.doesNotMatch(auditJson, /texto transcrito|voice\.ogg/);
  db.close();
});

test('oversized audio is rejected before provider upload', async () => {
  const provider = new FakeTranscriptionProvider();
  const { db, capability } = setup(provider, true, 2);
  const result = await capability.handle(audioMessage(async () => ({ data: new Uint8Array([1, 2, 3]) })));
  assert.match(result?.reply ?? '', /supera el límite/);
  assert.equal(provider.calls.length, 0);
  db.close();
});

test('transcription provider failure is safe and does not audit error content', async () => {
  const provider = new FakeTranscriptionProvider();
  provider.error = new Error('upstream echoed private audio transcript');
  const { db, audit, capability } = setup(provider);
  const result = await capability.handle(audioMessage(async () => ({ data: new Uint8Array([1]) })));
  assert.match(result?.reply ?? '', /No pude transcribir/);
  const auditJson = JSON.stringify(audit.listRecent());
  assert.match(auditJson, /transcription\.request\.failed/);
  assert.doesNotMatch(auditJson, /private audio transcript/);
  db.close();
});

test('transcript output is bounded and never executed as a command', async () => {
  const provider = new FakeTranscriptionProvider();
  provider.response = { text: 'anota 1234567890', model: 'fake-whisper' };
  const { db, capability } = setup(provider, true, 100, 10);
  const result = await capability.handle(audioMessage(async () => ({ data: new Uint8Array([1]) })));
  assert.equal(result?.reply, '🎙️ Transcripción:\nanota 123…');
  db.close();
});

test('OpenAI-compatible transcription sends multipart audio without setting content-type manually', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = input instanceof Request ? input.url : String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ text: 'hola', model: 'served-whisper' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const provider = new OpenAICompatibleTranscriptionProvider({
    baseUrl: 'https://audio.example.test/v1',
    apiKey: 'test-key',
    model: 'requested-whisper',
    timeoutMs: 5_000,
  }, fakeFetch);
  const result = await provider.transcribe({
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/ogg',
    fileName: 'voice.ogg',
  });

  assert.deepEqual(result, { text: 'hola', model: 'served-whisper' });
  assert.equal(capturedUrl, 'https://audio.example.test/v1/audio/transcriptions');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-key');
  assert.equal(headers.get('content-type'), null);
  assert.ok(capturedInit?.body instanceof FormData);
  const form = capturedInit.body as FormData;
  assert.equal(form.get('model'), 'requested-whisper');
  assert.ok(form.get('file') instanceof Blob);
});

test('transcription HTTP errors expose status but never upstream body', async () => {
  const fakeFetch = (async () => new Response('private transcript echo', { status: 429 })) as typeof fetch;
  const provider = new OpenAICompatibleTranscriptionProvider({
    baseUrl: 'https://audio.example.test/v1',
    apiKey: 'test-key',
    model: 'whisper',
    timeoutMs: 5_000,
  }, fakeFetch);

  await assert.rejects(
    () => provider.transcribe({ data: new Uint8Array([1]), mimeType: 'audio/ogg', fileName: 'voice.ogg' }),
    (error: unknown) => error instanceof Error && /HTTP 429/.test(error.message) && !/private transcript/.test(error.message),
  );
});
