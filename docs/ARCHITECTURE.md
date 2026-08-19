# Architecture

## Goal

Construir un asistente personal cuyo primer transporte sea WhatsApp sin convertir OpenClaw, Claude Code, Codex ni ningún framework de agentes en una dependencia del producto.

## Stage 2 data flow

```text
WhatsApp personal
      |
      v
BaileysWhatsAppTransport
      |
      v
normalizer PN/LID -> self-chat guard -> canonical authorized JID
      |
      +-- audio autorizado --> lazy media loader
      |
      v
AssistantCore
      |
      +--> MessageRepository ----------------------> SQLite
      |
      +--> Capability[] (ordered)
      |      |
      |      +--> LocalCapabilities --------------> notes/reminders/expenses/audit
      |      |
      |      +--> CalendarProposalCapability -----> action_requests (pending)
      |      |
      |      +--> ActionApprovalCapability -------> approved / rejected only
      |      |
      |      +--> AudioTranscriptionCapability ---> TranscriptionProvider
      |      |
      |      +--> AiCapability (explicit `ia`) ---> AiProvider
      |
      +--> deterministic router
      |
      v
same authorized self-chat only
```

No Stage 2C component has a Google Calendar client or external-action executor.

## Capability boundary

`AssistantCore` procesa una lista ordenada de `Capability`. Las capacidades locales siguen primero. IA, transcripción y futuras integraciones externas son adapters separados. Una capability puede producir una respuesta o una propuesta local, pero no recibe implícitamente permiso para enviar mensajes o ejecutar otras capabilities.

## Stage 2A — AI provider boundary

`AiProvider` abstrae el proveedor de texto. La implementación inicial usa `/chat/completions` mediante `fetch` nativo.

- `AI_ENABLED=false` por defecto;
- solo `ia`/`ai` explícito invoca al proveedor;
- no hay fallback automático;
- solo salen system prompt fijo + prompt actual;
- output solo texto, sin tool/function calling;
- HTTPS remoto, timeout y límites;
- audit sin prompt/respuesta.

## Stage 2B — transcription boundary

`TranscriptionProvider` abstrae la transcripción. La implementación inicial usa `/audio/transcriptions` con `FormData` y `fetch` nativo.

El transporte adjunta `loadMedia()` únicamente **después** de `resolveAllowedSelfChat`:

1. si transcripción está deshabilitada, no descarga;
2. `fileLength` declarado se compara con el límite antes de descargar;
3. después de descargar se verifica nuevamente el tamaño real;
4. el buffer es efímero en memoria;
5. el transcript vuelve como texto terminal y no se reinyecta al router.

## Stage 2C — proposal / approval boundary

Antes de cualquier Calendar write se separan tres conceptos:

```text
intención del usuario
      |
      v
CalendarProposalCapability
      |
      v
action_requests.status = pending
      |
      +--> rechazar -> rejected
      |
      +--> aprobar  -> approved
                        |
                        X  NO executor todavía
```

`CalendarProposalCapability` reutiliza el parser determinista/timezone-aware de recordatorios para convertir `agenda ...` en un payload local `calendar.create_event` con `title`, `startAt`, `durationMinutes` y `timeZone`.

`ActionApprovalCapability` solo puede mover una acción `pending` vigente a `approved` o `rejected`. Una acción Calendar expira al llegar su `startAt`, por lo que deja de aparecer y no puede aprobarse después.

La aprobación **no equivale a ejecución**. Un futuro Calendar executor tendrá que:

1. aceptar únicamente `action_type` soportados y estado `approved`;
2. validar de nuevo schema, fecha, timezone y vigencia justo antes del write;
3. reservar/registrar una idempotency key antes de llamar al proveedor;
4. persistir resultado y external event id sin duplicar eventos ante retry;
5. no ejecutar si OAuth/provider no están explícitamente habilitados;
6. auditar el resultado sin copiar secretos.

## Self-chat safety boundary

Se mantienen las garantías Stage 1: `fromMe=true`, no grupos, allowlist PN/LID, canonicalización al JID autorizado y outbound guard independiente. Stage 2A/2B/2C no amplían qué chats se aceptan.

## Persistence

SQLite mantiene mensajes aceptados, notas, recordatorios, gastos, audit, auth state y `action_requests`. Stage 2 no persiste audio ni historial remoto de IA/transcripción. El payload de una propuesta sí vive localmente en SQLite porque un executor futuro necesitará una representación estable de la acción aprobada.

## Release gates

```text
npm ci
  -> typecheck
  -> tests
  -> runtime dependency audit
  -> Docker amd64
  -> Docker arm64
```

## Out of scope actual

- tool/function calling;
- fallback automático a IA;
- ejecución automática de transcript;
- Google Calendar OAuth/provider/executor y writes;
- Observer/non-self chats;
- documentos;
- OpenClaw/Claude Code/Codex.
