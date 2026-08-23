# Stage 4B — OCR local para PDFs escaneados

## Objetivo

Extender Stage 4A para poder indexar PDFs escaneados que no tienen capa de texto, sin introducir IA, OCR remoto ni ejecución automática de contenido documental.

Stage 4B mantiene el mismo dominio autorizado: **solo PDFs del self-chat que ya pasaron el guard de WhatsApp**. Observer sigue sin recibir media loaders ni capacidad documental.

## Flujo

```text
PDF self autorizado
      |
      v
límites bytes/MIME/%PDF-
      |
      v
Poppler text layer
      |
      +--> texto encontrado ------> persistir/indexar (method=text-layer)
      |
      +--> texto vacío
              |
              +--> OCR disabled --> no persistir
              |
              +--> OCR enabled
                       |
                       v
                 pdfinfo page count
                       |
                       v
                 page-by-page
                 pdftoppm PNG
                       |
                       v
                 Tesseract local
                       |
                       v
                 bounded text
                       |
                       +--> texto --> persistir/indexar (method=ocr)
                       +--> vacío --> no persistir
```

## Principios

1. **OCR es fallback, no default.** Si Poppler extrae cualquier texto no vacío, Tesseract no se ejecuta.
2. **Opt-in.** `DOCUMENTS_OCR_ENABLED=false` por defecto y no puede habilitarse si `DOCUMENTS_ENABLED=false`.
3. **Local-only.** No hay HTTP, API key, modelo remoto, OpenClaw ni proveedor externo en el path OCR.
4. **Mismo boundary de ejecución.** El texto OCR no se reinyecta al router; `anota`, `agenda`, `ia`, etc. dentro del documento siguen siendo datos.
5. **Mismo almacenamiento.** Se reutiliza `documents` v14 y `self_memory_fts`; no se crea v15 solo para indicar el método de extracción.
6. **Sin PDF raw persistente.** El PDF y los PNG rasterizados viven únicamente en directorios temporales privados durante el procesamiento.
7. **Observer sigue aislado.** No se añade OCR, descarga de media ni indexación documental al dominio Observer.

## Recursos y límites

Defaults:

```env
DOCUMENTS_OCR_ENABLED=false
DOCUMENTS_OCR_MAX_PAGES=10
DOCUMENTS_OCR_DPI=180
DOCUMENTS_OCR_LANGUAGES=spa+eng
DOCUMENTS_OCR_TIMEOUT_MS=60000
```

Reglas:

- OCR page limit: 1–50;
- DPI: 100–300;
- idiomas soportados por la imagen: `spa`, `eng` o `spa+eng` / `eng+spa`; otros códigos se rechazan al arrancar porque sus traineddata no están instalados;
- timeout OCR: 1–300 segundos;
- el límite OCR de páginas puede ser menor que `DOCUMENTS_MAX_PAGES`;
- el timeout OCR es un deadline total del fallback, no un timeout nuevo completo por página;
- las páginas se rasterizan de una en una;
- cada PNG se elimina tras su OCR;
- `DOCUMENTS_MAX_TEXT_CHARS` sigue siendo el límite final del texto persistido.

## Implementación

- `PopplerPdfExtractor`: extracción de capa de texto, `method=text-layer`.
- `TesseractPdfOcrExtractor`: `pdfinfo` + `pdftoppm` + Tesseract, `method=ocr`.
- `HybridPdfExtractor`: decide si el fallback OCR es necesario y verifica que el page count OCR coincida con el obtenido por Poppler.
- `DocumentCapability`: persiste el resultado de cualquiera de ambos métodos con el mismo contrato Stage 4A.

El audit puede registrar metadata estructural como `method=ocr`, número de páginas, bytes y caracteres. No debe guardar filename, texto OCR, SHA-256 completo, stdout/stderr de los binarios ni paths temporales.

## Docker

La imagen incluye:

- `poppler-utils` (`pdfinfo`, `pdftotext`, `pdftoppm`);
- `tesseract-ocr`;
- `tesseract-ocr-spa`;
- `tesseract-ocr-eng`.

CI debe verificar estos binarios y ambos idiomas en `linux/amd64` y `linux/arm64`.

## Qué NO hace Stage 4B

- no hace OCR de imágenes sueltas;
- no procesa media Observer;
- no hace handwriting recognition especializado;
- no usa vision LLMs;
- no resume automáticamente documentos;
- no extrae acciones o eventos del texto OCR;
- no intenta OCR si el PDF ya tiene una capa de texto no vacía;
- no corrige ni normaliza semánticamente errores OCR con IA;
- no habilita idiomas adicionales sin añadir primero el traineddata correspondiente a la imagen soportada.

## Criterio de cierre

Stage 4B puede considerarse cerrado a nivel de desarrollo cuando:

- typecheck + tests + runtime audit están verdes;
- Docker AMD64/ARM64 incluyen Poppler/Tesseract + `spa`/`eng`;
- fallback solo ocurre con capa de texto vacía;
- page/DPI/text/timeout bounds están cubiertos;
- temp cleanup y privacy boundaries tienen tests;
- QA runtime con un PDF escaneado real confirma OCR local en ARM64.

El QA runtime pendiente se mantiene en `docs/QA-STAGE-4B-PENDING.md`.
