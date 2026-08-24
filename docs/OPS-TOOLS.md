# OPS-A — doctor y backup

## `npm run doctor`

Diagnóstico local de solo lectura.

No aplica migraciones, no hace pairing y no llama proveedores externos.

Comprueba, según configuración:

- configuración válida;
- existencia y `quick_check` de SQLite;
- versión de migraciones;
- journal/WAL;
- estado observable de `secure_delete`;
- `foreign_key_check`;
- lectura de índices FTS;
- conteo de chunks/embeddings;
- presencia de auth WhatsApp sin leer secretos;
- Poppler cuando documentos están habilitados;
- Tesseract e idiomas cuando OCR está habilitado;
- flags de AI, transcripción, semantic/embeddings, Calendar, Observer y document retention.

Uso:

```bash
npm run doctor
npm run doctor -- --json
```

Un `WARN` no cambia el exit code. Un `FAIL` sí.

El doctor no afirma que un proveedor externo esté accesible: cuando una feature remota está habilitada solo informa `enabled (connectivity not tested)`.

## `npm run backup`

Crea un snapshot SQLite coherente usando la API nativa de backup de Node `node:sqlite`.

```bash
APP_DB_PATH=/ruta/assistant.db npm run backup
APP_DB_PATH=/ruta/assistant.db npm run backup -- /ruta/backups/assistant.db
```

La fuente se abre read-only. La copia se verifica inmediatamente.

## `npm run backup:verify`

```bash
npm run backup:verify -- /ruta/backups/assistant.db
```

Valida:

- `PRAGMA quick_check`;
- `PRAGMA foreign_key_check`;
- schema/migration esperada;
- acceso a FTS5;
- documentos;
- chunks semánticos;
- embeddings.

La copia se abre read-only.

## Seguridad y límites

- El backup conserva deliberadamente todo lo que existía en el momento del snapshot.
- Borrar posteriormente un documento de la DB activa no borra copias antiguas.
- La rotación/eliminación de backups es una política operacional separada y debe cerrarse antes de almacenar información muy sensible.
- No existe todavía cifrado de backup integrado. Usar almacenamiento/volumen cifrado cuando corresponda.
- `doctor` no sustituye QA live de WhatsApp, Google, AI, transcription o embeddings.
