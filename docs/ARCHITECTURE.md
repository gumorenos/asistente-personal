# Architecture

## Goal

Construir un asistente personal cuyo primer transporte sea WhatsApp sin convertir OpenClaw, Claude Code, Codex ni ningún framework de agentes en una dependencia del producto.

## Stage 2A data flow

```text
WhatsApp personal
      |
      v
BaileysWhatsAppTransport
      |
      v
normalizer PN/LID -> self-chat guard -> canonical authorized JID
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
      |      +--> AiCapability (explicit `ia`) ---> AiProvider
      |                                              |
      |                                              +--> OpenAI-compatible HTTPS endpoint
      |
      +--> deterministic router
      |
      v
same authorized self-chat only
```

## Boundaries

### MessageTransport

`AssistantCore` conoce únicamente la interfaz `MessageTransport`. Baileys es un adapter y sigue siendo reemplazable.

### Capability boundary

Stage 2A reemplaza la dependencia directa del core hacia `LocalCapabilities` por una lista ordenada de `Capability`. Las capacidades locales se evalúan primero y siguen siendo deterministas. La IA es una capacidad separada, no una dependencia del core.

Una capability puede devolver una respuesta de texto, pero no recibe acceso al transporte ni a otras capabilities. En Stage 2A la capability de IA no tiene herramientas ni funciones para modificar estado externo.

### AI provider boundary

`AiProvider` abstrae el proveedor. La implementación inicial usa el contrato HTTP OpenAI-compatible `/chat/completions` mediante `fetch` nativo, sin SDK adicional.

Reglas Stage 2A:

1. `AI_ENABLED=false` por defecto.
2. Solo `ia <texto>` o `ai <texto>` invoca al proveedor.
3. Texto normal, notas, gastos y recordatorios nunca se envían a IA.
4. Solo se envían el prompt explícito actual y un system prompt fijo; no se envía historial, SQLite, notas, gastos ni recordatorios.
5. El output del modelo es texto. No se interpreta como comando ni dispara acciones.
6. Endpoint remoto requiere HTTPS; HTTP solo se permite para loopback.
7. Errores HTTP no incorporan el body remoto a logs/respuestas.
8. Audit registra proveedor, modelo y tamaños, pero no el prompt ni la respuesta.
9. Input/output tienen límites configurables y timeout.

### Self-chat safety boundary

Se mantienen sin cambios las garantías Stage 1: `fromMe=true`, no grupos, allowlist PN/LID, canonicalización al JID realmente autorizado y outbound guard independiente.

### Persistence

SQLite mantiene mensajes aceptados, notas, recordatorios, gastos, audit log y auth state de Baileys. Los mensajes entrantes siguen persistiendo localmente; una llamada de IA no añade historial remoto ni una tabla de conversaciones de IA.

## Release gates

CI sigue ejecutando:

```text
npm ci
  -> typecheck
  -> tests
  -> runtime dependency audit
  -> Docker amd64
  -> Docker arm64
```

## Out of scope for Stage 2A

- tool/function calling de IA;
- fallback automático a IA para mensajes desconocidos;
- memoria conversacional enviada al proveedor;
- Calendar;
- audio/transcripción;
- Observer/non-self chats;
- documentos;
- OpenClaw/Claude Code/Codex.
