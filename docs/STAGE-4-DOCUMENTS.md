# Stage 4A — Local PDF ingestion

## Goal

Permitir que el self-chat envíe PDFs con capa de texto para indexarlos y consultarlos localmente, sin convertir documentos en comandos y sin exportarlos automáticamente a IA.

## Scope

Stage 4A admite únicamente:

- `kind=document` que ya pasó el self-chat guard;
- MIME `application/pdf`;
- magic header `%PDF-` válido;
- PDFs con texto extraíble localmente;
- límites configurables de bytes, páginas, caracteres y tiempo de extracción.

No admite OCR, imágenes, Office, documentos Observer ni procesamiento por agentes externos.

## Security boundary

El flujo es:

```text
WhatsApp self-chat autorizado
        |
        v
normalized document metadata
        |
        v
DocumentCapability (terminal)
        |
        +--> disabled / declared-size / MIME gate -> STOP, no download
        |
        v
lazy media download
        |
        +--> actual-size / PDF-magic gate -> STOP
        |
        v
PopplerPdfExtractor
        |
        +--> pdfinfo page-count gate
        +--> pdftotext with timeout/output bound
        |
        v
DocumentRepository
        |
        +--> extracted text + minimal metadata only
        +--> self_memory_fts source=document
```

`DocumentCapability` está antes de `LocalCapabilities`. Un caption como `anota ...`, `recuérdame ...` o `agenda ...` en un PDF nunca puede continuar al parser de comandos.

Observer retorna antes de que el transporte adjunte `loadMedia()`, por lo que documentos de terceros/grupos observados no pueden descargarse por esta feature.

## Persistence

Migración v14 crea `documents` con:

- id local;
- `message_id` idempotente;
- timestamp de recepción;
- nombre de archivo acotado;
- MIME;
- SHA-256;
- tamaño en bytes;
- número de páginas;
- texto extraído;
- flag de truncamiento;
- timestamp de creación.

El PDF binario no se persiste por la aplicación. Durante extracción existe únicamente como `Uint8Array` en memoria y archivo temporal privado, eliminado en `finally`.

El texto de documentos entra a `self_memory_fts` como fuente `document`. No entra a `observation_fts`.

## Commands

```text
documentos
documento #1
busca documentos contrato
busca documentos mes presupuesto
busca documentos desde 2026-08-01 hasta 2026-08-21 factura
```

Las búsquedas siguen el mismo compiler FTS literal/prefix y límites de Stage 3.

## Configuration

```env
DOCUMENTS_ENABLED=false
DOCUMENTS_MAX_BYTES=10485760
DOCUMENTS_MAX_PAGES=50
DOCUMENTS_MAX_TEXT_CHARS=100000
DOCUMENTS_TIMEOUT_MS=20000
```

La feature está apagada por defecto.

## Poppler runtime

Docker instala `poppler-utils` y usa:

- `pdfinfo` para contar páginas antes de extracción;
- `pdftotext` para obtener texto;
- `execFile`, nunca shell interpolation;
- directorio temporal privado;
- timeout + `SIGKILL`;
- `maxBuffer` limitado;
- cleanup incondicional del temporal.

CI debe comprobar que ambos binarios existen en imágenes `linux/amd64` y `linux/arm64`.

## Audit

Audit puede registrar:

- estado started/succeeded/rejected/failed;
- extractor;
- bytes;
- páginas;
- caracteres;
- truncamiento;
- tipo de error local.

No debe registrar:

- nombre del archivo;
- texto extraído;
- bytes PDF;
- SHA-256;
- stdout/stderr de Poppler;
- caption del documento.

## Explicit non-goals

Stage 4A no implementa:

- OCR;
- resumen automático;
- extracción automática de fechas/tareas/montos;
- ejecución de acciones desde documentos;
- embeddings/vector DB;
- RAG remoto;
- IA automática sobre documentos;
- media/documentos Observer;
- Word/Excel/PowerPoint;
- OpenClaw/Claude Code/Codex como dependencia.

OCR y otros formatos requieren un stage separado y nuevos boundaries antes de habilitarse.
