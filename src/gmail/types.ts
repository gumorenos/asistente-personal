export interface GmailMetadataMessage {
  id: string;
  threadId: string;
  internalDate: string;
  from: string;
  subject: string;
  unread: boolean;
}

export interface GmailListOptions {
  unreadOnly: boolean;
  limit: number;
}

export interface GmailReadProvider {
  readonly name: string;
  listInbox(options: GmailListOptions): Promise<GmailMetadataMessage[]>;
}
