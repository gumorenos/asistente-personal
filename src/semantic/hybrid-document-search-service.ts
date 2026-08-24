import type { LocalMemorySearchRepository } from '../database/local-memory-search-repository.ts';
import type { DocumentSemanticService } from './document-semantic-service.ts';

export interface HybridDocumentHit {
  documentId: number;
  score: number;
  semanticScore?: number;
  lexicalRank?: number;
  semanticRank?: number;
  text: string;
}

interface MutableHit extends HybridDocumentHit {
  score: number;
}

const RRF_K = 60;

export class HybridDocumentSearchService {
  constructor(
    private readonly lexical: LocalMemorySearchRepository,
    private readonly semantic: DocumentSemanticService,
  ) {}

  async search(query: string, limit = 5): Promise<HybridDocumentHit[]> {
    const normalized = query.trim();
    if (!normalized || normalized.length > 2_000) throw new Error('Invalid hybrid document query');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid hybrid document search limit');

    const lexicalHits = this.lexical.search(normalized, { source: 'document', limit: Math.min(20, limit * 3) });
    const semanticHits = this.semantic.embeddingsEnabled
      ? await this.semantic.search(normalized, Math.min(20, limit * 4))
      : [];

    const combined = new Map<number, MutableHit>();
    lexicalHits.forEach((hit, index) => {
      const documentId = Number(hit.sourceId);
      if (!Number.isSafeInteger(documentId) || documentId < 1) return;
      const row = combined.get(documentId) ?? { documentId, score: 0, text: hit.text };
      row.lexicalRank = index + 1;
      row.score += 1 / (RRF_K + index + 1);
      combined.set(documentId, row);
    });

    const bestSemanticRank = new Set<number>();
    semanticHits.forEach((hit, index) => {
      const existing = combined.get(hit.documentId) ?? { documentId: hit.documentId, score: 0, text: hit.text };
      if (!bestSemanticRank.has(hit.documentId)) {
        existing.semanticRank = index + 1;
        existing.semanticScore = hit.score;
        existing.text = hit.text;
        existing.score += 1.15 / (RRF_K + index + 1);
        bestSemanticRank.add(hit.documentId);
      }
      combined.set(hit.documentId, existing);
    });

    return [...combined.values()]
      .sort((left, right) => right.score - left.score || (right.semanticScore ?? -2) - (left.semanticScore ?? -2) || left.documentId - right.documentId)
      .slice(0, limit);
  }
}
