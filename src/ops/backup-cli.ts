import { resolve } from 'node:path';
import { createDatabaseBackup, verifyDatabaseBackup } from './backup-service.ts';

function defaultBackupPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(`./backups/assistant-${stamp}.db`);
}

const command = process.argv[2] ?? 'create';
try {
  if (command === 'create') {
    const source = process.env.APP_DB_PATH ?? './data/assistant.db';
    const destination = process.argv[3] ?? defaultBackupPath();
    const report = await createDatabaseBackup(source, destination);
    console.log(JSON.stringify({ status: 'ok', operation: 'backup', ...report }, null, 2));
  } else if (command === 'verify') {
    const path = process.argv[3];
    if (!path) throw new Error('Usage: npm run backup:verify -- <backup.db>');
    const report = verifyDatabaseBackup(path);
    console.log(JSON.stringify({ status: 'ok', operation: 'verify', ...report }, null, 2));
  } else {
    throw new Error('Usage: backup-cli.ts create [destination.db] | verify <backup.db>');
  }
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    operation: command,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
}
