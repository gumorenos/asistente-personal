# QA pendiente — Stage 4D semantic/hybrid memory + OPS-A

Este archivo es el checklist para el próximo runner QA independiente. No modificar código ni marcar PASS sin evidencia runtime.

## Automatizado en CI

Sobre el código previo a los commits documentales finales, ya existe cobertura automatizada para:

- [x] migración v15 crea `document_chunks` y `document_embeddings`;
- [x] chunking determinístico, límites, overlap y hash;
- [x] `SEMANTIC_ENABLED=false` y `EMBEDDINGS_ENABLED=false` por defecto;
- [x] semantic requiere documents y embeddings requiere semantic;
- [x] endpoints remotos requieren HTTPS/API key;
- [x] chunks locales funcionan sin proveedor externo;
- [x] provider valida count/dimensions/números finitos y oculta body de errores;
- [x] embeddings se almacenan como float32 y cosine search funciona;
- [x] fallo de provider durante reindex conserva el índice completo anterior;
- [x] document delete hace cascade a chunks/embeddings;
- [x] semantic/hybrid commands son explícitos y no guardan query en audit;
- [x] hybrid ranking combina FTS + semantic sin mezclar Observer;
- [x] backup nativo produce snapshot verificable;
- [x] backup es independiente de cambios posteriores de la fuente;
- [x] doctor inspecciona DB sin aplicar migraciones/escrituras;
- [x] configuración inválida/missing DB hace fail-closed.

Volver a ejecutar los gates base sobre el SHA exacto antes de QA independiente.

## Migración / upgrade file-backed

- [ ] crear copia sintética Stage 4C/schema v14 y abrirla con Stage 4D;
- [ ] confirmar aplicación única de v15;
- [ ] validar datos/documentos/FTS/Observer existentes intactos;
- [ ] reabrir y confirmar idempotencia;
- [ ] `PRAGMA foreign_key_check` = 0;
- [ ] backup v14 previo y restore siguen siendo válidos en su propio código/base; no alterar backup original.

## Semantic local-only — sin external traffic

Configurar en DB/entorno sintético:

```env
DOCUMENTS_ENABLED=true
SEMANTIC_ENABLED=true
EMBEDDINGS_ENABLED=false
```

- [ ] indexar varios PDFs/textos sintéticos;
- [ ] confirmar chunks creados y embeddings=0;
- [ ] confirmar por captura de red/proxy/endpoint fake que hubo **cero** requests `/embeddings`;
- [ ] `semántica status` informa chunks habilitados + embeddings deshabilitados;
- [ ] `busca semántica ...` y `busca híbrida ...` no generan tráfico y explican el gate;
- [ ] reindexar un documento mantiene determinismo de chunks/hashes;
- [ ] Observer/observations nunca aparecen en `document_chunks`.

## Embedding provider real o endpoint QA

Usar únicamente documentos sintéticos/no sensibles.

Si no hay un endpoint/credencial QA autorizado, marcar este bloque `BLOCKED`, no `FAIL`.

- [ ] habilitar proveedor OpenAI-compatible QA;
- [ ] request de indexación contiene solo `model` + batch de chunks del documento solicitado;
- [ ] request de búsqueda contiene solo `model` + query explícita;
- [ ] no salen notes/expenses/reminders/messages/Observer/audit/action payloads;
- [ ] auth/API key no aparece en logs/audit/SQLite;
- [ ] HTTP 401/429/500 seguro;
- [ ] timeout seguro;
- [ ] count incorrecto falla sin reemplazar índice previo;
- [ ] dimensions incorrectas fallan sin reemplazar índice previo;
- [ ] valores no numéricos/null fallan;
- [ ] cambio de model/dimensions no devuelve embeddings del modelo anterior como si fueran compatibles;
- [ ] medir latencia, bytes enviados y costo aproximado para 1, 10 y ~50 chunks sintéticos.

## Semantic + hybrid retrieval

Con corpus sintético conocido:

- [ ] documento con palabras literales relevantes aparece por FTS;
- [ ] documento semánticamente relacionado pero sin keywords exactas aparece por semantic;
- [ ] documento soportado por ambas señales queda bien posicionado en hybrid;
- [ ] resultados son document-scoped y no duplican el mismo documento varias veces en hybrid;
- [ ] query/resultados no aparecen en audit;
- [ ] reply respeta límite de tamaño;
- [ ] respuesta de búsqueda jamás se ejecuta como comando/acción.

## Lifecycle / retention integration

- [ ] documento con chunks+embeddings: proponer/aprobar/ejecutar delete elimina `documents`, FTS, chunks y embeddings;
- [ ] retención Stage 4C sobre DB QA elimina también chunks/embeddings por FK cascade;
- [ ] reindex fallido antes de delete no impide delete;
- [ ] `secure_delete + WAL checkpoint` se revisa también con tokens presentes en chunks semánticos;
- [ ] backup previo a delete conserva chunks/embeddings por diseño;
- [ ] backup posterior a delete no los contiene.

No habilitar `DOCUMENT_RETENTION_ENABLED=true` sobre datos personales reales hasta cerrar también `docs/QA-STAGE-4C-PENDING.md`.

## OPS doctor — runtime real

En la imagen/host final o entorno equivalente:

- [ ] `npm run doctor` con defaults;
- [ ] `npm run doctor -- --json` produce JSON parseable;
- [ ] con documents habilitado detecta Poppler real;
- [ ] con OCR habilitado detecta Tesseract + `spa`/`eng`;
- [ ] con executable faltante deliberadamente en contenedor QA devuelve FAIL apropiado;
- [ ] DB inexistente devuelve exit != 0 sin crear archivo;
- [ ] doctor no altera mtime/size/schema/row counts de la DB;
- [ ] doctor no hace llamadas a AI/embeddings/Google/transcription;
- [ ] WhatsApp enabled sin auth informa WARN y no hace pairing.

## OPS backup / verify — volumen real

Solo DB QA o copia segura.

- [ ] `npm run backup` mientras la app/DB QA está activa en WAL;
- [ ] backup abre con `quick_check=ok`;
- [ ] FTS, documents, chunks y embeddings están consistentes;
- [ ] `npm run backup:verify -- <file>` PASS;
- [ ] restaurar backup a otra ruta/contenedor y ejecutar doctor;
- [ ] permisos del archivo backup adecuados al filesystem final;
- [ ] interrupción/fallo de destino no corrompe DB fuente;
- [ ] falta de espacio/permisos falla de forma segura si puede simularse sin riesgo;
- [ ] medir tiempo/tamaño de backup con DB representativa.

## Backup policy — decisión operacional pendiente

- [ ] decidir directorio/volumen de backups;
- [ ] decidir si el volumen estará cifrado;
- [ ] definir retención/rotación de backups;
- [ ] definir cómo eliminar backups que aún contienen documentos borrados;
- [ ] decidir frecuencia y prueba periódica de restore.

Esto es release-blocking antes de guardar documentos personales especialmente sensibles.

## WhatsApp live

Solo si ya existe una línea/sesión QA autorizada. NO usar una cuenta personal crítica y NO hacer pairing sin autorización explícita.

- [ ] ingerir PDF real desde self-chat con semantic local-only;
- [ ] confirmar chunks creados tras exactly-one ingest;
- [ ] `reindexa documento #N` desde self-chat;
- [ ] semantic/hybrid query desde self-chat si proveedor QA está habilitado;
- [ ] exactly-one reply, sin loops;
- [ ] captions/document content que contengan comandos semánticos no los ejecutan;
- [ ] terceros/grupos/Observer no pueden disparar indexación semantic/embeddings.

Si no hay sesión autorizada: `BLOCKED`, no `FAIL`.

## ARM64 / performance

- [ ] Docker ARM64 desde SHA exacto;
- [ ] con corpus sintético de ~100/500/1000 chunks medir RAM y tiempo de cosine search;
- [ ] medir tamaño incremental SQLite por 1000 embeddings del modelo/dimensiones elegidas;
- [ ] comprobar que el proceso sigue dentro de límites razonables del host final;
- [ ] si la colección deja de ser razonable para scan en proceso, documentar threshold antes de introducir vector DB.

## Stop conditions

No habilitar embeddings sobre documentos personales reales hasta que:

1. proveedor/modelo hayan sido elegidos explícitamente;
2. privacidad/retención del proveedor sea aceptable;
3. QA externo anterior pase;
4. política de backups esté definida.

No merge/deploy automático como resultado de este checklist.
