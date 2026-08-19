import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { RetentionRepository, RetentionResult } from '../database/retention-repository.ts';

export interface RetentionPolicy {
  messageDays: number;
  outboundDays: number;
  auditDays: number;
  briefingDays: number;
}

export class RetentionScheduler {
  private readonly retention: RetentionRepository;
  private readonly audit: AuditRepository;
  private readonly policy: RetentionPolicy;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    retention: RetentionRepository,
    audit: AuditRepository,
    policy: RetentionPolicy,
    now: () => Date = () => new Date(),
  ) {
    this.retention = retention;
    this.audit = audit;
    this.policy = policy;
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

  async runOnce(): Promise<RetentionResult | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      const now = this.now();
      const dayMs = 24 * 60 * 60 * 1_000;
      const result = this.retention.purge({
        messageBeforeEpochSeconds: Math.floor((now.getTime() - this.policy.messageDays * dayMs) / 1_000),
        outboundBeforeIso: new Date(now.getTime() - this.policy.outboundDays * dayMs).toISOString(),
        auditBeforeIso: new Date(now.getTime() - this.policy.auditDays * dayMs).toISOString(),
        briefingBeforeIso: new Date(now.getTime() - this.policy.briefingDays * dayMs).toISOString(),
      });
      this.audit.record({
        eventType: 'retention.purged',
        entityType: 'retention',
        metadata: result,
      });
      return result;
    } catch (error) {
      logger.warn('Retention purge failed', { error: error instanceof Error ? error.name : 'unknown' });
      return undefined;
    } finally {
      this.running = false;
    }
  }
}
