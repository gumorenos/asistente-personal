import type { BriefingService } from '../briefing/briefing-service.ts';
import { zonedDateTimeParts } from '../capabilities/time-utils.ts';
import { logger } from '../core/logger.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { BriefingDeliveryRepository } from '../database/briefing-delivery-repository.ts';
import type { MessageTransport } from '../transports/types.ts';

export interface BriefingSchedule {
  hour: number;
  minute: number;
}

export class BriefingScheduler {
  private readonly service: BriefingService;
  private readonly deliveries: BriefingDeliveryRepository;
  private readonly transport: MessageTransport;
  private readonly audit: AuditRepository;
  private readonly destination: string;
  private readonly timeZone: string;
  private readonly schedule: BriefingSchedule;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    service: BriefingService,
    deliveries: BriefingDeliveryRepository,
    transport: MessageTransport,
    audit: AuditRepository,
    destination: string,
    timeZone: string,
    schedule: BriefingSchedule,
    now: () => Date = () => new Date(),
  ) {
    this.service = service;
    this.deliveries = deliveries;
    this.transport = transport;
    this.audit = audit;
    this.destination = destination;
    this.timeZone = timeZone;
    this.schedule = schedule;
    this.now = now;
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
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      const local = zonedDateTimeParts(now, this.timeZone);
      const currentMinutes = local.hour * 60 + local.minute;
      const scheduledMinutes = this.schedule.hour * 60 + this.schedule.minute;
      if (currentMinutes < scheduledMinutes) return;

      const localDate = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
      if (this.deliveries.hasDelivered(localDate)) return;

      const text = this.service.render(now);
      const sent = await this.transport.sendText(this.destination, text);
      const inserted = this.deliveries.markDelivered({
        localDate,
        destination: this.destination,
        messageId: sent.messageId,
        deliveredAt: now.toISOString(),
      });
      if (inserted) {
        this.audit.record({
          eventType: 'briefing.delivered',
          entityType: 'briefing',
          entityId: localDate,
          metadata: { destination: this.destination },
        });
      }
    } catch (error) {
      logger.warn('Could not deliver daily briefing; it remains eligible for retry', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      this.running = false;
    }
  }
}
