# QA pendiente — Stage 4C document lifecycle

Este archivo es la lista para el próximo runner QA. No marcar PASS sin evidencia runtime.

## Base gates

- [ ] verificar SHA/branch exactos y worktree detached/clean;
- [ ] `npm ci`;
- [ ] `npm run check`;
- [ ] `npm audit --omit=dev --audit-level=high`;
- [ ] Docker linux/arm64 desde el SHA exacto;
- [ ] Docker linux/amd64 si el runner lo permite.

## Borrado explícito con SQLite file-backed

Usar únicamente documentos/fixtures sintéticos con tokens únicos.

- [ ] indexar un PDF/texto sintético y confirmar `documents=1` + FTS hit;
- [ ] `borra documento #N` crea solo `action_request=document.delete` y NO elimina el documento;
- [ ] payload de la acción contiene únicamente `documentId` y no filename/texto/SHA;
- [ ] ejecutar antes de aprobar no elimina nada;
- [ ] aprobar no elimina nada;
- [ ] `ejecuta acción #N` elimina exactamente el documento esperado;
- [ ] la misma ejecución repetida no produce segundo efecto y conserva `attempt_count=1`;
- [ ] el documento desaparece de `self_memory_fts` y de `busca documentos`;
- [ ] acción expirada no borra;
- [ ] acción de otro tipo no se ejecuta por el document executor;
- [ ] simular/reproducir de forma segura documento ya ausente + lease stale y verificar recuperación idempotente.

## Retención automática

- [ ] `DOCUMENT_RETENTION_ENABLED=false` no purga documentos al arrancar;
- [ ] con política habilitada, documentos anteriores al cutoff de `created_at` se eliminan;
- [ ] documentos dentro de ventana sobreviven;
- [ ] el timestamp `received_at` no decide la retención;
- [ ] FTS queda consistente después de la purga;
- [ ] scheduler es no-reentrante;
- [ ] reinicio no duplica efectos ni rompe DB.

## SQLite / WAL / privacidad

En DB descartable y file-backed:

- [ ] `PRAGMA secure_delete` devuelve `1`;
- [ ] tras borrado exitoso comprobar checkpoint WAL y estado de `-wal`/`-shm`;
- [ ] escanear DB/WAL/SHM activos y verificar que el token sintético eliminado no sea recuperable por búsquedas simples de bytes después del checkpoint;
- [ ] repetir lo anterior para retención automática;
- [ ] confirmar que audit no contiene filename, texto, token, SHA completo ni payload documental;
- [ ] confirmar que logs no imprimen contenido borrado;
- [ ] si `walCheckpointed=false` puede reproducirse de forma segura con lector concurrente, verificar que el delete lógico sigue aplicado y que un checkpoint posterior puede truncar WAL.

Importante: este check no demuestra borrado forense del medio físico. Reportar únicamente sobre archivos SQLite/WAL/SHM observables.

## Backup / restore

- [ ] backup creado **antes** del borrado conserva el documento por diseño; documentar claramente este riesgo;
- [ ] backup creado **después** del borrado no contiene la fila ni FTS del documento;
- [ ] restore de backup posterior mantiene el documento ausente;
- [ ] definir/recomendar política operacional para backups antiguos antes de habilitar documentos sensibles en producción.

## WhatsApp live

Solo si ya existe una sesión QA autorizada. NO hacer pairing nuevo y NO usar cuenta personal/crítica.

- [ ] desde self-chat: proponer → aprobar → ejecutar borrado;
- [ ] comprobar exactamente una respuesta por comando y sin loop;
- [ ] confirmar que captions/OCR que contengan `borra documento #N` no disparan borrado;
- [ ] mensajes de terceros/grupos no pueden proponer ni ejecutar esta acción.

Si no hay sesión QA autorizada, marcar este bloque `BLOCKED`, no `FAIL`, y continuar el resto.

## Stop point

No habilitar `DOCUMENT_RETENTION_ENABLED=true` sobre datos personales reales hasta validar file-backed WAL/backup behavior y decidir cómo se rotan/eliminan backups antiguos.
