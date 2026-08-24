export type CalendarReadPeriod = 'today' | 'tomorrow' | 'week';

export interface CalendarReadRange {
  startAt: string;
  endAt: string;
  timeZone: string;
}

export interface CalendarReadEvent {
  id: string;
  title: string;
  startDateTime?: string;
  endDateTime?: string;
  startDate?: string;
  endDate?: string;
}

export interface CalendarBusyInterval {
  startAt: string;
  endAt: string;
}

export interface CalendarReadProvider {
  readonly name: string;
  listEvents(range: CalendarReadRange, maxResults: number): Promise<CalendarReadEvent[]>;
  queryBusy(range: CalendarReadRange): Promise<CalendarBusyInterval[]>;
}
