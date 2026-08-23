import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentPurgeResult, DocumentRepository } from '../database/document-repository.ts';

export class DocumentRetentionScheduler {
  private readonly documents: DocumentRepository;
  private readonly audit: AuditRepository;
  private readonly retentionDays: number;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    documents: DocumentRepository,
    audit: AuditRepository,
    retentionDays: number,
    now: () => Date = () => new Date(),
  ) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
      throw new Error('Invalid document retention days');
    }
    this.documents = documents;
    this.audit = audit;
    this.retentionDays = retentionDays;
    this.now = now;
  }

  start(intervalMs = 24 * 60 * 60 * 1_000): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<DocumentPurgeResult | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      const cutoff = new Date(this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1_000);
      const result = this.documents.purgeCreatedBefore(cutoff.toISOString());
      this.audit.record({
        eventType: 'document.retention.purged',
        entityType: 'document_retention',
        metadata: { deleted: result.deleted, walCheckpointed: result.walCheckpointed },
      });
      return result;
    } catch (error) {
      logger.warn('Document retention purge failed', { error: error instanceof Error ? error.name : 'unknown' });
      return undefined;
    } finally {
      this.running = false;
    }
  }
}
