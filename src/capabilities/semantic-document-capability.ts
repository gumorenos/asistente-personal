import type { IncomingMessage } from '../core/types.ts';
import type { AuditRepository } from '../database/audit-repository.ts';
import type { DocumentRepository } from '../database/document-repository.ts';
import type { DocumentSemanticService } from '../semantic/document-semantic-service.ts';
import type { HybridDocumentSearchService } from '../semantic/hybrid-document-search-service.ts';
import type { Capability, CapabilityResult } from './types.ts';

const MAX_ITEM_CHARS = 420;
const MAX_REPLY_CHARS = 3_500;

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_ITEM_CHARS ? normalized : `${normalized.slice(0, MAX_ITEM_CHARS - 1)}…`;
}

export class SemanticDocumentCapability implements Capability {
  readonly name = 'semantic-documents';

  private readonly documents: DocumentRepository;
  private readonly semantic: DocumentSemanticService;
  private readonly audit: AuditRepository;
  private readonly hybrid: HybridDocumentSearchService | undefined;

  constructor(
    documents: DocumentRepository,
    semantic: DocumentSemanticService,
    audit: AuditRepository,
    hybrid?: HybridDocumentSearchService,
  ) {
    this.documents = documents;
    this.semantic = semantic;
    this.audit = audit;
    this.hybrid = hybrid;
  }

  async handle(message: IncomingMessage): Promise<CapabilityResult | undefined> {
    if (message.kind !== 'text') return undefined;
    const text = message.text.trim();

    if (/^(?:semantica|semántica)\s+status$/i.test(text)) {
      return {
        handled: true,
        reply: [
          `🧠 Índice semántico: ${this.semantic.enabled ? 'habilitado' : 'deshabilitado'}`,
          `Embeddings externos: ${this.semantic.embeddingsEnabled ? 'habilitados' : 'deshabilitados'}`,
          this.semantic.embeddingsEnabled
            ? `Proveedor: ${this.semantic.providerName} · modelo configurado · ${this.semantic.dimensions} dimensiones`
            : 'Ningún contenido se envía a un proveedor de embeddings.',
        ].join('\n'),
      };
    }

    const reindex = text.match(/^reindexa\s+documento\s+#?(\d+)$/i);
    if (reindex?.[1]) {
      const documentId = Number(reindex[1]);
      if (!this.documents.get(documentId)) return { handled: true, reply: `No encontré el documento #${documentId}.` };
      if (!this.semantic.enabled) return { handled: true, reply: '🧠 El índice semántico está deshabilitado.' };
      try {
        const result = await this.semantic.indexDocument(documentId);
        return {
          handled: true,
          reply: `🧠 Documento #${documentId} reindexado: ${result.chunks} chunks · ${result.embeddings} embeddings.`,
        };
      } catch (error) {
        this.audit.record({
          eventType: 'document.semantic.reindex.failed',
          entityType: 'document',
          entityId: String(documentId),
          metadata: { errorType: error instanceof Error ? error.name : 'unknown' },
        });
        return { handled: true, reply: '⚠️ No pude reindexar el documento. El índice anterior se conserva.' };
      }
    }

    const hybridSearch = text.match(/^(?:busca|buscar)\s+(?:hibrida|híbrida)\s+documentos?\s+(.+)$/i);
    if (hybridSearch?.[1]) {
      if (!this.semantic.enabled || !this.semantic.embeddingsEnabled || !this.hybrid) {
        return { handled: true, reply: '🧠 La búsqueda híbrida requiere índice semántico y embeddings habilitados.' };
      }
      const query = hybridSearch[1].trim();
      if (!query || query.length > 2_000) return { handled: true, reply: '⚠️ Consulta híbrida inválida.' };
      try {
        const hits = await this.hybrid.search(query, 5);
        this.audit.record({
          eventType: 'document.hybrid.search',
          entityType: 'document',
          metadata: { queryChars: query.length, returned: hits.length, provider: this.semantic.providerName },
        });
        if (hits.length === 0) return { handled: true, reply: '🧠 No encontré coincidencias híbridas en tus documentos.' };
        const lines = [`🧠 Búsqueda híbrida · ${hits.length} documento${hits.length === 1 ? '' : 's'}`];
        for (const hit of hits) {
          const signals = [
            hit.lexicalRank ? `FTS #${hit.lexicalRank}` : undefined,
            hit.semanticRank ? `semántica #${hit.semanticRank}` : undefined,
          ].filter(Boolean).join(' + ');
          const line = `• Documento #${hit.documentId}${signals ? ` · ${signals}` : ''} — ${compact(hit.text)}`;
          if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
          lines.push(line);
        }
        return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
      } catch (error) {
        this.audit.record({
          eventType: 'document.hybrid.search.failed',
          entityType: 'document',
          metadata: { queryChars: query.length, errorType: error instanceof Error ? error.name : 'unknown' },
        });
        return { handled: true, reply: '⚠️ No pude completar la búsqueda híbrida. No se ejecutó ninguna acción.' };
      }
    }

    const search = text.match(/^(?:busca|buscar)\s+(?:semantica|semántica)\s+documentos?\s+(.+)$/i);
    if (!search?.[1]) return undefined;
    if (!this.semantic.enabled) return { handled: true, reply: '🧠 La búsqueda semántica está deshabilitada.' };
    if (!this.semantic.embeddingsEnabled) {
      return { handled: true, reply: '🧠 Los chunks locales están disponibles, pero los embeddings externos están deshabilitados.' };
    }

    const query = search[1].trim();
    if (!query || query.length > 2_000) return { handled: true, reply: '⚠️ Consulta semántica inválida.' };

    try {
      const hits = await this.semantic.search(query, 8);
      this.audit.record({
        eventType: 'document.semantic.search',
        entityType: 'document',
        metadata: { queryChars: query.length, returned: hits.length, provider: this.semantic.providerName },
      });
      if (hits.length === 0) return { handled: true, reply: '🧠 No encontré coincidencias semánticas en tus documentos indexados.' };

      const lines = [`🧠 Búsqueda semántica · ${hits.length} fragmento${hits.length === 1 ? '' : 's'}`];
      for (const hit of hits) {
        const line = `• Documento #${hit.documentId} · fragmento ${hit.chunkIndex + 1} · similitud ${hit.score.toFixed(3)} — ${compact(hit.text)}`;
        if ([...lines, line].join('\n').length > MAX_REPLY_CHARS) break;
        lines.push(line);
      }
      return { handled: true, reply: lines.join('\n').slice(0, MAX_REPLY_CHARS) };
    } catch (error) {
      this.audit.record({
        eventType: 'document.semantic.search.failed',
        entityType: 'document',
        metadata: { queryChars: query.length, errorType: error instanceof Error ? error.name : 'unknown' },
      });
      return { handled: true, reply: '⚠️ No pude completar la búsqueda semántica. No se ejecutó ninguna acción.' };
    }
  }
}
