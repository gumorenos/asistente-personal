import type { AppDatabase } from './db.ts';

export type CommitmentStatus = 'open' | 'completed' | 'cancelled';
export type CommitmentRescheduleReason = 'updated' | 'unchanged' | 'not_open';

export interface CommitmentInput {
  body: string;
  dueAt?: string;
}

export interface CommitmentRecord extends CommitmentInput {
  id: number;
  status: CommitmentStatus;
  notifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentRescheduleResult {
  changed: boolean;
  reason: CommitmentRescheduleReason;
  hadPreviousDueAt: boolean;
  notificationReset: boolean;
}

interface RawCommitmentRow {
  id: number;
  body: string;
  due_at: string | null;
  status: CommitmentStatus;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_BODY_CHARS = 2_000;

export class CommitmentRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(input: CommitmentInput): number {
    const body = input.body.trim();
    if (!body || body.length > MAX_BODY_CHARS) throw new Error('Invalid commitment body');
    if (input.dueAt && !Number.isFinite(new Date(input.dueAt).getTime())) throw new Error('Invalid commitment due date');

    const result = this.database.native.prepare(`
      INSERT INTO commitments(body, due_at)
      VALUES (?, ?)
    `).run(body, input.dueAt ?? null);
    return Number(result.lastInsertRowid);
  }

  getById(id: number): CommitmentRecord | undefined {
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    const row = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE id = ?
    `).get(id) as unknown as RawCommitmentRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listOpen(limit = 10): CommitmentRecord[] {
    validateLimit(limit);
    const rows = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE status = 'open'
      ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, id DESC
      LIMIT ?
    `).all(limit) as unknown as RawCommitmentRow[];
    return rows.map(mapRow);
  }

  listOpenDueBetween(startIso: string, endIso: string, limit = 10): CommitmentRecord[] {
    validateLimit(limit);
    validateIso(startIso, 'Invalid commitment range start');
    validateIso(endIso, 'Invalid commitment range end');
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) throw new Error('Invalid commitment range');

    const rows = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE status = 'open'
        AND due_at IS NOT NULL
        AND due_at >= ?
        AND due_at < ?
      ORDER BY due_at ASC, id ASC
      LIMIT ?
    `).all(startIso, endIso, limit) as unknown as RawCommitmentRow[];
    return rows.map(mapRow);
  }

  listOpenUndated(limit = 10): CommitmentRecord[] {
    validateLimit(limit);
    const rows = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE status = 'open' AND due_at IS NULL
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as unknown as RawCommitmentRow[];
    return rows.map(mapRow);
  }

  listOverdue(nowIso: string, limit = 10): CommitmentRecord[] {
    validateLimit(limit);
    validateIso(nowIso, 'Invalid commitment overdue boundary');
    const rows = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE status = 'open'
        AND due_at IS NOT NULL
        AND due_at <= ?
      ORDER BY due_at ASC, id ASC
      LIMIT ?
    `).all(nowIso, limit) as unknown as RawCommitmentRow[];
    return rows.map(mapRow);
  }

  listDueUnnotified(nowIso: string, limit = 20): CommitmentRecord[] {
    validateLimit(limit);
    validateIso(nowIso, 'Invalid commitment notification boundary');
    const rows = this.database.native.prepare(`
      SELECT id, body, due_at, status, notified_at, created_at, updated_at
      FROM commitments
      WHERE status = 'open'
        AND due_at IS NOT NULL
        AND due_at <= ?
        AND notified_at IS NULL
      ORDER BY due_at ASC, id ASC
      LIMIT ?
    `).all(nowIso, limit) as unknown as RawCommitmentRow[];
    return rows.map(mapRow);
  }

  markNotified(id: number, notifiedAt: string): boolean {
    if (!Number.isSafeInteger(id) || id < 1) return false;
    validateIso(notifiedAt, 'Invalid commitment notification timestamp');
    const result = this.database.native.prepare(`
      UPDATE commitments
      SET notified_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'open'
        AND due_at IS NOT NULL
        AND due_at <= ?
        AND notified_at IS NULL
    `).run(notifiedAt, id, notifiedAt);
    return Number(result.changes) === 1;
  }

  reschedule(id: number, dueAt: string): CommitmentRescheduleResult {
    if (!Number.isSafeInteger(id) || id < 1) {
      return { changed: false, reason: 'not_open', hadPreviousDueAt: false, notificationReset: false };
    }
    validateIso(dueAt, 'Invalid commitment reschedule date');

    const current = this.getById(id);
    if (!current || current.status !== 'open') {
      return {
        changed: false,
        reason: 'not_open',
        hadPreviousDueAt: Boolean(current?.dueAt),
        notificationReset: false,
      };
    }

    if (current.dueAt && new Date(current.dueAt).getTime() === new Date(dueAt).getTime()) {
      return {
        changed: false,
        reason: 'unchanged',
        hadPreviousDueAt: true,
        notificationReset: false,
      };
    }

    const result = this.database.native.prepare(`
      UPDATE commitments
      SET due_at = ?, notified_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'
    `).run(dueAt, id);

    const changed = Number(result.changes) === 1;
    return {
      changed,
      reason: changed ? 'updated' : 'not_open',
      hadPreviousDueAt: Boolean(current.dueAt),
      notificationReset: changed && Boolean(current.notifiedAt),
    };
  }

  setStatus(id: number, status: 'completed' | 'cancelled'): boolean {
    if (!Number.isSafeInteger(id) || id < 1) return false;
    const result = this.database.native.prepare(`
      UPDATE commitments
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'
    `).run(status, id);
    return Number(result.changes) === 1;
  }
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid commitment list limit');
}

function validateIso(value: string, message: string): void {
  if (!Number.isFinite(new Date(value).getTime())) throw new Error(message);
}

function mapRow(row: RawCommitmentRow): CommitmentRecord {
  return {
    id: row.id,
    body: row.body,
    dueAt: row.due_at ?? undefined,
    status: row.status,
    notifiedAt: row.notified_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
