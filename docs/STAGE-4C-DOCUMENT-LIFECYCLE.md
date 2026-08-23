# Stage 4C — ciclo de vida y retención documental

## Objetivo

Cerrar el hueco de privacidad que queda después de Stage 4A/4B: un documento indexado debe poder eliminarse de forma explícita y también mediante una política de retención opt-in.

Stage 4C no añade IA, embeddings, Observer media ni agentes externos.

## Borrado explícito

El borrado requiere tres pasos separados:

```text
borra documento #12
aprueba acción #7
ejecuta acción #7
```

`borra documento #N` **no borra nada**. Crea una `action_request` local de tipo `document.delete` que vence en 15 minutos y cuyo payload contiene únicamente el `documentId`.

La aprobación sigue siendo una transición local. Solo `ejecuta acción #N` llama al executor documental.

El executor:

- exige acción `approved`;
- exige tipo exacto `document.delete`;
- revalida `documentId` y expiración;
- usa `action_executions` con idempotency key estable;
- considera “documento ya ausente” como estado final exitoso, lo que permite recuperar el crash window delete→ledger;
- borra la fila `documents` y el trigger Stage 4 elimina su entrada `self_memory_fts`;
- audita únicamente IDs/contadores/estado estructural, nunca filename, texto ni SHA completo.

## Retención automática

Apagada por defecto:

```env
DOCUMENT_RETENTION_ENABLED=false
DOCUMENT_RETENTION_DAYS=90
```

La edad se calcula desde `documents.created_at`, es decir, desde el momento en que el documento fue indexado localmente. No se usa el timestamp declarado por WhatsApp para evitar que un mensaje antiguo/reentregado sea purgado inmediatamente.

El scheduler corre al iniciar y luego una vez al día. Elimina documentos con `created_at` anterior al cutoff y deja que el trigger FTS elimine las entradas correspondientes.

La retención documental es independiente de `RETENTION_ENABLED`: ese job sigue siendo para datos operacionales y no debe borrar documentos por accidente.

## Hardening SQLite

La conexión activa `PRAGMA secure_delete = ON`.

Después de un borrado documental o una purga con cambios se intenta `PRAGMA wal_checkpoint(TRUNCATE)` para reducir la permanencia de contenido eliminado en el WAL activo. Si el checkpoint no puede completarse por concurrencia, el borrado lógico permanece válido y el audit registra `walCheckpointed=false`.

Esto **no equivale a borrado forense garantizado**. Copias de seguridad previas, snapshots del filesystem, bloques flash/NVMe, almacenamiento del host y otras réplicas pueden conservar información. Para material sensible siguen siendo necesarias políticas de backups y cifrado del volumen.

## Boundaries

- ningún comando Observer puede proponer o ejecutar borrado documental;
- captions/PDF/OCR siguen siendo terminales y no pueden disparar `borra documento`;
- no existe borrado masivo por lenguaje natural;
- la retención automática solo se activa por configuración explícita;
- ninguna acción de borrado llama IA, Calendar, red ni agente externo;
- los action payloads guardan solo `documentId`.

## Criterio de cierre

Stage 4C queda cerrado a nivel de desarrollo cuando CI valida:

- propuesta sin efecto inmediato;
- ejecución exige aprobación;
- expiración;
- idempotencia y recuperación de documento ya ausente;
- eliminación de `documents` + `self_memory_fts`;
- retención por `created_at`;
- `secure_delete=ON`;
- audit sin contenido sensible;
- Calendar sigue usando el mismo comando genérico `ejecuta acción #N` sin perder su gate.

Los checks de DB/WAL file-backed, backup policy y WhatsApp live quedan en `docs/QA-STAGE-4C-PENDING.md`.
