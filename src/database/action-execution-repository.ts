import type { AppDatabase } from './db.ts';

export type ActionExecutionStatus = 'started' | 'succeeded' | 'failed';

export interface ActionExecutionRecord {
  actionRequestId: number;
  idempotencyKey: string;
  provider: string;
  status: ActionExecutionStatus;
  attemptCount: number;
  externalId?: string;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
}

export type BeginExecutionResult =
  | { state: 'started'; record: ActionExecutionRecord }
  | { state: 'already_started'; record: ActionExecutionRecord }
  | { state: 'already_succeeded'; record: ActionExecutionRecord };

interface RawExecutionRow {
  action_request_id: number;
  idempotency_key: string;
  provider: string;
  status: ActionExecutionStatus;
  attempt_count: number;
  external_id: string | null;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
}

export class ActionExecutionRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  getByActionId(actionRequestId: number): ActionExecutionRecord | undefined {
    const row = this.database.native
      .prepare(`
        SELECT action_request_id, idempotency_key, provider, status, attempt_count,
               external_id, error_code, started_at, completed_at
        FROM action_executions
        WHERE action_request_id = ?
      `)
      .get(actionRequestId) as unknown as RawExecutionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  beginApproved(
    actionRequestId: number,
    provider: string,
    idempotencyKey: string,
    startedAt: string,
    staleBeforeIso: string,
  ): BeginExecutionResult {
    this.database.native.exec('BEGIN IMMEDIATE');
    try {
      const action = this.database.native
        .prepare('SELECT status FROM action_requests WHERE id = ?')
        .get(actionRequestId) as { status: string } | undefined;
      if (action?.status !== 'approved') throw new Error('Action is not approved');

      const existing = this.getByActionId(actionRequestId);
      if (!existing) {
        this.database.native
          .prepare(`
            INSERT INTO action_executions(
              action_request_id, idempotency_key, provider, status, attempt_count, started_at
            ) VALUES (?, ?, ?, 'started', 1, ?)
          `)
          .run(actionRequestId, idempotencyKey, provider, startedAt);
        const record = this.getByActionId(actionRequestId);
        if (!record) throw new Error('Could not create execution record');
        this.database.native.exec('COMMIT');
        return { state: 'started', record };
      }

      if (existing.idempotencyKey !== idempotencyKey || existing.provider !== provider) {
        throw new Error('Execution identity mismatch');
      }
      if (existing.status === 'succeeded') {
        this.database.native.exec('COMMIT');
        return { state: 'already_succeeded', record: existing };
      }
      if (existing.status === 'started' && existing.startedAt > staleBeforeIso) {
        this.database.native.exec('COMMIT');
        return { state: 'already_started', record: existing };
      }

      const retryableStatus = existing.status === 'failed' || existing.status === 'started';
      if (!retryableStatus) throw new Error('Execution is not retryable');

      const result = this.database.native
        .prepare(`
          UPDATE action_executions
          SET status = 'started', attempt_count = attempt_count + 1,
              error_code = NULL, external_id = NULL,
              started_at = ?, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE action_request_id = ? AND status IN ('failed', 'started')
        `)
        .run(startedAt, actionRequestId);
      if (result.changes !== 1) throw new Error('Could not acquire execution lease');

      const retried = this.getByActionId(actionRequestId);
      if (!retried) throw new Error('Could not retry execution');
      this.database.native.exec('COMMIT');
      return { state: 'started', record: retried };
    } catch (error) {
      this.database.native.exec('ROLLBACK');
      throw error;
    }
  }

  markSucceeded(actionRequestId: number, externalId: string, completedAt: string): boolean {
    const result = this.database.native
      .prepare(`
        UPDATE action_executions
        SET status = 'succeeded', external_id = ?, error_code = NULL,
            completed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE action_request_id = ? AND status = 'started'
      `)
      .run(externalId, completedAt, actionRequestId);
    return result.changes === 1;
  }

  markFailed(actionRequestId: number, errorCode: string, completedAt: string): boolean {
    const result = this.database.native
      .prepare(`
        UPDATE action_executions
        SET status = 'failed', error_code = ?, external_id = NULL,
            completed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE action_request_id = ? AND status = 'started'
      `)
      .run(errorCode.slice(0, 80), completedAt, actionRequestId);
    return result.changes === 1;
  }
}

function mapRow(row: RawExecutionRow): ActionExecutionRecord {
  return {
    actionRequestId: row.action_request_id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    status: row.status,
    attemptCount: row.attempt_count,
    externalId: row.external_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}
