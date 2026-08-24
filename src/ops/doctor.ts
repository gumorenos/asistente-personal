import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from '../config.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

function checkCommand(command: string, args: string[]): { ok: boolean; detail: string } {
  const result = spawnSync(command, args, { encoding: 'utf-8', timeout: 5_000 });
  if (result.error || result.status !== 0) return { ok: false, detail: 'not available' };
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split('\n').find(Boolean) ?? 'available';
  return { ok: true, detail: output.slice(0, 180) };
}

function add(checks: DoctorCheck[], name: string, status: DoctorStatus, detail: string): void {
  checks.push({ name, status, detail });
}

function inspectDatabase(config: AppConfig, checks: DoctorCheck[]): void {
  if (config.dbPath === ':memory:') {
    add(checks, 'database', 'warn', 'APP_DB_PATH=:memory: cannot be inspected out-of-process');
    return;
  }
  const path = resolve(config.dbPath);
  if (!existsSync(path)) {
    add(checks, 'database', 'fail', `database not found at ${path}`);
    return;
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
    const quick = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    add(checks, 'database.quick_check', quick?.quick_check === 'ok' ? 'pass' : 'fail', quick?.quick_check ?? 'unknown');

    const migration = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as
      | { version: number | bigint }
      | undefined;
    const version = Number(migration?.version ?? 0);
    add(checks, 'database.migrations', version >= 15 ? 'pass' : 'fail', `schema v${version}`);

    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
    add(checks, 'database.wal', journal?.journal_mode?.toLowerCase() === 'wal' ? 'pass' : 'warn', journal?.journal_mode ?? 'unknown');

    const secure = db.prepare('PRAGMA secure_delete').get() as { secure_delete?: number | bigint } | undefined;
    const secureValue = Number(secure?.secure_delete ?? 0);
    add(
      checks,
      'database.secure_delete',
      secureValue === 1 ? 'pass' : 'warn',
      secureValue === 1 ? 'read-only connection reports ON' : `read-only connection reports ${secureValue}; app sets ON at startup`,
    );

    const fk = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
    add(checks, 'database.foreign_keys', fk.length === 0 ? 'pass' : 'fail', `${fk.length} violation(s)`);

    db.prepare('SELECT COUNT(*) AS value FROM self_memory_fts').get();
    db.prepare('SELECT COUNT(*) AS value FROM observation_fts').get();
    add(checks, 'database.fts5', 'pass', 'self + observer indexes readable');

    const chunks = db.prepare('SELECT COUNT(*) AS value FROM document_chunks').get() as { value: number | bigint } | undefined;
    const embeddings = db.prepare('SELECT COUNT(*) AS value FROM document_embeddings').get() as { value: number | bigint } | undefined;
    add(checks, 'semantic.storage', 'pass', `${Number(chunks?.value ?? 0)} chunks / ${Number(embeddings?.value ?? 0)} embeddings`);

    const creds = db.prepare('SELECT COUNT(*) AS value FROM whatsapp_auth_creds').get() as { value: number | bigint } | undefined;
    const credentialCount = Number(creds?.value ?? 0);
    add(
      checks,
      'whatsapp.auth',
      config.whatsapp.enabled && credentialCount === 0 ? 'warn' : 'pass',
      config.whatsapp.enabled ? `${credentialCount} credential row(s)` : 'transport disabled',
    );
  } catch (error) {
    add(checks, 'database.inspect', 'fail', error instanceof Error ? error.message : String(error));
  } finally {
    db?.close();
  }
}

export function runDoctor(env: NodeJS.ProcessEnv = process.env): DoctorReport {
  const checks: DoctorCheck[] = [];
  let config: AppConfig;
  try {
    config = loadConfig(env);
    add(checks, 'config', 'pass', 'configuration valid');
  } catch (error) {
    add(checks, 'config', 'fail', error instanceof Error ? error.message : String(error));
    return { ok: false, checks };
  }

  inspectDatabase(config, checks);

  if (config.documents.enabled) {
    for (const command of ['pdfinfo', 'pdftotext']) {
      const result = checkCommand(command, ['-v']);
      add(checks, `tool.${command}`, result.ok ? 'pass' : 'fail', result.detail);
    }
  } else {
    add(checks, 'tools.poppler', 'pass', 'documents disabled; tools not required');
  }

  if (config.documents.ocr.enabled) {
    const tesseract = checkCommand('tesseract', ['--version']);
    add(checks, 'tool.tesseract', tesseract.ok ? 'pass' : 'fail', tesseract.detail);
    const langs = spawnSync('tesseract', ['--list-langs'], { encoding: 'utf-8', timeout: 5_000 });
    const output = `${langs.stdout ?? ''}\n${langs.stderr ?? ''}`;
    const required = config.documents.ocr.languages.split('+');
    const missing = required.filter((language) => !new RegExp(`(^|\\s)${language}(\\s|$)`, 'm').test(output));
    add(checks, 'tool.tesseract.languages', missing.length === 0 ? 'pass' : 'fail', missing.length ? `missing: ${missing.join(',')}` : required.join('+'));
  } else {
    add(checks, 'tools.ocr', 'pass', 'OCR disabled; Tesseract not required');
  }

  add(checks, 'feature.ai', 'pass', config.ai.enabled ? 'enabled (connectivity not tested)' : 'disabled');
  add(checks, 'feature.transcription', 'pass', config.transcription.enabled ? 'enabled (connectivity not tested)' : 'disabled');
  add(checks, 'feature.semantic', 'pass', config.semantic.enabled ? 'enabled' : 'disabled');
  add(checks, 'feature.embeddings', 'pass', config.semantic.embeddings.enabled ? 'enabled (connectivity not tested)' : 'disabled');
  add(checks, 'feature.calendar', 'pass', config.calendar.enabled ? 'enabled (connectivity not tested)' : 'disabled');
  add(checks, 'feature.observer', 'pass', config.observer.enabled ? 'enabled' : 'disabled');
  add(checks, 'feature.document_retention', 'pass', config.documents.retention.enabled ? `enabled (${config.documents.retention.days} days)` : 'disabled');

  return { ok: !checks.some((check) => check.status === 'fail'), checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runDoctor();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      const marker = check.status === 'pass' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
      console.log(`${marker.padEnd(4)} ${check.name.padEnd(30)} ${check.detail}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}
