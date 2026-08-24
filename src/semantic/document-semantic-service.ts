import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentRepository } from '../database/document-repository.ts';
import type { DocumentSemanticRepository } from '../database/document-semantic-repository.ts';
import { chunkDocumentText, type DocumentChunkerConfig } from './document-chunker.ts';
import type { EmbeddingProvider, SemanticDocumentHit } from './types.ts';

export interface DocumentSemanticServiceConfig extends DocumentChunkerConfig {
  enabled: boolean;
  embeddingBatchSize: number;
}

export interface SemanticIndexResult {
  status: 'indexed' | 'disabled' | 'not_found';
  documentId: number;
  chunks: number;
  embeddings: number;
}

export class DocumentSemanticService {
  private readonly documents: DocumentRepository;
  private readonly semanticRepository: DocumentSemanticRepository;
  private readonly audit: AuditRepository;
  private readonly provider: EmbeddingProvider | undefined;
  private readonly config: DocumentSemanticServiceConfig;

  constructor(
    documents: DocumentRepository,
    semanticRepository: DocumentSemanticRepository,
    audit: AuditRepository,
    provider: EmbeddingProvider | undefined,
    config: DocumentSemanticServiceConfig,
  ) {
    if (!Number.isInteger(config.embeddingBatchSize) || config.embeddingBatchSize < 1 || config.embeddingBatchSize > 100) {
      throw new Error('Invalid semantic embedding batch size');
    }
    this.documents = documents;
    this.semanticRepository = semanticRepository;
    this.audit = audit;
    this.provider = provider;
    this.config = config;
  }

  get enabled(): boolean { return this.config.enabled; }
  get embeddingsEnabled(): boolean { return this.provider !== undefined; }
  get providerName(): string | undefined { return this.provider?.name; }
  get model(): string | undefined { return this.provider?.model; }
  get dimensions(): number | undefined { return this.provider?.dimensions; }

  async indexDocument(documentId: number): Promise<SemanticIndexResult> {
    if (!this.config.enabled) return { status: 'disabled', documentId, chunks: 0, embeddings: 0 };
    const document = this.documents.get(documentId);
    if (!document) return { status: 'not_found', documentId, chunks: 0, embeddings: 0 };

    const chunks = chunkDocumentText(document.text, this.config);
    if (chunks.length === 0) throw new Error('Document produced no semantic chunks');

    let vectors: number[][] | undefined;
    if (this.provider) {
      vectors = [];
      for (let start = 0; start < chunks.length; start += this.config.embeddingBatchSize) {
        const batch = chunks.slice(start, start + this.config.embeddingBatchSize);
        const embedded = await this.provider.embed(batch.map((chunk) => chunk.text));
        vectors.push(...embedded);
      }
      if (vectors.length !== chunks.length) throw new Error('Embedding provider returned incomplete document index');
    }

    this.semanticRepository.replaceDocumentIndex(
      documentId,
      chunks,
      this.provider && vectors
        ? {
            provider: this.provider.name,
            model: this.provider.model,
            dimensions: this.provider.dimensions,
            vectors,
          }
        : undefined,
    );

    this.audit.record({
      eventType: 'document.semantic.indexed',
      entityType: 'document',
      entityId: String(documentId),
      metadata: {
        chunks: chunks.length,
        embeddings: vectors?.length ?? 0,
        provider: this.provider?.name ?? 'disabled',
        modelConfigured: Boolean(this.provider?.model),
      },
    });

    return {
      status: 'indexed',
      documentId,
      chunks: chunks.length,
      embeddings: vectors?.length ?? 0,
    };
  }

  async search(query: string, limit = 8): Promise<SemanticDocumentHit[]> {
    if (!this.config.enabled || !this.provider) return [];
    const normalized = query.trim();
    if (!normalized || normalized.length > 2_000) throw new Error('Invalid semantic search query');
    const [queryVector] = await this.provider.embed([normalized]);
    if (!queryVector) throw new Error('Embedding provider returned no query vector');
    return this.semanticRepository.searchByVector(queryVector, {
      provider: this.provider.name,
      model: this.provider.model,
      dimensions: this.provider.dimensions,
      limit,
    });
  }
}
