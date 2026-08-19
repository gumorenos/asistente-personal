import {
  addCalendarDays,
  compareLocalDateTime,
  isValidCalendarDate,
  zonedDateTimeParts,
  zonedLocalToUtcIso,
} from './time-utils.ts';

export interface ParsedExpense {
  amountMinor: number;
  currency: 'PEN';
  description?: string;
  category?: string;
}

export interface ParsedReminder {
  body: string;
  dueAt?: string;
  invalidSchedule?: boolean;
}

export interface NoteStatusAction {
  id: number;
  status: 'completed' | 'archived';
}

export interface ReminderStatusAction {
  id: number;
  status: 'completed' | 'cancelled';
}

export interface ExpenseCategoryAction {
  id: number;
  category: string;
}

const WEEKDAYS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function parseNote(text: string): string | undefined {
  const match = text.trim().match(/^(?:anota|nota\s*:?)\s+(.+)$/i);
  const body = match?.[1]?.trim();
  return body || undefined;
}

export function parseNoteStatusAction(text: string): NoteStatusAction | undefined {
  const folded = foldText(text);
  let match = folded.match(/^(?:completa|completar|hecha)\s+(?:la\s+)?nota\s+#?(\d+)$/);
  if (match?.[1]) return { id: Number(match[1]), status: 'completed' };
  match = folded.match(/^(?:archiva|archivar|borra|borrar|elimina|eliminar)\s+(?:la\s+)?nota\s+#?(\d+)$/);
  if (match?.[1]) return { id: Number(match[1]), status: 'archived' };
  return undefined;
}

export function parseReminderStatusAction(text: string): ReminderStatusAction | undefined {
  const folded = foldText(text);
  let match = folded.match(/^(?:completa|completar|hecho)\s+(?:el\s+)?recordatorio\s+#?(\d+)$/);
  if (match?.[1]) return { id: Number(match[1]), status: 'completed' };
  match = folded.match(/^(?:cancela|cancelar|borra|borrar|elimina|eliminar)\s+(?:el\s+)?recordatorio\s+#?(\d+)$/);
  if (match?.[1]) return { id: Number(match[1]), status: 'cancelled' };
  return undefined;
}

export function parseExpenseCategoryAction(text: string): ExpenseCategoryAction | undefined {
  const match = text
    .trim()
    .match(/^(?:categoriza|categor[ií]a)\s+(?:el\s+)?gasto\s+#?(\d+)\s+(?:como|en)\s+([\p{L}\p{N}_-]{1,40})$/iu);
  if (!match?.[1] || !match[2]) return undefined;
  return { id: Number(match[1]), category: foldText(match[2]) };
}

export function parseExpense(text: string): ParsedExpense | undefined {
  const match = text.trim().match(
    /^(?:gast[eé]|gast[oó]|pagu[eé])\s+(?:(?:s\/?\.?|pen)\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:sol(?:es)?)?(?:\s+en\s+(.+))?$/i,
  );
  if (!match?.[1]) return undefined;

  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return undefined;

  let description = match[2]?.trim() || undefined;
  let category: string | undefined;
  if (description) {
    const categoryMatch = description.match(/\s+#([\p{L}\p{N}_-]{1,40})$/u);
    if (categoryMatch?.[1]) {
      category = foldText(categoryMatch[1]);
      description = description.slice(0, categoryMatch.index).trim() || undefined;
    }
  }

  return {
    amountMinor: Math.round(amount * 100),
    currency: 'PEN',
    description,
    category,
  };
}

function timeParts(hourText: string, minuteText?: string): { hour: number; minute: number } | undefined {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return { hour, minute };
}

function futureIso(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  now: Date,
  timeZone: string,
): string | undefined {
  if (!isValidCalendarDate(target.year, target.month, target.day)) return undefined;
  try {
    const iso = zonedLocalToUtcIso(target, timeZone);
    return new Date(iso).getTime() > now.getTime() ? iso : undefined;
  } catch {
    return undefined;
  }
}

function nextMonthContainingDay(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } | undefined {
  for (let offset = 0; offset < 12; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1 + offset, 1));
    const candidateYear = candidate.getUTCFullYear();
    const candidateMonth = candidate.getUTCMonth() + 1;
    if (isValidCalendarDate(candidateYear, candidateMonth, day)) {
      return { year: candidateYear, month: candidateMonth, day };
    }
  }
  return undefined;
}

export function parseReminder(text: string, now: Date, timeZone: string): ParsedReminder | undefined {
  const trimmed = text.trim();
  const command = trimmed.match(/^recu[eé]rdame\s+(.+)$/i);
  if (!command?.[1]) return undefined;

  const rest = command[1].trim();
  const localNow = zonedDateTimeParts(now, timeZone);

  const duration = rest.match(/^en\s+(\d+)\s+(minuto(?:s)?|hora(?:s)?|d[ií]a(?:s)?)\s+(.+)$/i);
  if (duration?.[1] && duration[2] && duration[3]) {
    const amount = Number(duration[1]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 3650) {
      return { body: duration[3].trim(), invalidSchedule: true };
    }
    const unit = foldText(duration[2]);
    if (unit.startsWith('minuto')) {
      return { body: duration[3].trim(), dueAt: new Date(now.getTime() + amount * 60_000).toISOString() };
    }
    if (unit.startsWith('hora')) {
      return { body: duration[3].trim(), dueAt: new Date(now.getTime() + amount * 3_600_000).toISOString() };
    }
    const date = addCalendarDays(localNow, amount);
    try {
      return {
        body: duration[3].trim(),
        dueAt: zonedLocalToUtcIso({ ...date, hour: localNow.hour, minute: localNow.minute }, timeZone),
      };
    } catch {
      return { body: duration[3].trim(), invalidSchedule: true };
    }
  }

  const relativeDay = rest.match(/^(hoy|ma(?:ñ|n)ana)\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i);
  if (relativeDay?.[1] && relativeDay[2] && relativeDay[4]) {
    const time = timeParts(relativeDay[2], relativeDay[3]);
    if (!time) return { body: relativeDay[4].trim(), invalidSchedule: true };
    const date = addCalendarDays(localNow, foldText(relativeDay[1]) === 'manana' ? 1 : 0);
    const iso = futureIso({ ...date, ...time }, now, timeZone);
    return iso
      ? { body: relativeDay[4].trim(), dueAt: iso }
      : { body: relativeDay[4].trim(), invalidSchedule: true };
  }

  const weekday = rest.match(/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i);
  if (weekday?.[1] && weekday[2] && weekday[4]) {
    const time = timeParts(weekday[2], weekday[3]);
    if (!time) return { body: weekday[4].trim(), invalidSchedule: true };
    const targetWeekday = WEEKDAYS[foldText(weekday[1])];
    const currentDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
    const currentWeekday = currentDate.getUTCDay() === 0 ? 7 : currentDate.getUTCDay();
    let delta = ((targetWeekday ?? currentWeekday) - currentWeekday + 7) % 7;
    const sameDayTarget = { ...localNow, ...time };
    if (delta === 0 && compareLocalDateTime(sameDayTarget, localNow) <= 0) delta = 7;
    const date = addCalendarDays(localNow, delta);
    const iso = futureIso({ ...date, ...time }, now, timeZone);
    return iso
      ? { body: weekday[4].trim(), dueAt: iso }
      : { body: weekday[4].trim(), invalidSchedule: true };
  }

  const slashDate = rest.match(/^el\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i);
  if (slashDate?.[1] && slashDate[2] && slashDate[4] && slashDate[6]) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]);
    const time = timeParts(slashDate[4], slashDate[5]);
    if (!time) return { body: slashDate[6].trim(), invalidSchedule: true };
    let year = slashDate[3] ? Number(slashDate[3]) : localNow.year;
    if (!isValidCalendarDate(year, month, day)) return { body: slashDate[6].trim(), invalidSchedule: true };
    let iso = futureIso({ year, month, day, ...time }, now, timeZone);
    if (!iso && !slashDate[3]) {
      year += 1;
      iso = futureIso({ year, month, day, ...time }, now, timeZone);
    }
    return iso
      ? { body: slashDate[6].trim(), dueAt: iso }
      : { body: slashDate[6].trim(), invalidSchedule: true };
  }

  const dayOnly = rest.match(/^el\s+(\d{1,2})\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i);
  if (dayOnly?.[1] && dayOnly[2] && dayOnly[4]) {
    const day = Number(dayOnly[1]);
    const time = timeParts(dayOnly[2], dayOnly[3]);
    if (!time) return { body: dayOnly[4].trim(), invalidSchedule: true };
    let date = nextMonthContainingDay(localNow.year, localNow.month, day);
    if (!date) return { body: dayOnly[4].trim(), invalidSchedule: true };
    let iso = futureIso({ ...date, ...time }, now, timeZone);
    if (!iso) {
      const next = new Date(Date.UTC(date.year, date.month, 1));
      date = nextMonthContainingDay(next.getUTCFullYear(), next.getUTCMonth() + 1, day);
      if (date) iso = futureIso({ ...date, ...time }, now, timeZone);
    }
    return iso
      ? { body: dayOnly[4].trim(), dueAt: iso }
      : { body: dayOnly[4].trim(), invalidSchedule: true };
  }

  const explicit = rest.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (explicit?.[1] && explicit[2] && explicit[3] && explicit[4] && explicit[5] && explicit[6]) {
    const time = timeParts(explicit[4], explicit[5]);
    const target = {
      year: Number(explicit[1]),
      month: Number(explicit[2]),
      day: Number(explicit[3]),
      hour: time?.hour ?? -1,
      minute: time?.minute ?? -1,
    };
    const iso = time ? futureIso(target, now, timeZone) : undefined;
    return iso
      ? { body: explicit[6].trim(), dueAt: iso }
      : { body: explicit[6].trim(), invalidSchedule: true };
  }

  if (/^(?:hoy|ma(?:ñ|n)ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|en\s+\d+|el\s+\d+)/i.test(rest)) {
    return { body: rest, invalidSchedule: true };
  }

  return { body: rest };
}
