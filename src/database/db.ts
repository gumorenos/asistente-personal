import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.ts';
import { runStage4Migration } from './stage4-migration.ts';

export class AppDatabase {
  readonly native: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path === ':memory:' ? path : resolve(path);

    if (this.path !== ':memory:') {
      const directory = dirname(this.path);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        chmodSync(directory, 0o700);
      } catch {
        // Filesystems such as mounted volumes may not allow chmod. Deployment QA covers permissions.
      }
    }

    this.native = new DatabaseSync(this.path, { timeout: 5_000 });
    this.native.exec('PRAGMA journal_mode = WAL;');
    this.native.exec('PRAGMA foreign_keys = ON;');
    this.native.exec('PRAGMA busy_timeout = 5000;');
    runMigrations(this.native);
    runStage4Migration(this.native);
  }

  ping(): boolean {
    const row = this.native.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return row?.ok === 1;
  }

  close(): void {
    if (this.native.isOpen) this.native.close();
  }
}
