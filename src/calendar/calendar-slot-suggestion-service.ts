import type { CalendarReadService } from './calendar-read-service.ts';
import type { CalendarSlotSuggestionConfig } from './slot-suggestion-config.ts';

export interface SuggestedCalendarSlot {
  startAt: string;
  endAt: string;
}

export interface CalendarSlotSuggestionResult {
  period: 'today' | 'tomorrow';
  durationMinutes: number;
  windowElapsed: boolean;
  suggestions: SuggestedCalendarSlot[];
}

function ceilAligned(epochMs: number, alignmentMinutes: number): number {
  const alignmentMs = alignmentMinutes * 60_000;
  return Math.ceil(epochMs / alignmentMs) * alignmentMs;
}

export class CalendarSlotSuggestionService {
  private readonly calendarRead: CalendarReadService;
  private readonly config: CalendarSlotSuggestionConfig;

  constructor(calendarRead: CalendarReadService, config: CalendarSlotSuggestionConfig) {
    this.calendarRead = calendarRead;
    this.config = config;
  }

  async suggest(
    period: 'today' | 'tomorrow',
    durationMinutes: number,
  ): Promise<CalendarSlotSuggestionResult> {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      throw new Error('Meeting duration must be between 15 and 240 minutes');
    }
    if (durationMinutes % this.config.alignmentMinutes !== 0) {
      throw new Error(`Meeting duration must be a multiple of ${this.config.alignmentMinutes} minutes`);
    }

    const availability = await this.calendarRead.availability(period, durationMinutes);
    if (!availability) {
      return { period, durationMinutes, windowElapsed: true, suggestions: [] };
    }

    const durationMs = durationMinutes * 60_000;
    const suggestions: SuggestedCalendarSlot[] = [];
    for (const free of availability.freeSlots) {
      const freeEnd = new Date(free.endAt).getTime();
      let candidate = ceilAligned(new Date(free.startAt).getTime(), this.config.alignmentMinutes);
      while (candidate + durationMs <= freeEnd && suggestions.length < this.config.maxSuggestions) {
        suggestions.push({
          startAt: new Date(candidate).toISOString(),
          endAt: new Date(candidate + durationMs).toISOString(),
        });
        candidate += durationMs;
      }
      if (suggestions.length >= this.config.maxSuggestions) break;
    }

    return { period, durationMinutes, windowElapsed: false, suggestions };
  }
}
