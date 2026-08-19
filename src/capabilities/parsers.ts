export interface ParsedExpense {
  amountMinor: number;
  currency: 'PEN';
  description?: string;
}

export interface ParsedReminder {
  body: string;
  dueAt?: string;
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function parseNote(text: string): string | undefined {
  const match = text.trim().match(/^(?:anota|nota\s*:?)\s+(.+)$/i);
  const body = match?.[1]?.trim();
  return body || undefined;
}

export function parseExpense(text: string): ParsedExpense | undefined {
  const match = text.trim().match(
    /^(?:gast[eé]|gast[oó]|pagu[eé])\s+(?:(?:s\/?\.?|pen)\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:sol(?:es)?)?(?:\s+en\s+(.+))?$/i,
  );
  if (!match?.[1]) return undefined;

  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  return {
    amountMinor: Math.round(amount * 100),
    currency: 'PEN',
    description: match[2]?.trim() || undefined,
  };
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

function zonedDateParts(now: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function addCalendarDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedLocalToUtcIso(
  parts: ZonedDateParts & { hour: number; minute: number },
  timeZone: string,
): string {
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const formatted = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(formatted.year),
      Number(formatted.month) - 1,
      Number(formatted.day),
      Number(formatted.hour),
      Number(formatted.minute),
      Number(formatted.second),
    );
    candidate += targetAsUtc - representedAsUtc;
  }

  return new Date(candidate).toISOString();
}

export function parseReminder(text: string, now: Date, timeZone: string): ParsedReminder | undefined {
  const trimmed = text.trim();
  const command = trimmed.match(/^recu[eé]rdame\s+(.+)$/i);
  if (!command?.[1]) return undefined;

  const rest = command[1].trim();

  const relative = rest.match(/^(hoy|ma(?:ñ|n)ana)\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s+(.+)$/i);
  if (relative?.[1] && relative[2] && relative[4]) {
    const hour = Number(relative[2]);
    const minute = Number(relative[3] ?? 0);
    if (hour <= 23 && minute <= 59) {
      const base = zonedDateParts(now, timeZone);
      const date = addCalendarDays(base, fold(relative[1]) === 'manana' ? 1 : 0);
      return {
        body: relative[4].trim(),
        dueAt: zonedLocalToUtcIso({ ...date, hour, minute }, timeZone),
      };
    }
  }

  const explicit = rest.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (explicit?.[1] && explicit[2] && explicit[3] && explicit[4] && explicit[5] && explicit[6]) {
    const year = Number(explicit[1]);
    const month = Number(explicit[2]);
    const day = Number(explicit[3]);
    const hour = Number(explicit[4]);
    const minute = Number(explicit[5]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      return {
        body: explicit[6].trim(),
        dueAt: zonedLocalToUtcIso({ year, month, day, hour, minute }, timeZone),
      };
    }
  }

  return { body: rest };
}
