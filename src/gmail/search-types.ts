import type { GmailMetadataMessage } from './types.ts';

export type GmailSearchFilter =
  | { kind: 'from'; value: string }
  | { kind: 'subject'; value: string }
  | { kind: 'date_range'; startEpochSeconds: number; endExclusiveEpochSeconds: number };

export interface GmailSearchProvider {
  readonly name: string;
  searchInbox(filter: GmailSearchFilter, limit: number): Promise<GmailMetadataMessage[]>;
}
