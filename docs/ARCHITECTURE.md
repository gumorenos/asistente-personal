# Architecture

## Goal

Construir un asistente personal cuyo primer transporte sea WhatsApp sin convertir OpenClaw, Claude Code, Codex ni ningún framework de agentes en una dependencia del producto.

## Current data flow

```text
WhatsApp / Baileys live messages.upsert
              |
              v
    normalizeWhatsAppMessage
              |
              v
 routeNormalizedWhatsAppMessage
      |                         |
      | self autorizado        | no-self + OBSERVER_ENABLED
      v                         v
retry store write          ObserverService
(authorized self only)          |
      |                         v
      +--> lazy self media  observed_chats guard
      |    loader                |
      v                         v
AssistantCore             SqliteObservationSink
      |                         |
      |                         +--> observations
      |                         +--> observation_fts
      |                                  |
      |                          ObserverSearchCapability
      |                          exact known JID only
      |
      +--> MessageRepository ----------------------> SQLite
      |           |
      |           +--> self_memory_fts
      |
      +--> Capability[] ordered
             |
             +--> DocumentCapability -------------> local Poppler
             |          |                              |
             |          +--> documents ---------------+
             |                    |
             |                    +--> self_memory_fts
             +--> LocalCapabilities --------------> notes/reminders/expenses/audit
             |                                          |
             |                                          +--> self_memory_fts
             +--> MemorySearchCapability ----------> self_memory_fts
             +--> BriefingCapability -------------> local state only
             +--> ObserverAdminCapability --------> observed_chats
             +--> ObserverRead/SearchCapability --> observations / observation_fts
             +--> CalendarProposalCapability -----> action_requests/pending
             +--> ActionApprovalCapability -------> approved/rejected
             +--> CalendarExecutionCapability ----> CalendarActionExecutor
             |                                        |
             |                                        +--> action_executions ledger
             |                                        +--> GoogleCalendarProvider
             +--> AudioTranscriptionCapability ---> TranscriptionProvider
             +--> AiCapability (`ia`) ------------> AiProvider
```

Los caminos self-chat y Observer son mutuamente excluyentes. Observer nunca entra a `AssistantCore` ni al Baileys retry store. Sus índices de búsqueda también están separados.

## MessageTransport boundary

`AssistantCore` conoce únicamente `MessageTransport`. Baileys sigue siendo un adapter. `sendText()` mantiene un guard independiente que solo acepta destinos incluidos en `WHATSAPP_SELF_JIDS`.

El transporte Baileys tiene dos handlers conceptualmente distintos:

- handler principal: recibe únicamente self-chat autorizado y puede llegar a `AssistantCore`;
- handler Observer: opcional, recibe candidatos no-self y solo llama `ObserverService`.

El handler Observer no ofrece una ruta de respuesta. `loadMedia()` para audio/documentos solo se adjunta después de resolver la ruta self-chat; Observer retorna antes de ese punto.

## Capability boundary

`AssistantCore` procesa una lista ordenada de `Capability`. Una capability puede devolver texto al self-chat o manipular el estado que explícitamente posee, pero no obtiene permiso implícito para ejecutar otra capability.

Esto evita, por ejemplo:

- que una respuesta IA se convierta en comando;
- que una transcripción cree una nota/acción automáticamente;
- que aprobar una propuesta ejecute Calendar por sí solo;
- que contenido Observer llegue a capabilities de acciones;
- que el caption o texto extraído de un documento ejecute `anota`, `agenda`, etc.

`DocumentCapability` es deliberadamente la primera capability: todo `kind=document` es terminal antes de `LocalCapabilities`.

## Stage 2A — AI provider boundary

`AiProvider` abstrae el proveedor de texto mediante `/chat/completions` y `fetch` nativo.

- `AI_ENABLED=false` por defecto;
- solo `ia`/`ai` explícito;
- system prompt fijo + prompt actual, sin historial automático;
- sin tools/function calling;
- HTTPS remoto, timeout y límites;
- audit sin prompt/respuesta.

## Stage 2B — transcription boundary

`TranscriptionProvider` usa `/audio/transcriptions` con `FormData`/`fetch`.

El lazy media loader se adjunta solamente al camino self-chat autorizado:

1. transcripción apagada => no se descarga;
2. `fileLength` declarado se valida antes del download;
3. bytes reales se validan antes del upload;
4. buffer efímero en memoria;
5. transcript terminal, sin reinyectarse al router.

Observer nunca recibe este loader.

## Stage 2C — proposal / approval boundary

```text
agenda ...
   |
   v
action_request pending
   |
   +--> reject --> rejected
   |
   +--> approve -> approved
```

`CalendarProposalCapability` reutiliza el parser determinista/timezone-aware para producir `calendar.create_event` con `title`, `startAt`, `durationMinutes` y `timeZone`.

Aprobar sigue siendo solo consentimiento local; no llama al proveedor.

## Stage 2D — Calendar execution boundary

Un write real requiere otra instrucción explícita: `ejecuta acción #N` y `CALENDAR_ENABLED=true`.

```text
approved action
      |
      v
CalendarExecutionCapability
      |
      v
CalendarActionExecutor
      |
      +--> revalidate payload/time
      +--> reserve/reuse idempotency key
      +--> action_executions lease/ledger
      |
      v
GoogleCalendarProvider
      |
      +--> OAuth access-token refresh
      +--> deterministic Google event ID
      +--> 409 duplicate recovery via GET
```

Una ejecución reciente `started` actúa como lease contra concurrencia. Una lease huérfana puede recuperarse después de su ventana usando la misma idempotency key.

## Stage 2E — briefing / retention

`BriefingService` compone únicamente estado local determinista. `BriefingScheduler` puede enviarlo una vez por fecha local a un `BRIEFING_DESTINATION_JID` que debe pertenecer a `WHATSAPP_SELF_JIDS`.

`RetentionScheduler` es opcional e independiente del transporte. Purga solamente filas operativas:

- normalized self-chat messages;
- Baileys retry messages (`whatsapp_message_store`) con la misma ventana `MESSAGE_RETENTION_DAYS`;
- outbound IDs;
- audit;
- briefing delivery ledger.

Los triggers Stage 3 eliminan automáticamente las entradas FTS asociadas cuando se elimina un mensaje/observación base. Documentos son estado de dominio y todavía no participan de esta retención operacional.

## Stage 2F — Observer read-only boundary

Observer requiere cuatro gates acumulativos:

1. WhatsApp habilitado;
2. self-JID administrativo explícito;
3. `OBSERVER_ENABLED=true`;
4. JID concreto habilitado en `observed_chats`.

`ObserverService` solo acepta texto allowlisted. `SqliteObservationSink` vuelve a validar texto y usa la tabla dedicada `observations`, con PK `(chat_jid,message_id)`.

No recibe `MessageTransport`, `AssistantCore`, capabilities de acciones, IA, transcripción, documentos ni Calendar. Por tanto no tiene una ruta para responder, descargar media o ejecutar acciones.

`ObserverRetentionScheduler` aplica independientemente la ventana 1–90 días de cada chat.

## Stage 2G — Baileys retry/recovery boundary

Baileys consume `getMessage(key)` para retries y determinados message updates. `WhatsAppMessageStore` reemplaza el anterior callback que devolvía siempre `undefined`.

```text
outbound self sendMessage
       |
       +--> returned WAMessage --> whatsapp_message_store

inbound messages.upsert
       |
       v
routeNormalizedWhatsAppMessage
       |
       +--> self authorized --> whatsapp_message_store --> AssistantCore
       |
       +--> observer/ignored --------------------------X

Baileys getMessage(key)
       |
       v
whatsapp_message_store(remote_jid | remote_jid_alt, message_id)
       |
       v
IMessage
```

Decisiones:

- v10 crea la tabla dedicada;
- v11 añade `remote_jid_alt` e índice PN/LID;
- se persiste solo `WAMessage.message`, no todo el envelope/chat history;
- serialización `BufferJSON` conserva datos binarios necesarios;
- lookup siempre exige el mismo `message_id` y una coincidencia primary/alt JID;
- outbound se persiste solo tras `sendMessage` exitoso;
- inbound solo después de resolver self-chat autorizado;
- Observer/ignored nunca se duplican en este store;
- retención usa `MESSAGE_RETENTION_DAYS`.

## Stage 3 — local memory/search boundary

Stage 3 permanece completamente local y determinista.

### v12 — physically separate indexes

```text
personal domain                            Observer domain
---------------                            ---------------
messages ----\                             observations
notes --------> self_memory_fts            observed_chats guard
                    |                            |
                    v                            v
          MemorySearchCapability           observation_fts
                                                 |
                                                 v
                                      ObserverSearchCapability
                                      exact known chat_jid
```

`self_memory_fts` y `observation_fts` son tablas virtuales FTS5 distintas. Ningún query SQL de memoria personal toca `observation_fts`.

### v13 — structured personal sources

`self_memory_fts` se amplía con:

- `reminder`: body + fecha relevante `due_at` o creación;
- `expense`: descripción + categoría + moneda + monto, con `occurred_at`.

Los triggers mantienen el índice sincronizado con inserts/updates/deletes.

### Query boundary

`compileFtsQuery()`:

- máximo 200 caracteres;
- máximo 8 tokens Unicode alfanuméricos;
- prefix matching literal;
- nunca ejecuta sintaxis FTS cruda suministrada por el usuario.

`MemorySearchCapability` puede reducir el resultado mediante fuente exacta, `hoy/semana/mes` y custom range `desde YYYY-MM-DD hasta YYYY-MM-DD`, usando `APP_TIMEZONE`.

Observer search exige JID conocido exacto y nunca ofrece búsqueda global.

Stage 3 no llama AI, transcripción, Calendar, embeddings/vector DB ni agentes externos. Audit guarda solo metadata estructural/counts.

## Stage 4A — local PDF boundary

Stage 4A amplía el dominio personal con una fuente `document`, pero no amplía autoridad de ejecución.

```text
self document
    |
    v
DocumentCapability (first/terminal)
    |
    +--> disabled / declared bytes / MIME -> STOP before download
    |
    v
lazy WhatsApp media loader
    |
    +--> actual bytes / MIME / %PDF- -> STOP
    |
    v
PopplerPdfExtractor
    |
    +--> private temp dir
    +--> pdfinfo page bound
    +--> pdftotext timeout/maxBuffer
    +--> finally cleanup
    |
    v
documents (text + metadata only)
    |
    v
self_memory_fts source=document
```

Decisiones:

- v14 crea `documents` y triggers FTS;
- `DOCUMENTS_ENABLED=false` por defecto;
- solo PDFs con texto; OCR no pertenece a 4A;
- byte/page/text/time limits se validan explícitamente;
- el binario no se guarda en SQLite ni filesystem persistente;
- SHA-256 se guarda como metadata local, pero no se copia al audit;
- Poppler se ejecuta con `execFile`, sin shell interpolation;
- errores externos no exponen stdout/stderr ni paths al usuario/audit;
- el texto extraído nunca se reinyecta al router ni a IA;
- `busca documentos ...` reutiliza el mismo FTS local de Stage 3;
- Observer no recibe loader documental ni source `document`.

## Persistence

SQLite mantiene actualmente:

- self-chat normalized messages y outbound IDs;
- Baileys retry message contents (`whatsapp_message_store`) con alias PN/LID;
- notes, reminders y expenses;
- documents: texto extraído + metadata mínima, nunca PDF raw;
- `self_memory_fts` para memoria personal, incluyendo source `document`;
- audit;
- Baileys auth state;
- action requests y action execution ledger;
- briefing delivery ledger;
- observer allowlist;
- text-only observations;
- `observation_fts` para búsqueda Observer exact-JID.

Audio/transcription buffers y PDF raw no se persisten como archivos por la app. Prompts/respuestas IA y contenido documental no se almacenan en audit.

## Release gates

```text
npm ci
  -> typecheck
  -> tests
  -> runtime dependency audit
  -> Docker linux/amd64 + pdfinfo/pdftotext smoke
  -> Docker linux/arm64 + pdfinfo/pdftotext smoke
```

Los gates automatizados no sustituyen el QA real registrado en `docs/QA-PENDING.md`.

## Out of scope / blocked

- tool/function calling;
- fallback automático a IA;
- ejecución automática de transcripts o documentos;
- respuestas automáticas a terceros/grupos;
- IA automática sobre contenido Observer o documentos;
- ingestión de media Observer;
- full-history Observer;
- búsqueda Observer global;
- embeddings/vector search/RAG;
- OCR y PDFs escaneados (Stage 4B candidato);
- Office document formats;
- OpenClaw/Claude Code/Codex como dependencias del core.
