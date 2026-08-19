import type { AppDatabase } from './db.ts';

export type ActionRequestStatus = 'pending' | 'approved' | 'rejected';
export type ActionDecision = Exclude<ActionRequestStatus, 'pending'>;

export interface ActionRequestInput {
  actionType: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface ActionRequestRecord extends ActionRequestInput {
  id: number;
  status: ActionRequestStatus;
  createdAt: string;
  decidedAt?: string;
}

interface RawActionRequestRow {
  id: number;
  action_type: string;
  summary: string;
  payload_json: string;
  status: ActionRequestStatus;
  created_at: string;
  decided_at: string | null;
}

const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;
const MAX_SUMMARY_CHARS = 500;
const MAX_PAYLOAD_CHARS = 20_000;

export class ActionRequestRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(input: ActionRequestInput): number {
    const actionType = input.actionType.trim().toLowerCase();
    const summary = input.summary.trim();
    if (!ACTION_TYPE_PATTERN.test(actionType)) throw new Error('Invalid action type');
    if (!summary || summary.length > MAX_SUMMARY_CHARS) throw new Error('Invalid action summary');

    const payloadJson = JSON.stringify(input.payload);
    if (payloadJson.length > MAX_PAYLOAD_CHARS) throw new Error('Action payload is too large');

    const result = this.database.native
      .prepare(`
        INSERT INTO action_requests(action_type, summary, payload_json)
        VALUES (?, ?, ?)
      `)
      .run(actionType, summary, payloadJson);
    return Number(result.lastInsertRowid);
  }

  getById(id: number): ActionRequestRecord | undefined {
    const row = this.database.native
      .prepare(`
        SELECT id, action_type, summary, payload_json, status, created_at, decided_at
        FROM action_requests
        WHERE id = ?
      `)
      .get(id) as unknown as RawActionRequestRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listPending(limit = 10): ActionRequestRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, action_type, summary, payload_json, status, created_at, decided_at
        FROM action_requests
        WHERE status = 'pending'
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as unknown as RawActionRequestRow[];
    return rows.map(mapRow);
  }

  decide(id: number, decision: ActionDecision, decidedAt: string): ActionRequestRecord | undefined {
    const result = this.database.native
      .prepare(`
        UPDATE action_requests
        SET status = ?, decided_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `)
      .run(decision, decidedAt, id);
    if (result.changes !== 1) return undefined;
    return this.getById(id);
  }
}

function mapRow(row: RawActionRequestRow): ActionRequestRecord {
  return {
    id: row.id,
    actionType: row.action_type,
    summary: row.summary,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}
