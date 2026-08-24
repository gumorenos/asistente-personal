# Stage 4D — memoria semántica e híbrida de documentos

## Objetivo

Añadir recuperación semántica de documentos sin convertir el asistente en un sistema que exporta contenido por defecto ni introducir una base vectorial separada.

Stage 4D conserva tres capas independientes:

1. `busca documentos <texto>` — FTS5 local, sin red.
2. `busca semántica documentos <consulta>` — embeddings + similitud coseno.
3. `busca híbrida documentos <consulta>` — combina FTS5 + señal semántica por reciprocal-rank fusion.

Observer no participa en ninguna de estas capas.

## Privacy gates

Los defaults son:

```env
SEMANTIC_ENABLED=false
EMBEDDINGS_ENABLED=false
```

`SEMANTIC_ENABLED=true` requiere `DOCUMENTS_ENABLED=true` y únicamente crea chunks locales.

`EMBEDDINGS_ENABLED=true` es un segundo opt-in independiente. Recién entonces los chunks de documentos y las consultas semánticas/híbridas explícitas pueden enviarse al endpoint configurado.

No se envían automáticamente:

- notas;
- gastos;
- recordatorios;
- mensajes self históricos;
- Observer;
- audit;
- action payloads;
- historial de conversación completo.

## Persistencia

Migración v15:

- `document_chunks`;
- `document_embeddings`.

Los chunks tienen FK a `documents` con `ON DELETE CASCADE`. Los embeddings tienen FK al chunk con `ON DELETE CASCADE`.

Por ello, el borrado o retención documental de Stage 4C elimina también sus chunks y embeddings.

Los vectores se almacenan como `float32` little-endian en un BLOB SQLite. No se añade Qdrant, Chroma, pgvector ni una extensión vectorial específica de arquitectura.

## Chunking

Defaults:

```env
SEMANTIC_CHUNK_MAX_CHARS=1200
SEMANTIC_CHUNK_OVERLAP_CHARS=200
SEMANTIC_MAX_CHUNKS=100
```

El chunker es determinístico, acotado y genera SHA-256 de cada fragmento. Intenta cortar cerca de límites de texto antes de usar el límite duro.

## Embedding provider

Interfaz genérica `EmbeddingProvider`.

Implementación actual: OpenAI-compatible `/embeddings`, usando `fetch` nativo.

Config:

```env
EMBEDDINGS_PROVIDER=openai-compatible
EMBEDDINGS_BASE_URL=
EMBEDDINGS_API_KEY=
EMBEDDINGS_MODEL=
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_TIMEOUT_MS=20000
EMBEDDINGS_BATCH_SIZE=32
```

Endpoints remotos requieren HTTPS y API key. HTTP sin key solo se permite en loopback.

El provider valida número de resultados, dimensiones y que todos los valores sean números finitos. Los errores HTTP no exponen el body upstream.

## Reindexación atómica

El servicio genera primero todos los embeddings. Solo después reemplaza chunks/embeddings dentro de una transacción SQLite.

Si el proveedor falla durante una reindexación, el índice completo anterior permanece intacto.

La ingestión PDF tampoco se revierte por un fallo semántico: el documento y su FTS local siguen disponibles.

## Búsqueda híbrida

La búsqueda híbrida combina:

- ranking FTS5 local;
- ranking semántico por cosine similarity.

La combinación usa reciprocal-rank fusion y devuelve una sola entrada por documento.

Esto evita sustituir FTS por embeddings y permite que coincidencias literales fuertes sigan aportando señal.

## Comandos

```text
semántica status
reindexa documento #12
busca semántica documentos dónde habla de vacaciones
busca híbrida documentos política para solicitar tiempo libre
```

Todos son explícitos. Ninguna respuesta se reinyecta como comando o acción.

Audit guarda únicamente metadatos estructurales como longitud de consulta, número de resultados y proveedor; no guarda consulta, chunks ni resultados.

## Límites actuales

- Cosine similarity se calcula en proceso; es adecuado para una colección personal pequeña/mediana, no para cientos de miles de chunks.
- No existe aún Q&A generativo sobre documentos en esta etapa.
- No existe reindexación masiva automática al cambiar de modelo; debe implementarse con un workflow explícito antes de cambiar proveedor/modelo en uso.
- No habilitar embeddings con documentos personales sensibles hasta revisar proveedor, política de retención, costo y el QA runtime pendiente.
