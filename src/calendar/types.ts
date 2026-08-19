export interface CalendarCreateEventInput {
  title: string;
  startAt: string;
  durationMinutes: number;
  timeZone: string;
}

export interface CalendarCreateEventResult {
  externalId: string;
}

export interface CalendarProvider {
  readonly name: string;
  createEvent(
    input: CalendarCreateEventInput,
    idempotencyKey: string,
  ): Promise<CalendarCreateEventResult>;
}
