export interface TranscriptionInput {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface TranscriptionResult {
  text: string;
  model?: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
