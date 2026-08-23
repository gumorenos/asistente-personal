import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

test('document OCR is disabled by default with conservative local defaults', () => {
  const config = loadConfig({});
  assert.equal(config.documents.enabled, false);
  assert.equal(config.documents.ocr.enabled, false);
  assert.equal(config.documents.ocr.maxPages, 10);
  assert.equal(config.documents.ocr.dpi, 180);
  assert.equal(config.documents.ocr.languages, 'spa+eng');
  assert.equal(config.documents.ocr.timeoutMs, 60_000);
});

test('OCR cannot be enabled unless document ingestion is enabled', () => {
  assert.throws(
    () => loadConfig({ DOCUMENTS_OCR_ENABLED: 'true' }),
    /DOCUMENTS_ENABLED=true is required/,
  );

  const config = loadConfig({
    DOCUMENTS_ENABLED: 'true',
    DOCUMENTS_OCR_ENABLED: 'true',
    DOCUMENTS_OCR_MAX_PAGES: '8',
    DOCUMENTS_OCR_DPI: '200',
    DOCUMENTS_OCR_LANGUAGES: 'spa+eng',
    DOCUMENTS_OCR_TIMEOUT_MS: '90000',
  });
  assert.equal(config.documents.enabled, true);
  assert.equal(config.documents.ocr.enabled, true);
  assert.equal(config.documents.ocr.maxPages, 8);
  assert.equal(config.documents.ocr.dpi, 200);
  assert.equal(config.documents.ocr.languages, 'spa+eng');
  assert.equal(config.documents.ocr.timeoutMs, 90_000);
});

test('OCR configuration rejects unsupported languages and resource limits', () => {
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_LANGUAGES: 'spa;curl x' }), /DOCUMENTS_OCR_LANGUAGES/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_LANGUAGES: 'fra' }), /supports only spa and eng/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_LANGUAGES: 'spa+spa' }), /supports only spa and eng/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_MAX_PAGES: '51' }), /DOCUMENTS_OCR_MAX_PAGES/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_DPI: '99' }), /DOCUMENTS_OCR_DPI/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_DPI: '301' }), /DOCUMENTS_OCR_DPI/);
  assert.throws(() => loadConfig({ DOCUMENTS_OCR_TIMEOUT_MS: '999' }), /DOCUMENTS_OCR_TIMEOUT_MS/);
});
