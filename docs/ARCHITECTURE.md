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
      |      +--> AudioTranscriptionCapability ---> TranscriptionProvider
      |      |
      |      +--> AiCapability (explicit `ia`) ---> AiProvider
      |
      +--> deterministic router
      |
      v
same authorized self-chat only
```

## Capability boundary

`AssistantCore` procesa una lista ordenada de `Capability`. Las capacidades locales siguen primero. IA y transcripción son adapters separados, opcionales y no reciben acceso al transporte para ejecutar acciones.

## Stage 2A — AI provider boundary

`AiProvider` abstrae el proveedor de texto. La implementación inicial usa `/chat/completions` mediante `fetch` nativo.

- `AI_ENABLED=false` por defecto.
- solo `ia`/`ai` explícito invoca al proveedor;
- no hay fallback automático;
- solo salen system prompt fijo + prompt actual;
- output solo texto, sin tool/function calling;
- HTTPS remoto, timeout y límites;
- audit sin prompt/respuesta.

## Stage 2B — transcription boundary

`TranscriptionProvider` abstrae la transcripción. La implementación inicial usa `/audio/transcriptions` con `FormData` y `fetch` nativo.

El transporte adjunta `loadMedia()` únicamente **después** de que el mensaje haya pasado `resolveAllowedSelfChat`. La capability de transcripción decide si descarga:

1. si está deshabilitada, no llama al loader;
2. si WhatsApp declara `fileLength` por encima del límite, rechaza antes de descargar;
3. si descarga, vuelve a validar los bytes reales antes de subir;
4. el buffer vive en memoria durante la llamada y no se persiste como archivo;
5. el transcript se devuelve al self-chat como texto y no vuelve al router.

Por tanto, una transcripción que contenga sintaxis de comandos no puede crear notas, reminders, gastos ni acciones por sí sola.

## Self-chat safety boundary

Se mantienen las garantías Stage 1: `fromMe=true`, no grupos, allowlist PN/LID, canonicalización al JID autorizado y outbound guard independiente. Ni IA ni transcripción amplían qué chats se aceptan.

## Persistence

SQLite mantiene mensajes aceptados, notas, recordatorios, gastos, audit log y auth state. Stage 2 no añade persistencia de audio ni un historial remoto de IA/transcripciones.

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
- Calendar writes;
- Observer/non-self chats;
- documentos;
- OpenClaw/Claude Code/Codex.
