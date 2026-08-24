import {
  addCalendarDays,
  localPeriodRange,
  zonedDateTimeParts,
  zonedLocalToUtcIso,
} from '../capabilities/time-utils.ts';
import type { CalendarReadConfig } from './read-config.ts';
import type {
  CalendarBusyInterval,
  CalendarReadEvent,
  CalendarReadPeriod,
  CalendarReadProvider,
  CalendarReadRange,
} from './read-types.ts';

export interface CalendarAgendaResult {
  period: CalendarReadPeriod;
  range: CalendarReadRange;
  events: CalendarReadEvent[];
}

export interface CalendarFreeSlot {
  startAt: string;
  endAt: string;
}

export interface CalendarAvailabilityResult {
  period: Exclude<CalendarReadPeriod, 'week'>;
  range: CalendarReadRange;
  busyIntervals: CalendarBusyInterval[];
  freeSlots: CalendarFreeSlot[];
}

export interface CalendarExactAvailabilityResult {
  range: CalendarReadRange;
  durationMinutes: number;
  busyIntervals: CalendarBusyInterval[];
  isFree: boolean;
}

const MAX_EXACT_AVAILABILITY_HORIZON_MS = 366 * 24 * 60 * 60 * 1_000;

function targetDate(now: Date, timeZone: string, period: 'today' | 'tomorrow') {
  const local = zonedDateTimeParts(now, timeZone);
  const today = { year: local.year, month: local.month, day: local.day };
  return period === 'tomorrow' ? addCalendarDays(today, 1) : today;
}

function rangeForPeriod(now: Date, timeZone: string, period: CalendarReadPeriod): CalendarReadRange {
  if (period === 'today') {
    const range = localPeriodRange(now, timeZone, 'day');
    return { startAt: range.startIso, endAt: range.endIso, timeZone };
  }
  if (period === 'week') {
    const range = localPeriodRange(now, timeZone, 'week');
    return { startAt: range.startIso, endAt: range.endIso, timeZone };
  }
  const date = targetDate(now, timeZone, 'tomorrow');
  const next = addCalendarDays(date, 1);
  return {
    startAt: zonedLocalToUtcIso({ ...date, hour: 0, minute: 0 }, timeZone),
    endAt: zonedLocalToUtcIso({ ...next, hour: 0, minute: 0 }, timeZone),
    timeZone,
  };
}

function workRange(
  now: Date,
  timeZone: string,
  period: 'today' | 'tomorrow',
  dayStartMinutes: number,
  dayEndMinutes: number,
): CalendarReadRange | undefined {
  const date = targetDate(now, timeZone, period);
  const startAt = zonedLocalToUtcIso({
    ...date,
    hour: Math.floor(dayStartMinutes / 60),
    minute: dayStartMinutes % 60,
  }, timeZone);
  const endAt = zonedLocalToUtcIso({
    ...date,
    hour: Math.floor(dayEndMinutes / 60),
    minute: dayEndMinutes % 60,
  }, timeZone);
  let startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (period === 'today') startMs = Math.max(startMs, now.getTime());
  if (startMs >= endMs) return undefined;
  return { startAt: new Date(startMs).toISOString(), endAt, timeZone };
}

function mergeAndClipBusy(intervals: CalendarBusyInterval[], range: CalendarReadRange): CalendarBusyInterval[] {
  const rangeStart = new Date(range.startAt).getTime();
  const rangeEnd = new Date(range.endAt).getTime();
  const normalized = intervals
    .map((slot) => ({
      startMs: Math.max(rangeStart, new Date(slot.startAt).getTime()),
      endMs: Math.min(rangeEnd, new Date(slot.endAt).getTime()),
    }))
    .filter((slot) => Number.isFinite(slot.startMs) && Number.isFinite(slot.endMs) && slot.endMs > slot.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const slot of normalized) {
    const previous = merged.at(-1);
    if (previous && slot.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, slot.endMs);
    } else {
      merged.push({ ...slot });
    }
  }
  return merged.map((slot) => ({
    startAt: new Date(slot.startMs).toISOString(),
    endAt: new Date(slot.endMs).toISOString(),
  }));
}

function freeFromBusy(
  busy: CalendarBusyInterval[],
  range: CalendarReadRange,
  minFreeMinutes: number,
): CalendarFreeSlot[] {
  const minMs = minFreeMinutes * 60_000;
  const endMs = new Date(range.endAt).getTime();
  let cursor = new Date(range.startAt).getTime();
  const free: CalendarFreeSlot[] = [];
  for (const slot of busy) {
    const startMs = new Date(slot.startAt).getTime();
    const busyEnd = new Date(slot.endAt).getTime();
    if (startMs - cursor >= minMs) {
      free.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(startMs).toISOString() });
    }
    cursor = Math.max(cursor, busyEnd);
  }
  if (endMs - cursor >= minMs) {
    free.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(endMs).toISOString() });
  }
  return free;
}

export class CalendarReadService {
  private readonly provider: CalendarReadProvider;
  private readonly config: CalendarReadConfig;
  private readonly timeZone: string;
  private readonly now: () => Date;

  constructor(
    provider: CalendarReadProvider,
    config: CalendarReadConfig,
    timeZone: string,
    now: () => Date = () => new Date(),
  ) {
    this.provider = provider;
    this.config = config;
    this.timeZone = timeZone;
    this.now = now;
  }

  async agenda(period: CalendarReadPeriod): Promise<CalendarAgendaResult> {
    const range = rangeForPeriod(this.now(), this.timeZone, period);
    const events = await this.provider.listEvents(range, this.config.maxEvents);
    return { period, range, events };
  }

  async availability(
    period: 'today' | 'tomorrow',
    minimumMinutes: number = this.config.minFreeMinutes,
  ): Promise<CalendarAvailabilityResult | undefined> {
    if (!Number.isInteger(minimumMinutes) || minimumMinutes < 5 || minimumMinutes > 240) {
      throw new Error('Invalid Calendar availability minimum duration');
    }
    const range = workRange(
      this.now(),
      this.timeZone,
      period,
      this.config.dayStartMinutes,
      this.config.dayEndMinutes,
    );
    if (!range) return undefined;
    const busyIntervals = mergeAndClipBusy(await this.provider.queryBusy(range), range);
    const freeSlots = freeFromBusy(busyIntervals, range, minimumMinutes);
    return { period, range, busyIntervals, freeSlots };
  }

  async exactAvailability(startAt: string, durationMinutes: number): Promise<CalendarExactAvailabilityResult> {
    const startMs = new Date(startAt).getTime();
    if (!Number.isFinite(startMs)) throw new Error('Invalid Calendar exact-availability start');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      throw new Error('Calendar exact-availability duration must be between 5 and 480 minutes');
    }

    const nowMs = this.now().getTime();
    if (startMs <= nowMs) throw new Error('Calendar exact-availability start must be in the future');
    if (startMs - nowMs > MAX_EXACT_AVAILABILITY_HORIZON_MS) {
      throw new Error('Calendar exact-availability start exceeds 366-day horizon');
    }

    const endMs = startMs + durationMinutes * 60_000;
    const range: CalendarReadRange = {
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      timeZone: this.timeZone,
    };
    const busyIntervals = mergeAndClipBusy(await this.provider.queryBusy(range), range);
    return { range, durationMinutes, busyIntervals, isFree: busyIntervals.length === 0 };
  }
}
