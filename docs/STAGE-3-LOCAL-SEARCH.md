# Stage 3 — Local memory and Observer keyword search

## Goal

Añadir recuperación local útil sin introducir embeddings, RAG ni exportación automática de contenido a IA.

## Stage 3A — isolated FTS search

### Self memory

Comandos explícitos:

```text
busca <texto>
buscar <texto>
```

El índice `self_memory_fts` contiene únicamente información personal/local autorizada. Desde Stage 3B las fuentes son:

- mensajes que ya entraron al `AssistantCore` por el self-chat autorizado;
- notas locales;
- recordatorios locales;
- gastos locales.

No contiene `observations`, audio, documentos, prompts/respuestas IA ni el raw retry store de Baileys.

La consulta:

- usa SQLite FTS5 local;
- tokenizer Unicode con diacríticos removibles;
- máximo 200 caracteres y 8 tokens;
- convierte el input en tokens literales/prefix; no pasa sintaxis FTS cruda del usuario;
- devuelve máximo 5 resultados en la capability;
- excluye el propio `message_id` del comando actual;
- no llama IA;
- audit guarda únicamente metadata estructural/counts, nunca la query ni resultados.

### Observer search

Comandos explícitos:

```text
busca observaciones <jid> <texto>
buscar observaciones <jid> <texto>
```

El índice `observation_fts` está físicamente separado de `self_memory_fts`.

Cada búsqueda Observer exige:

1. JID válido;
2. JID presente en el historial/allowlist administrativo `observed_chats`;
3. filtro SQL exacto `chat_jid = ?` además del `MATCH` FTS;
4. máximo 5 resultados;
5. ejecución desde el self-chat a través de una capability explícita.

Un chat deshabilitado puede seguir consultando únicamente sus filas ya retenidas hasta que su política de retención las purgue, consistente con `observaciones <jid>`.

No existe búsqueda global de Observer ni búsqueda cruzada entre chats.

## Stage 3B — structured self-memory sources

Migración v13 amplía `self_memory_fts` sin mezclarlo con Observer:

- `reminder`: indexa el body y usa `due_at` como fecha relevante cuando existe;
- `expense`: indexa descripción + categoría + moneda + monto legible, usando `occurred_at` como fecha relevante.

Los triggers mantienen sincronizado el índice cuando se crea/edita/elimina el registro. Por ejemplo, recategorizar un gasto elimina la categoría anterior del índice e incorpora la nueva.

Filtros explícitos:

```text
busca mensajes <texto>
busca notas <texto>
busca recordatorios <texto>
busca gastos <texto>
```

El filtro se aplica como condición SQL sobre `source`; no es una instrucción interpretada por IA.

## Stage 3C — temporal scopes

La búsqueda personal soporta scopes timezone-aware usando el mismo utilitario de periodos locales que gastos:

```text
busca hoy <texto>
busca semana <texto>
busca mes <texto>

busca notas mes <texto>
busca gastos hoy <texto>
busca recordatorios semana <texto>

busca desde 2026-08-01 hasta 2026-08-20 <texto>
busca gastos desde 2026-08-01 hasta 2026-08-20 <texto>
```

Semántica:

- `hoy`: 00:00 local hasta 00:00 del día siguiente;
- `semana`: lunes 00:00 local hasta el lunes siguiente;
- `mes`: primer día 00:00 local hasta primer día del mes siguiente;
- custom range: `desde` y `hasta` son fechas locales inclusivas para el usuario; internamente se convierten a `[inicio, día posterior a hasta)`;
- rango custom máximo inicial: 3.660 días;
- fechas inválidas o invertidas se rechazan sin ejecutar la búsqueda ni crear audit de búsqueda.

`occurred_at` se interpreta según la fuente:

- message: timestamp del mensaje;
- note: creación de la nota;
- reminder: vencimiento (`due_at`) si existe; en caso contrario creación;
- expense: fecha del gasto.

Audit solo guarda el tipo de scope (`day`, `week`, `month`, `custom`, `all-time`), nunca la query ni las fechas custom concretas.

## Persistence and retention

Migración v12:

- crea `self_memory_fts` y `observation_fts`;
- backfill de mensajes/notas/observaciones existentes;
- triggers INSERT/UPDATE/DELETE mantienen ambos índices sincronizados.

Migración v13:

- backfill de recordatorios y gastos existentes;
- triggers de recordatorios y gastos.

Cuando retention elimina un mensaje u observación base, el trigger elimina la entrada FTS correspondiente. Notas, recordatorios y gastos siguen la persistencia de sus tablas de dominio.

## Privacy invariants

- `self_memory_fts` y `observation_fts` son índices físicamente separados;
- la búsqueda personal nunca consulta `observation_fts`;
- la búsqueda Observer nunca consulta `self_memory_fts`;
- Observer search siempre requiere un JID exacto administrativamente conocido;
- ninguna búsqueda llama IA o providers externos;
- la query y los resultados no se copian al audit;
- un filtro temporal o de fuente reduce resultados, nunca amplía el boundary de autorización.

## Explicit non-goals

Stage 3 no implementa todavía:

- embeddings;
- vector DB;
- RAG remoto;
- resumen IA automático de resultados;
- búsqueda semántica;
- búsqueda global entre chats Observer;
- scopes temporales para Observer;
- indexación de audio/media/documentos;
- envío de resultados a OpenClaw, Claude Code, Codex u otros agentes.

Esos bloques requieren un boundary de privacidad separado antes de implementarse.
