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

  /**
   * Must be idempotent for repeated calls with the same idempotencyKey.
   * A retry after a process crash may repeat this method even if the remote
   * event was already created but local success persistence did not complete.
   * The concrete provider must therefore map a stable key to one remote event.
   */
  createEvent(
    input: CalendarCreateEventInput,
    idempotencyKey: string,
  ): Promise<CalendarCreateEventResult>;
}
