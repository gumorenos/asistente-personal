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

export interface GmailContentReadOptions {
  maxBodyChars: number;
  maxMessageBytes: number;
}

export interface GmailThreadReadOptions extends GmailContentReadOptions {
  maxMessages: number;
}

export interface GmailContentMessage {
  id: string;
  threadId: string;
  internalDate: string;
  from: string;
  subject: string;
  body: string;
  truncated: boolean;
}

export interface GmailReadProvider {
  readonly name: string;
  listInbox(options: GmailListOptions): Promise<GmailMetadataMessage[]>;
  readMessage?(messageId: string, options: GmailContentReadOptions): Promise<GmailContentMessage>;
  readThread?(threadId: string, options: GmailThreadReadOptions): Promise<GmailContentMessage[]>;
}
