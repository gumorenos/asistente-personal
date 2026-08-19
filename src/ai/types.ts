export interface AiGenerateInput {
  userText: string;
  systemPrompt: string;
}

export interface AiGenerateResult {
  text: string;
  model?: string;
}

export interface AiProvider {
  readonly name: string;
  generate(input: AiGenerateInput): Promise<AiGenerateResult>;
}
