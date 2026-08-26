export interface GmailMessageReadRequest {
  id: string;
  threadId: string;
}

export interface GmailMessageBody {
  id: string;
  threadId: string;
  text: string;
  format: 'plain' | 'html' | 'none';
  truncated: boolean;
  omittedParts: number;
}

export interface GmailMessageProvider {
  readonly name: string;
  getMessage(request: GmailMessageReadRequest): Promise<GmailMessageBody>;
}
