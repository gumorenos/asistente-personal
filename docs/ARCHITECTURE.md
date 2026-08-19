# Architecture

## Goal

Construir un asistente personal cuyo primer transporte sea WhatsApp sin convertir OpenClaw, Claude Code, Codex ni ningún framework de agentes en una dependencia del producto.

## Stage 1 data flow

```text
WhatsApp personal
      |
      v
BaileysWhatsAppTransport
      |
      v
normalizer PN/LID
      |
      v
self-chat guard
(fromMe + no group + allowlist)
      |
      v
canonical authorized JID
      |
      v
AssistantCore
      |
      +--> MessageRepository ------> SQLite
      |
      +--> LocalCapabilities
      |      |
      |      +--> notes
      |      +--> reminders -------> ReminderScheduler
      |      +--> expenses
      |      +--> audit
      |
      +--> deterministic router
      |
      v
same authorized self-chat only
```

## Boundaries

### MessageTransport

`AssistantCore` conoce únicamente la interfaz `MessageTransport`. Baileys es un adapter. Telegram, HTTP, una futura API oficial u otro transporte pueden añadirse sin reescribir el core.

### Self-chat safety boundary

Stage 1 solo acepta un mensaje cuando:

1. `fromMe=true`;
2. no es un grupo;
3. el JID primario o alternativo coincide con un valor configurado en `WHATSAPP_SELF_JIDS`.

Si la coincidencia ocurre mediante el JID alternativo, ese JID autorizado pasa a ser el `chatId` canónico usado por el core, replies y recordatorios. Así una entrada aceptada nunca puede provocar una salida hacia un identificador que no pasó la allowlist.

`sendText()` aplica nuevamente la misma allowlist. Esto implementa defensa en profundidad.

Con la allowlist vacía no existe descubrimiento basado en mensajes: la aplicación ignora todo el tráfico y no responde.

### Persistence

SQLite almacena:

- mensajes normalizados aceptados;
- IDs de mensajes outbound del asistente para prevenir loops;
- notas y estados;
- recordatorios, destino autorizado y estado de entrega;
- gastos, categorías y timestamps;
- audit log de mutaciones;
- credenciales y Signal keys de Baileys.

El audit log registra tipo de acción, entidad e información operacional mínima; no copia el cuerpo de notas o recordatorios en metadata de auditoría.

### Deterministic Stage 1 capabilities

Stage 1 no necesita LLM. El parser local soporta comandos explícitos y fechas deterministas. Fechas/horas inválidas o pasadas en expresiones programadas son rechazadas en vez de convertirse silenciosamente en recordatorios sin fecha.

### Reminder delivery

Los recordatorios pendientes se consultan desde SQLite. Una entrega exitosa cambia el estado a `delivered` y queda auditada. Una falla de transporte no cambia el estado, por lo que el scheduler puede reintentar en la siguiente ejecución.

## Release gates

El CI ejecuta:

```text
npm ci
  -> typecheck
  -> tests
  -> runtime dependency audit
  -> Docker amd64
  -> Docker arm64
```

ARM64 es un gate explícito porque el destino inicial es Raspberry Pi 5.

## Out of scope for Stage 1

- AI/LLM;
- observación de chats de terceros;
- respuestas automáticas a terceros;
- grupos;
- Calendar;
- audio/transcripción;
- documentos;
- OpenClaw/Claude Code/Codex.

Esas capacidades deben añadirse detrás de boundaries independientes en etapas posteriores.
