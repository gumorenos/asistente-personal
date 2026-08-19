export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export type ExpensePeriod = 'day' | 'week' | 'month';

export interface IsoRange {
  startIso: string;
  endIso: string;
}

export function zonedDateTimeParts(now: Date, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

export function addCalendarDays(
  parts: Pick<ZonedDateTimeParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<ZonedDateTimeParts, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function zonedLocalToUtcIso(parts: ZonedDateTimeParts, timeZone: string): string {
  if (!isValidCalendarDate(parts.year, parts.month, parts.day)) {
    throw new Error('Invalid calendar date');
  }
  if (parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59) {
    throw new Error('Invalid local time');
  }

  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = zonedDateTimeParts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      0,
      0,
    );
    candidate += targetAsUtc - representedAsUtc;
  }

  const finalParts = zonedDateTimeParts(new Date(candidate), timeZone);
  if (compareLocalDateTime(finalParts, parts) !== 0) {
    throw new Error('Local date/time does not exist in configured timezone');
  }

  return new Date(candidate).toISOString();
}

export function compareLocalDateTime(a: ZonedDateTimeParts, b: ZonedDateTimeParts): number {
  const left = [a.year, a.month, a.day, a.hour, a.minute];
  const right = [b.year, b.month, b.day, b.hour, b.minute];
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function localPeriodRange(now: Date, timeZone: string, period: ExpensePeriod): IsoRange {
  const local = zonedDateTimeParts(now, timeZone);
  let start = { year: local.year, month: local.month, day: local.day };
  let end: Pick<ZonedDateTimeParts, 'year' | 'month' | 'day'>;

  if (period === 'week') {
    const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
    start = addCalendarDays(start, -daysSinceMonday);
    end = addCalendarDays(start, 7);
  } else if (period === 'month') {
    start = { year: local.year, month: local.month, day: 1 };
    const nextMonth = new Date(Date.UTC(local.year, local.month, 1));
    end = {
      year: nextMonth.getUTCFullYear(),
      month: nextMonth.getUTCMonth() + 1,
      day: 1,
    };
  } else {
    end = addCalendarDays(start, 1);
  }

  return {
    startIso: zonedLocalToUtcIso({ ...start, hour: 0, minute: 0 }, timeZone),
    endIso: zonedLocalToUtcIso({ ...end, hour: 0, minute: 0 }, timeZone),
  };
}
