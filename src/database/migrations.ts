import type { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        chat_id_alt TEXT,
        sender_id TEXT,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        from_me INTEGER NOT NULL CHECK (from_me IN (0,1)),
        is_group INTEGER NOT NULL CHECK (is_group IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS assistant_outbound (
        message_id TEXT PRIMARY KEY,
        destination TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'PEN',
        category TEXT,
        description TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS whatsapp_auth_creds (
        session_id TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE TABLE IF NOT EXISTS whatsapp_auth_keys (
        session_id TEXT NOT NULL,
        category TEXT NOT NULL,
        key_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, category, key_id)
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE reminders ADD COLUMN chat_id TEXT;
      ALTER TABLE reminders ADD COLUMN delivered_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at)
        WHERE status = 'pending' AND due_at IS NOT NULL;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_expenses_occurred_at ON expenses(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_category_occurred ON expenses(category, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS action_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_action_requests_status_created ON action_requests(status, id DESC);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE action_requests ADD COLUMN expires_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_action_requests_pending_expiry
        ON action_requests(status, expires_at) WHERE status = 'pending';
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS action_executions (
        action_request_id INTEGER PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
        external_id TEXT,
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (action_request_id) REFERENCES action_requests(id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_action_executions_status ON action_executions(status, updated_at DESC);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS briefing_deliveries (
        local_date TEXT PRIMARY KEY,
        destination TEXT NOT NULL,
        message_id TEXT,
        delivered_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS observed_chats (
        jid TEXT PRIMARY KEY,
        label TEXT,
        retention_days INTEGER NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 90),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_observed_chats_enabled ON observed_chats(enabled, jid);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS observations (
        chat_jid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sender_id TEXT,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
        kind TEXT NOT NULL CHECK (kind = 'text'),
        is_group INTEGER NOT NULL CHECK (is_group IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_jid, message_id),
        FOREIGN KEY (chat_jid) REFERENCES observed_chats(jid) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_observations_chat_timestamp
        ON observations(chat_jid, timestamp DESC);
    `,
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(migration.version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
