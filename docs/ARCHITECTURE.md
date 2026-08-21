# Architecture

## Goal

Construir un asistente personal cuyo primer transporte sea WhatsApp sin convertir OpenClaw, Claude Code, Codex ni ningún framework de agentes en una dependencia del producto.

## Current Stage 2 data flow

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
      +--> lazy audio       observed_chats guard
      |    loader                |
      v                         v
AssistantCore             SqliteObservationSink
      |                         |
      |                         v
      |                    observations
      |
      +--> MessageRepository ----------------------> SQLite
      |
      +--> Capability[] ordered
             |
             +--> LocalCapabilities --------------> notes/reminders/expenses/audit
             +--> BriefingCapability -------------> local state only
             +--> ObserverAdminCapability --------> observed_chats
             +--> CalendarProposalCapability -----> action_requests/pending
             +--> ActionApprovalCapability -------> approved/rejected
             +--> CalendarExecutionCapability ----> CalendarActionExecutor
             |                                        |
             |                                        +--> action_executions ledger
             |                                        +--> GoogleCalendarProvider
             +--> AudioTranscriptionCapability ---> TranscriptionProvider
             +--> AiCapability (`ia`) ------------> AiProvider
```

Los caminos self-chat y Observer son mutuamente excluyentes. Observer nunca entra a `AssistantCore` ni al Baileys retry store.

## MessageTransport boundary

`AssistantCore` conoce únicamente `MessageTransport`. Baileys sigue siendo un adapter. `sendText()` mantiene un guard independiente que solo acepta destinos incluidos en `WHATSAPP_SELF_JIDS`.

El transporte Baileys tiene dos handlers conceptualmente distintos:

- handler principal: recibe únicamente self-chat autorizado y puede llegar a `AssistantCore`;
- handler Observer: opcional, recibe candidatos no-self y solo llama `ObserverService`.

El handler Observer no ofrece una ruta de respuesta.

## Capability boundary

`AssistantCore` procesa una lista ordenada de `Capability`. Una capability puede devolver texto al self-chat o manipular el estado que explícitamente posee, pero no obtiene permiso implícito para ejecutar otra capability.

Esto evita, por ejemplo:

- que una respuesta IA se convierta en comando;
- que una transcripción cree una nota/acción automáticamente;
- que aprobar una propuesta ejecute Calendar por sí solo;
- que contenido Observer llegue a capabilities.

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

No toca dominio ni credenciales.

## Stage 2F — Observer read-only boundary

Observer requiere cuatro gates acumulativos:

1. WhatsApp habilitado;
2. self-JID administrativo explícito;
3. `OBSERVER_ENABLED=true`;
4. JID concreto habilitado en `observed_chats`.

`ObserverService` solo acepta texto allowlisted. `SqliteObservationSink` vuelve a validar texto y usa la tabla dedicada `observations`, con PK `(chat_jid,message_id)`.

No recibe `MessageTransport`, `AssistantCore`, capabilities, IA, transcripción ni Calendar. Por tanto no tiene una ruta para responder o ejecutar acciones.

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
whatsapp_message_store(remote_jid,message_id)
       |
       v
IMessage
```

Decisiones:

- migración v10 crea una tabla dedicada;
- se persiste solo `WAMessage.message`, no todo el envelope/chat history;
- serialización `BufferJSON` conserva `Buffer`/`Uint8Array` necesarios para contenido protobuf;
- PK exacta `(remote_jid,message_id)` e upsert idempotente;
- outbound se persiste inmediatamente tras `sendMessage` exitoso;
- inbound solo después de resolver self-chat autorizado;
- Observer/ignored retornan antes y nunca se duplican en este store;
- `getMessage` solo hace lookup local exacto y no produce red;
- cuando retención operacional está activa, usa `MESSAGE_RETENTION_DAYS`.

La implementación cubre el requisito de store; resend/missing-message recovery real sigue siendo QA live, no una garantía derivada de tests unitarios.

## Persistence

SQLite mantiene actualmente:

- self-chat normalized messages y outbound IDs;
- Baileys retry message contents (`whatsapp_message_store`);
- notes, reminders y expenses;
- audit;
- Baileys auth state;
- action requests y action execution ledger;
- briefing delivery ledger;
- observer allowlist;
- text-only observations.

Audio/transcription buffers no se persisten como archivos por la app. Prompts/respuestas IA no se almacenan en audit.

## Release gates

```text
npm ci
  -> typecheck
  -> tests
  -> runtime dependency audit
  -> Docker linux/amd64
  -> Docker linux/arm64
```

Los gates automatizados no sustituyen el QA real registrado en `docs/QA-PENDING.md`.

## Out of scope / blocked

- tool/function calling;
- fallback automático a IA;
- ejecución automática de transcripts;
- respuestas automáticas a terceros/grupos;
- IA automática sobre contenido Observer;
- ingestión de media Observer;
- full-history Observer;
- documentos/RAG;
- OpenClaw/Claude Code/Codex como dependencias del core.
