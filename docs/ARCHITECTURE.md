# Architecture

## Goal

Build a personal assistant whose initial interface is WhatsApp, without making OpenClaw, Claude Code, Codex, or any other agent framework a required dependency.

## Stage 0 data flow

```text
WhatsApp personal
      |
      v
BaileysWhatsAppTransport
      |
      v
IncomingMessage normalizer
      |
      v
AssistantCore
      |
      +--> MessageRepository --> SQLite
      |
      +--> deterministic router
      |
      v
self-chat reply only
```

## Boundaries

### MessageTransport

`AssistantCore` knows only the `MessageTransport` interface. Baileys is an adapter. A future Telegram, HTTP, official WhatsApp Business, or test adapter can replace it without changing the core.

### Self-chat safety boundary

Stage 0 accepts only messages that:

1. are `fromMe=true`;
2. are not group messages;
3. match one of the explicitly configured `WHATSAPP_SELF_JIDS` using either primary or alternate JID.

`sendText()` enforces the same allowlist. It refuses to send to any other destination, even if another part of the application requests it.

If `WHATSAPP_SELF_JIDS` is empty, the adapter may log candidate own JIDs but processes no message and sends no reply.

### Persistence

SQLite stores:

- normalized messages;
- assistant outbound message IDs, to prevent reply loops;
- future notes/reminders/expenses tables;
- audit log;
- Baileys credentials and signal keys.

Baileys authentication state is stored in SQLite rather than `useMultiFileAuthState`.

## Out of scope for Stage 0

- AI/LLM calls;
- observing third-party chats;
- groups;
- automatic replies to third parties;
- Calendar;
- audio transcription;
- document analysis;
- OpenClaw/Claude Code/Codex integrations.

Those features must be added behind independent capability or integration boundaries.
