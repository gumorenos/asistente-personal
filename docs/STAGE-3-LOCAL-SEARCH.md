# Stage 3A — Local memory and Observer keyword search

## Goal

Añadir recuperación local útil sin introducir embeddings, RAG ni exportación automática de contenido a IA.

## Self memory

Comando explícito:

```text
busca <texto>
buscar <texto>
```

El índice `self_memory_fts` contiene únicamente:

- mensajes que ya entraron al `AssistantCore` por el self-chat autorizado;
- notas locales.

No contiene `observations`, audio, documentos, prompts/respuestas IA ni el raw retry store de Baileys.

La consulta:

- usa SQLite FTS5 local;
- tokenizer Unicode con diacríticos removibles;
- máximo 200 caracteres y 8 tokens;
- convierte el input en tokens literales/prefix; no pasa sintaxis FTS cruda del usuario;
- devuelve máximo 5 resultados en esta capability;
- excluye el propio `message_id` del comando actual;
- no llama IA;
- audit guarda únicamente counts/tokenCount, nunca la query ni resultados.

## Observer search

Comando explícito:

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

## Persistence and retention

Migración v12:

- crea `self_memory_fts` y `observation_fts`;
- backfill de mensajes/notas/observaciones existentes;
- triggers INSERT/UPDATE/DELETE mantienen ambos índices sincronizados.

Cuando retention elimina un mensaje u observación base, el trigger elimina la entrada FTS correspondiente. Las notas permanecen indexadas mientras permanezcan en SQLite.

## Explicit non-goals

Stage 3A no implementa:

- embeddings;
- vector DB;
- RAG remoto;
- resumen IA automático de resultados;
- búsqueda semántica;
- búsqueda global entre chats Observer;
- indexación de audio/media/documentos;
- envío de resultados a OpenClaw, Claude Code, Codex u otros agentes.

Esos bloques requieren un boundary de privacidad separado antes de implementarse.
