import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('semantic and embeddings are disabled by default with conservative chunk settings', () => {
  const config = loadConfig({});
  assert.equal(config.semantic.enabled, false);
  assert.equal(config.semantic.embeddings.enabled, false);
  assert.equal(config.semantic.chunkMaxChars, 1_200);
  assert.equal(config.semantic.chunkOverlapChars, 200);
  assert.equal(config.semantic.maxChunks, 100);
  assert.equal(config.semantic.embeddings.dimensions, 1_024);
});

test('semantic indexing requires document ingestion and embeddings require semantic opt-in', () => {
  assert.throws(() => loadConfig({ SEMANTIC_ENABLED: 'true' }), /DOCUMENTS_ENABLED=true/);
  assert.throws(() => loadConfig({ DOCUMENTS_ENABLED: 'true', EMBEDDINGS_ENABLED: 'true' }), /SEMANTIC_ENABLED=true/);
});

test('remote embeddings require HTTPS, model and API key while loopback HTTP may omit key', () => {
  const base = {
    DOCUMENTS_ENABLED: 'true',
    SEMANTIC_ENABLED: 'true',
    EMBEDDINGS_ENABLED: 'true',
    EMBEDDINGS_MODEL: 'embed-v1',
    EMBEDDINGS_DIMENSIONS: '3',
  };
  assert.throws(() => loadConfig({ ...base, EMBEDDINGS_BASE_URL: 'http://example.com/v1', EMBEDDINGS_API_KEY: 'x' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...base, EMBEDDINGS_BASE_URL: 'https://example.com/v1' }), /EMBEDDINGS_API_KEY/);
  assert.throws(() => loadConfig({ ...base, EMBEDDINGS_BASE_URL: 'https://example.com/v1', EMBEDDINGS_API_KEY: 'x', EMBEDDINGS_MODEL: '' }), /EMBEDDINGS_MODEL/);

  const loopback = loadConfig({ ...base, EMBEDDINGS_BASE_URL: 'http://127.0.0.1:9999/v1' });
  assert.equal(loopback.semantic.embeddings.enabled, true);
  assert.equal(loopback.semantic.embeddings.apiKey, undefined);
});

test('semantic resource bounds and overlap relationship are validated', () => {
  const base = { DOCUMENTS_ENABLED: 'true', SEMANTIC_ENABLED: 'true' };
  assert.throws(() => loadConfig({ ...base, SEMANTIC_CHUNK_MAX_CHARS: '199' }), /SEMANTIC_CHUNK_MAX_CHARS/);
  assert.throws(() => loadConfig({ ...base, SEMANTIC_CHUNK_MAX_CHARS: '400', SEMANTIC_CHUNK_OVERLAP_CHARS: '200' }), /less than half/);
  assert.throws(() => loadConfig({ ...base, SEMANTIC_MAX_CHUNKS: '501' }), /SEMANTIC_MAX_CHUNKS/);
  assert.throws(() => loadConfig({ ...base, EMBEDDINGS_DIMENSIONS: '0' }), /EMBEDDINGS_DIMENSIONS/);
  assert.throws(() => loadConfig({ ...base, EMBEDDINGS_BATCH_SIZE: '101' }), /EMBEDDINGS_BATCH_SIZE/);
});
