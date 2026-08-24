export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface DocumentChunk {
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
  textHash: string;
}

export interface SemanticDocumentHit {
  documentId: number;
  chunkId: number;
  chunkIndex: number;
  score: number;
  text: string;
}
