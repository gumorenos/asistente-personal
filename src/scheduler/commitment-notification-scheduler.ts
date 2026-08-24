import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { CommitmentRepository } from '../database/commitment-repository.ts';
import type { MessageTransport } from '../transports/types.ts';

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_BATCH = 20;

export class CommitmentNotificationScheduler {
  private readonly commitments: CommitmentRepository;
  private readonly transport: MessageTransport;
  private readonly audit: AuditRepository;
  private readonly destinationJid: string;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;

  constructor(
    commitments: CommitmentRepository,
    transport: MessageTransport,
    audit: AuditRepository,
    destinationJid: string,
    now: () => Date = () => new Date(),
  ) {
    this.commitments = commitments;
    this.transport = transport;
    this.audit = audit;
    this.destinationJid = destinationJid;
    this.now = now;
  }

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
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

  async runOnce(): Promise<void> {
    const now = this.now();
    const due = this.commitments.listDueUnnotified(now.toISOString(), MAX_BATCH);

    for (const commitment of due) {
      try {
        await this.transport.sendText(
          this.destinationJid,
          `🤝 Compromiso vencido: #${commitment.id} ${commitment.body}`,
        );
        if (this.commitments.markNotified(commitment.id, now.toISOString())) {
          this.audit.record({
            eventType: 'commitment.notified',
            entityType: 'commitment',
            entityId: String(commitment.id),
          });
        }
      } catch (error) {
        logger.warn('Could not deliver commitment notification; it remains eligible for retry', {
          commitmentId: commitment.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  }
}
