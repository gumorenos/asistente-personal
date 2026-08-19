import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { ReminderRepository } from '../database/reminder-repository.ts';
import type { MessageTransport } from '../transports/types.ts';

export class ReminderScheduler {
  private readonly reminders: ReminderRepository;
  private readonly transport: MessageTransport;
  private readonly audit?: AuditRepository;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;

  constructor(
    reminders: ReminderRepository,
    transport: MessageTransport,
    now: () => Date = () => new Date(),
    audit?: AuditRepository,
  ) {
    this.reminders = reminders;
    this.transport = transport;
    this.now = now;
    this.audit = audit;
  }

  start(intervalMs = 30_000): void {
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
    const due = this.reminders.listDue(now.toISOString());

    for (const reminder of due) {
      if (!reminder.chatId) {
        logger.error('Reminder has no delivery destination; it remains pending', { reminderId: reminder.id });
        continue;
      }
      try {
        await this.transport.sendText(reminder.chatId, `⏰ Recordatorio: ${reminder.body}`);
        if (this.reminders.markDelivered(reminder.id, now.toISOString())) {
          this.audit?.record({
            eventType: 'reminder.delivered',
            entityType: 'reminder',
            entityId: String(reminder.id),
          });
        }
      } catch (error) {
        logger.warn('Could not deliver reminder; it remains pending', {
          reminderId: reminder.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
