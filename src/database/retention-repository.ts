import type { AppDatabase } from './db.ts';

export interface RetentionCutoffs {
  messageBeforeEpochSeconds: number;
  outboundBeforeIso: string;
  auditBeforeIso: string;
  briefingBeforeIso: string;
}

export interface RetentionResult {
  messages: number;
  outbound: number;
  audit: number;
  briefings: number;
}

export class RetentionRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  purge(cutoffs: RetentionCutoffs): RetentionResult {
    this.database.native.exec('BEGIN IMMEDIATE');
    try {
      const messages = Number(this.database.native
        .prepare('DELETE FROM messages WHERE timestamp < ?')
        .run(cutoffs.messageBeforeEpochSeconds).changes);
      const outbound = Number(this.database.native
        .prepare('DELETE FROM assistant_outbound WHERE created_at < datetime(?)')
        .run(cutoffs.outboundBeforeIso).changes);
      const audit = Number(this.database.native
        .prepare('DELETE FROM audit_log WHERE created_at < datetime(?)')
        .run(cutoffs.auditBeforeIso).changes);
      const briefings = Number(this.database.native
        .prepare('DELETE FROM briefing_deliveries WHERE datetime(delivered_at) < datetime(?)')
        .run(cutoffs.briefingBeforeIso).changes);
      this.database.native.exec('COMMIT');
      return { messages, outbound, audit, briefings };
    } catch (error) {
      this.database.native.exec('ROLLBACK');
      throw error;
    }
  }
}
