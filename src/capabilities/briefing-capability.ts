import type { BriefingService } from '../briefing/briefing-service.ts';
import type { IncomingMessage } from '../core/types.ts';
import type { Capability, CapabilityResult } from './types.ts';

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export class BriefingCapability implements Capability {
  readonly name = 'briefing';

  private readonly service: BriefingService;
  private readonly now: () => Date;

  constructor(service: BriefingService, now: () => Date = () => new Date()) {
    this.service = service;
    this.now = now;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    const text = fold(message.text.trim());
    if (!['briefing', '/briefing', 'resumen personal'].includes(text)) return undefined;
    return { handled: true, reply: this.service.render(this.now()) };
  }
}
