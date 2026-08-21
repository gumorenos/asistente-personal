import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { SqliteObservationSink } from '../observer/sqlite-observation-sink.ts';

export class ObserverRetentionScheduler {
  private readonly sink: SqliteObservationSink;
  private readonly audit: AuditRepository;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    sink: SqliteObservationSink,
    audit: AuditRepository,
    now: () => Date = () => new Date(),
  ) {
    this.sink = sink;
    this.audit = audit;
    this.now = now;
  }

  start(intervalMs = 60 * 60 * 1_000): void {
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

  async runOnce(): Promise<number | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      const purged = this.sink.purgeExpired(Math.floor(this.now().getTime() / 1_000));
      this.audit.record({
        eventType: 'observer.retention.purged',
        entityType: 'observer',
        metadata: { purged },
      });
      return purged;
    } catch (error) {
      logger.warn('Observer retention purge failed', { error: error instanceof Error ? error.name : 'unknown' });
      return undefined;
    } finally {
      this.running = false;
    }
  }
}
