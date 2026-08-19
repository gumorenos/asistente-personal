import type { AppDatabase } from './db.ts';

export interface NoteRecord {
  id: number;
  body: string;
  status: string;
  createdAt: string;
}

export class NoteRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(body: string): number {
    const result = this.database.native
      .prepare('INSERT INTO notes(body) VALUES (?)')
      .run(body.trim());
    return Number(result.lastInsertRowid);
  }

  listActive(limit = 10): NoteRecord[] {
    const rows = this.database.native
      .prepare(`
        SELECT id, body, status, created_at
        FROM notes
        WHERE status = 'active'
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as Array<{ id: number; body: string; status: string; created_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
    }));
  }
}
